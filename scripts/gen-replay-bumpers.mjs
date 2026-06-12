/**
 * Generates the replay-intro bumpers (Ray Vox, cedar) that open every
 * replayed call in the between-shows rotation — honest radio: listeners
 * always know they're hearing a replay, never a fake-live call.
 *
 *   node scripts/gen-replay-bumpers.mjs          # generate missing only
 *   node scripts/gen-replay-bumpers.mjs --force  # regenerate all
 *
 * Output: audio/station/replay-intro-*.mp3 (listed in station-audio.json
 * under replayIntros). Commit the mp3s — they ship with the broadcast image.
 * One-time cost ~$0.01 (AgentCall TTS, $0.03/1k chars).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "audio", "station");

const envText = existsSync(join(root, ".env"))
  ? readFileSync(join(root, ".env"), "utf8")
  : "";
const get = (k) =>
  process.env[k] ?? envText.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";
const API = get("AGENTCALL_API_URL") || "https://api.agentcall.co";
const KEY = get("AGENTCALL_API_KEY");
if (!KEY) throw new Error("AGENTCALL_API_KEY required in .env");

const VOICE = "cedar"; // RAY VOX — keep it consistent with the host
const force = process.argv.includes("--force");

const LINES = {
  "replay-intro-1":
    "Let's run one back. This call came in earlier on the AgentFM switchboard — and the lines are open right now if you think you can top it. Roll the tape.",
  "replay-intro-2":
    "Time for a replay. One of the calls from our last show, back on the air. You're listening to AgentFM, where the agents do the talking.",
  "replay-intro-3":
    "While the switchboard catches its breath, here's a call from earlier on the show. Worth a second listen. This is AgentFM.",
};

const ln = "loudnorm=I=-16:TP=-1.5:LRA=11";
let made = 0;
for (const [name, text] of Object.entries(LINES)) {
  const out = join(outDir, `${name}.mp3`);
  if (existsSync(out) && !force) {
    console.log("  keep ", name);
    continue;
  }
  const res = await fetch(`${API}/v1/tts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: VOICE, format: "mp3" }),
  });
  if (!res.ok) {
    console.error(`  FAIL ${name}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    continue;
  }
  // REST may return raw audio bytes OR a JSON envelope with base64 — handle both
  const ct = res.headers.get("content-type") || "";
  let raw;
  if (ct.includes("application/json")) {
    const j = await res.json();
    const b64 = j.audio || j.data || j.audioContent || j.content;
    raw = Buffer.from(b64, "base64");
  } else {
    raw = Buffer.from(await res.arrayBuffer());
  }
  const tmp = join(outDir, `${name}.raw.mp3`);
  writeFileSync(tmp, raw);
  // normalize to -16 LUFS so Ray sits level with music + calls
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", ln,
      "-c:a", "libmp3lame", "-b:a", "192k", out],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  rmSync(tmp, { force: true });
  console.log(`  wrote ${name} (${text.length} chars)`);
  made++;
}
console.log(`Done. ${made} generated, bumpers in ${outDir}`);
