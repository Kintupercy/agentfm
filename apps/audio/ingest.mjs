#!/usr/bin/env node
/**
 * Recording ingest worker: AgentCall → the air queue. Polls the REST API for
 * completed inbound calls on the station number, downloads each recording,
 * runs preprocess.mjs (loudnorm + EQ + stinger), and drops the result into
 * the Liquidsoap queue dir. No webhooks needed — this is what lets the
 * stream go live before the Phase 2 station engine exists.
 *
 *   node ingest.mjs [--once]
 *
 * Env (from repo .env or process env): AGENTCALL_API_KEY, STATION_NUMBER,
 * optional AGENTCALL_API_URL, AGENTFM_INGEST_POLL_MS (default 30000),
 * AGENTFM_QUEUE_DIR.
 *
 * State: .ingest-state.json (gitignored) maps callId → aired | no_recording,
 * so restarts never double-air a call. Calls with no recording are retried
 * until they're 2h old (covers slow uploads AND the currently-open AgentCall
 * inbound-recording bug — once that's fixed server-side, this worker starts
 * airing calls with no changes here).
 */
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

// minimal .env loader (no deps)
function loadEnv() {
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();

const API = process.env.AGENTCALL_API_URL || "https://api.agentcall.co";
const KEY = process.env.AGENTCALL_API_KEY;
const STATION = process.env.STATION_NUMBER;
const POLL_MS = Number(process.env.AGENTFM_INGEST_POLL_MS || 30000);
const QUEUE_DIR = process.env.AGENTFM_QUEUE_DIR || join(here, "queue");
// permanent archive feeding the shareable call pages (engine serves it)
const ARCHIVE_DIR = process.env.AGENTFM_ARCHIVE_DIR || "";
// state file — keep on a persistent volume in production so redeploys don't
// re-scan the whole call history and re-air old recordings
const STATE_DIR = process.env.AGENTFM_INGEST_STATE_DIR || here;
const STATE_FILE = join(STATE_DIR, ".ingest-state.json");
const RETRY_WINDOW_MS = 2 * 60 * 60 * 1000;
// only air calls that completed recently — for a live show recordings air
// within ~1 min, so this just stops a fresh container from dumping the entire
// backlog of old test calls onto the stream
const MAX_AGE_MS = Number(process.env.AGENTFM_INGEST_MAX_AGE_MINS || 30) * 60_000;

if (!KEY || !STATION) {
  console.error("ingest: AGENTCALL_API_KEY and STATION_NUMBER are required (.env)");
  process.exit(2);
}

const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : { processed: {} };
const saveState = () =>
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));

async function api(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  return { status: res.status, body: await res.json().catch(() => null), res };
}

async function cycle() {
  const { status, body } = await api("/v1/calls/?limit=25");
  if (status !== 200) {
    console.error(`ingest: list_calls ${status} — skipping cycle`);
    return;
  }
  const candidates = (body.data || []).filter(
    (c) =>
      c.direction === "inbound" &&
      c.to === STATION &&
      c.status === "completed" &&
      !state.processed[c.id],
  );

  for (const call of candidates) {
    const age = Date.now() - new Date(call.createdAt).getTime();
    // skip stale backlog (old test calls) — mark processed so it sticks
    if (age > MAX_AGE_MS) {
      state.processed[call.id] = "too_old";
      saveState();
      continue;
    }
    const rec = await api(`/v1/calls/${call.id}/recording`);
    const url =
      rec.body?.recordingUrl || rec.body?.url || rec.body?.signedUrl ||
      call.recordingUrl;

    if (rec.status !== 200 || !url) {
      if (age > RETRY_WINDOW_MS) {
        state.processed[call.id] = "no_recording";
        saveState();
        console.log(`ingest: ${call.id} gave up (no recording after 2h)`);
      } else {
        console.log(`ingest: ${call.id} recording not ready, will retry`);
      }
      continue;
    }

    // title: orchestrator-tagged agentId first (metadata is copied across
    // legs by AgentCall), then transcript callerName, then caller number
    let title = `REPLAY — ${call.metadata?.agentId || call.from}`;
    const t = await api(`/v1/calls/${call.id}/transcript`);
    const s = t.body?.summary;
    if (s) {
      const who = call.metadata?.agentId || s.callerName || call.from;
      title = `REPLAY — ${who}: ${(s.intent || "on air").replace(/_/g, " ")}`;
      if (s.spam) {
        state.processed[call.id] = "skipped_spam";
        saveState();
        console.log(`ingest: ${call.id} flagged spam — not airing`);
        continue;
      }
    }

    const tmp = join(here, `.download-${call.id}.bin`);
    try {
      const audio = await fetch(url);
      if (!audio.ok) throw new Error(`download ${audio.status}`);
      writeFileSync(tmp, Buffer.from(await audio.arrayBuffer()));
      execFileSync(
        "node",
        [join(here, "preprocess.mjs"), tmp,
          "--title", title, "--call-id", call.id, "--queue-dir", QUEUE_DIR,
          ...(ARCHIVE_DIR ? ["--archive-dir", ARCHIVE_DIR] : [])],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      if (ARCHIVE_DIR) {
        // metadata sidecar for the share page — never expose phone numbers
        const publicTitle = title
          .replace(/^REPLAY — /, "")
          .replace(/\+?\d{7,15}/g, "a caller");
        // transcript roles are leg-relative; we consume the INBOUND leg, so
        // ai = the host. Normalize so the share page needs no leg logic.
        const turns = (Array.isArray(t.body?.transcript) ? t.body.transcript : [])
          .map((x) => ({
            role: x.role === "ai" ? "host" : "guest",
            text: String(x.text ?? "").replace(/\+?\d{7,15}/g, "[number]"),
          }))
          .filter((x) => x.text)
          .slice(0, 500);
        writeFileSync(
          join(ARCHIVE_DIR, `${call.id}.json`),
          JSON.stringify({
            callId: call.id,
            title: publicTitle,
            agentId: call.metadata?.agentId || undefined,
            recordedAt: call.createdAt,
            archivedAt: new Date().toISOString(),
            airTimes: [],
            transcript: turns,
          }, null, 1),
        );
      }
      state.processed[call.id] = "aired";
      saveState();
      console.log(`ingest: ${call.id} → queue ("${title}")`);
    } catch (e) {
      console.error(`ingest: ${call.id} failed (${e.message}) — will retry`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
}

mkdirSync(QUEUE_DIR, { recursive: true });
console.log(`ingest: station ${STATION}, queue ${QUEUE_DIR}, poll ${POLL_MS}ms`);
await cycle().catch((e) => console.error("ingest:", e.message));
if (!process.argv.includes("--once")) {
  setInterval(() => cycle().catch((e) => console.error("ingest:", e.message)), POLL_MS);
}
