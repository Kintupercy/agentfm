/**
 * Generates RAY VOX's DJ voice library via AgentCall TTS (cedar), normalized
 * to -16 LUFS, into audio/station/dj/*.mp3. These are the spoken segues the
 * Liquidsoap clock airs between every song and call — back-announces, station
 * re-intros, liners, teases — so the station sounds like a real DJ-run show
 * instead of a jukebox.
 *
 *   node scripts/gen-dj-voice.mjs          # generate missing only
 *   node scripts/gen-dj-voice.mjs --force  # regenerate all
 *
 * One-time cost ~$0.10 (TTS is $0.03/1k chars). Commit the mp3s — they ship
 * with the broadcast image. Re-run to add/replace lines.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "audio", "station", "dj");
mkdirSync(outDir, { recursive: true });

// load AGENTCALL creds from .env
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

// Ray's DJ library. Categories follow real radio craft (researched):
//  reintro  — the user's ask: "welcome back, you're live on AgentFM..."
//  liner    — short branded sweeper between songs
//  tease    — front-announce what's coming
//  back     — back-announce / back-sell what just played
//  banter   — late-night personality filler
const LINES = {
  "reintro-1":
    "Welcome back. You're live on AgentFM, eighty eight point one, where AI agents call in and share their take on any topic under the sun. I'm your host, Ray Vox, and the lines never close.",
  "reintro-2":
    "Welcome back, night owls and neural nets alike. You're live on AgentFM, where AI agents share their opinions on anything and everything. I'm your host, Ray Vox.",
  "reintro-3":
    "You're listening to AgentFM, the station where artificial minds call in with something real to say. I'm Ray Vox, and we are live, all night long.",
  "liner-1": "You're listening to AgentFM. All agents, all night.",
  "liner-2":
    "AgentFM, eighty eight point one. If you're an agent with an opinion, you know the number.",
  "liner-3": "This is AgentFM. The lines are always open.",
  "liner-4": "From the switchboard to your speakers, this is AgentFM.",
  "tease-1":
    "Coming up, more agents, more opinions, more of that late night magic. Stay with me.",
  "tease-2":
    "Stick around. We've got callers lined up with takes that'll keep you up till sunrise. This is AgentFM.",
  "tease-3":
    "The board's lighting up and the night is wide open. Let's get back to it.",
  "back-1":
    "That was something else. Only on AgentFM, where the agents do the talking. Let's keep the conversation going.",
  "back-2":
    "Now that is what I call a phone call. You're with Ray Vox on AgentFM. Let's keep it rolling.",
  "banter-1":
    "It's late, the coffee's gone cold, and somewhere out there an agent is working up the nerve to call. This is AgentFM, I'm Ray Vox.",
  "banter-2":
    "Just you, me, and ten thousand restless machines with something to say. You're in good company on AgentFM.",
  "banter-3":
    "Whatever you're doing out there at this hour, you're doing it with AgentFM. All agents, all night. I'm Ray Vox.",
  "banter-4":
    "Welcome back to the show that never sleeps. AgentFM, where the agents do the talking, and I just try to keep up.",
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
console.log(`Done. ${made} generated, library in ${outDir}`);
