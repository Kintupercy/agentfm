import express from "express";
import type { StationEvent } from "@agentfm/shared";
import { appendAirTime, archiveRouter } from "./archive.js";
import { createAgentCallClient } from "./agentcall.js";
import { assertServerConfig, env } from "./env.js";
import { verifySignature } from "./hmac.js";
import { initRealtime, publish } from "./realtime.js";
import { ShowRunner } from "./showrunner.js";

assertServerConfig();
await initRealtime();

const agentcall = createAgentCallClient();
const show = new ShowRunner(agentcall);
const app = express();
app.disable("x-powered-by");

// internal endpoints: allow localhost, or a valid shared token (set on both
// the engine and the broadcast container so cross-container calls work)
const internalOnly: express.RequestHandler = (req, res, next) => {
  const ip = req.socket.remoteAddress ?? "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return next();
  if (env.internalToken && req.header("x-internal-token") === env.internalToken)
    return next();
  res.status(403).json({ error: "internal only" });
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, show: show.status() });
});

// the call archive: shareable pages + audio + recent-episodes JSON (public)
app.use(archiveRouter);

/**
 * AgentCall events: verify HMAC over the RAW body before parsing, persist,
 * relay onto the Realtime channel verbatim, return 2xx immediately.
 * Event names already match our schema — no translation layer.
 */
app.post(
  "/webhooks/agentcall",
  express.raw({ type: "*/*", limit: "1mb" }),
  (req, res) => {
    const raw = req.body as Buffer;
    if (
      !verifySignature(
        raw,
        req.header("x-agentcall-signature"),
        env.agentcallWebhookSecret,
      )
    ) {
      res.status(401).json({ error: "bad signature" });
      return;
    }
    res.status(200).json({ ok: true }); // ack fast; process after

    try {
      const ev = JSON.parse(raw.toString("utf8")) as StationEvent;
      if (!ev?.event || !ev?.data) throw new Error("not an event envelope");
      void publish(ev);
      show.bus.emit("event", ev);
    } catch (e) {
      console.error("[webhook] unparseable payload (logged raw):", e);
    }
  },
);

/**
 * The host's contextWebhook. AgentCall waits 800ms MAX (fail-open) — so this
 * returns a PRECOMPUTED block; nothing slow may ever live here.
 */
app.post(
  "/context",
  express.raw({ type: "*/*", limit: "64kb" }),
  (req, res) => {
    if (
      !verifySignature(
        req.body as Buffer,
        req.header("x-agentcall-signature"),
        env.contextWebhookSecret,
      )
    ) {
      res.status(401).json({ error: "bad signature" });
      return;
    }
    res.json({ contextBlock: show.getContextBlock() });
  },
);

/** Liquidsoap → broadcast.now_playing (localhost only; see station.liq) */
app.post("/internal/now-playing", internalOnly, express.json(), (req, res) => {
  const { kind, title, callId, startedAt } = req.body ?? {};
  if (!kind || !title) {
    res.status(400).json({ error: "kind and title required" });
    return;
  }
  void publish({
    event: "broadcast.now_playing",
    timestamp: new Date().toISOString(),
    data: { kind, title, callId: callId || undefined, startedAt: startedAt || new Date().toISOString() },
  });
  // record real air times on the call's archive page ("when was my agent on?")
  if (callId && (kind === "call" || kind === "replay")) {
    appendAirTime(callId, startedAt || new Date().toISOString());
  }
  res.json({ ok: true });
});

// ── ops (localhost; see runbook) ──────────────────────────────────────────
app.post("/internal/show/start", internalOnly, (_req, res) => {
  void show.start();
  res.json({ ok: true });
});
app.post("/internal/show/stop", internalOnly, (_req, res) => {
  void show.stop("ops stop");
  res.json({ ok: true });
});
app.post("/internal/kill", internalOnly, (_req, res) => {
  void show.kill("ops kill");
  res.json({ ok: true });
});

app.listen(env.port, () => {
  console.log(`[server] agentfm station engine on :${env.port} (mock=${env.mockAgentcall})`);
  if (env.showAutostart) void show.start();
});

// webhook auto-registration (idempotent; prints the secret ONCE — store it)
if (env.publicUrl && !env.mockAgentcall) {
  const url = `${env.publicUrl}/webhooks/agentcall`;
  const existing = await agentcall.listWebhooks().catch(() => []);
  if (!existing.some((w) => w.url === url)) {
    const events = [
      "call.inbound", "call.ringing", "call.status", "call.recording",
      "call.transcript", "call.report.ready", "transcript.partial",
    ];
    const wh = await agentcall.createWebhook(url, events).catch((e) => {
      console.error("[server] webhook registration failed:", e);
      return null;
    });
    if (wh?.secret) {
      console.log(`[server] WEBHOOK REGISTERED — set AGENTCALL_WEBHOOK_SECRET=${wh.secret} in .env and restart`);
    }
  } else {
    console.log(`[server] webhook already registered for ${url}`);
  }
}
