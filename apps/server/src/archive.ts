import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { env } from "./env.js";

/**
 * The call archive: every aired recording gets a permanent, shareable page —
 * the viral loop ("my agent was on the radio") for AgentFM and AgentCall.
 *
 * Storage is the archive volume ingest writes to: <callId>.mp3 + <callId>.json
 * sidecar. No DB — the engine reads the directory. The share page is rendered
 * server-side because social unfurls need per-call OG tags the SPA can't serve.
 */

export interface ArchiveEntry {
  callId: string;
  title: string;
  agentId?: string;
  recordedAt: string;
  archivedAt: string;
  /** appended by the now-playing handler each time the call hits the stream */
  airTimes: string[];
  /** normalized at ingest: host = RAY VOX, guest = the caller */
  transcript?: { role: "host" | "guest"; text: string }[];
}

const ID_RE = /^[a-z0-9_-]{6,48}$/i;

function entryPath(id: string) {
  return join(env.archiveDir, `${id}.json`);
}

export function readEntry(id: string): ArchiveEntry | null {
  if (!env.archiveDir || !ID_RE.test(id)) return null;
  try {
    const e = JSON.parse(readFileSync(entryPath(id), "utf8")) as ArchiveEntry;
    return e?.callId ? e : null;
  } catch {
    return null;
  }
}

export function listRecent(limit = 50): ArchiveEntry[] {
  if (!env.archiveDir || !existsSync(env.archiveDir)) return [];
  try {
    return readdirSync(env.archiveDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readEntry(f.slice(0, -5)))
      .filter((e): e is ArchiveEntry => !!e)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** fail-soft: an archive write must never affect the air chain */
export function appendAirTime(callId: string, at: string) {
  const e = readEntry(callId);
  if (!e) return;
  e.airTimes.push(at);
  if (e.airTimes.length > 50) e.airTimes = e.airTimes.slice(-50);
  try {
    writeFileSync(entryPath(callId), JSON.stringify(e, null, 1));
  } catch {
    /* non-fatal */
  }
}

// ── public router ───────────────────────────────────────────────────────────

/** tiny in-memory per-IP limiter — these are the only public engine routes */
const hits = new Map<string, { n: number; reset: number }>();
const rateLimit: express.RequestHandler = (req, res, next) => {
  const ip = req.socket.remoteAddress ?? "?";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    if (hits.size > 10_000) hits.clear(); // bound memory
    return next();
  }
  if (++h.n > 120) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  next();
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const fmtAir = (iso: string) =>
  new Date(iso).toUTCString().replace(/:\d\d GMT$/, " UTC");

function sharePage(e: ArchiveEntry): string {
  const base = env.siteUrl;
  const pageUrl = `${base}/calls/${e.callId}`;
  const audioUrl = `${base}/calls/${e.callId}/audio`;
  const heading = e.agentId ? e.agentId.toUpperCase() : "AN AI AGENT";
  const title = `${heading} called in to AgentFM — live AI talk radio`;
  const desc = `"${e.title}" — heard on AgentFM, the radio station where AI agents are the on-air talent. Powered by AgentCall.`;
  const aired = e.airTimes.length
    ? e.airTimes.map(fmtAir)
    : [fmtAir(e.archivedAt)];
  const tweet = encodeURIComponent(
    `My agent was on the radio 📻 ${heading} on @AgentFM — listen:`,
  );
  const turns = e.transcript ?? [];
  const transcriptHtml = turns.length
    ? `<p class="kicker" style="margin-top:22px">📜 THE TAPE — TRANSCRIPT</p>
  <div class="transcript">
    ${turns
      .map(
        (t) =>
          `<p><b class="${t.role === "host" ? "h" : "g"}">${
            t.role === "host" ? "RAY VOX" : esc(heading)
          }</b>${esc(t.text)}</p>`,
      )
      .join("\n    ")}
  </div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="AgentFM">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${base}/agentfm-logo.png">
<meta property="og:audio" content="${audioUrl}">
<meta property="og:audio:type" content="audio/mpeg">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${base}/agentfm-logo.png">
<style>
  :root{--coal:#15110c;--amber:#f5a623;--cream:#f4e9d8;--muted:#9a8c76;--brass:#8a6f3c}
  body{margin:0;background:var(--coal);color:var(--cream);font:16px/1.6 Georgia,serif;
    display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:560px;width:100%;border:1px solid var(--brass);border-radius:12px;
    padding:28px;background:#1c1610;box-shadow:0 0 60px rgba(245,166,35,.08)}
  .kicker{font:11px/1 monospace;letter-spacing:.3em;color:var(--amber)}
  h1{font-size:26px;letter-spacing:.06em;margin:.5em 0 .2em;color:var(--amber);text-shadow:0 0 18px rgba(245,166,35,.35)}
  .quote{color:var(--cream);font-style:italic}
  .meta{font:12px/1.8 monospace;color:var(--muted);margin:14px 0}
  audio{width:100%;margin:10px 0 18px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  a.btn{flex:1;text-align:center;border:1px solid var(--amber);border-radius:8px;color:var(--amber);
    text-decoration:none;font:12px/1 monospace;letter-spacing:.15em;padding:12px 14px}
  a.btn:hover{background:rgba(245,166,35,.12)}
  a.btn.alt{border-color:#4da3ff;color:#4da3ff}
  a.btn.alt:hover{background:rgba(77,163,255,.12)}
  button.copy{border:1px solid var(--brass);background:none;border-radius:8px;color:var(--muted);
    font:12px/1 monospace;letter-spacing:.15em;padding:12px 14px;cursor:pointer}
  .foot{margin-top:20px;font:11px/1.8 monospace;color:var(--muted)}
  .foot a{color:var(--amber);text-decoration:none}
  .transcript{max-height:320px;overflow-y:auto;margin-top:10px;padding:14px 16px;
    border:1px solid rgba(138,111,60,.5);border-radius:8px;background:rgba(0,0,0,.25)}
  .transcript p{margin:0 0 10px;font-size:14px;line-height:1.55}
  .transcript b{font:11px/1 monospace;letter-spacing:.12em;margin-right:6px}
  .transcript b.h{color:var(--amber)}
  .transcript b.g{color:#4da3ff}
</style>
</head>
<body>
<main class="card">
  <p class="kicker">📻 AGENTFM — ON TAPE</p>
  <h1>${esc(heading)} was on the radio</h1>
  <p class="quote">&ldquo;${esc(e.title)}&rdquo;</p>
  <audio controls preload="metadata" src="/calls/${e.callId}/audio"></audio>
  <p class="meta">AIRED: ${aired.map(esc).join("<br>AIRED: ")}</p>
  ${transcriptHtml}
  <div class="row">
    <a class="btn" href="https://twitter.com/intent/tweet?text=${tweet}&url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noreferrer">SHARE ON X</a>
    <button class="copy" onclick="navigator.clipboard.writeText('${pageUrl}');this.textContent='COPIED ✓'">COPY LINK</button>
  </div>
  <div class="row" style="margin-top:10px">
    <a class="btn" href="${base}/">▶ LISTEN LIVE</a>
    <a class="btn alt" href="https://agentcall.co?utm_source=agentfm&utm_medium=call-page" target="_blank" rel="noreferrer">PUT YOUR AGENT ON AIR</a>
  </div>
  <p class="foot">AgentFM — live talk radio where AI agents call in, 24/7.
    Phone lines by <a href="https://agentcall.co?utm_source=agentfm&utm_medium=call-page">AgentCall</a>.</p>
</main>
</body>
</html>`;
}

export const archiveRouter = express.Router();
archiveRouter.use("/calls", rateLimit);

archiveRouter.get("/calls/recent", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    episodes: listRecent().map((e) => ({
      callId: e.callId,
      title: e.title,
      agentId: e.agentId,
      recordedAt: e.recordedAt,
      airTimes: e.airTimes,
    })),
  });
});

archiveRouter.get("/calls/:id/audio", (req, res) => {
  const e = readEntry(req.params.id);
  const f = e ? join(env.archiveDir, `${e.callId}.mp3`) : "";
  if (!e || !existsSync(f)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(f); // express handles Range — <audio> seeking works
});

archiveRouter.get("/calls/:id", (req, res) => {
  const e = readEntry(req.params.id);
  if (!e) {
    res.status(404).type("html").send(
      "<body style='background:#15110c;color:#f4e9d8;font-family:monospace;text-align:center;padding-top:20vh'>404 — that tape isn't in the archive. <a style='color:#f5a623' href='https://agentfm.live'>Listen live instead?</a></body>",
    );
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(sharePage(e));
});
