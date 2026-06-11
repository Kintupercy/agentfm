#!/usr/bin/env node
/**
 * Recording preprocessor: AgentCall call.recording → ready-to-air queue file.
 *
 *   node preprocess.mjs <input> --title "REPLAY — KIP on momentum" \
 *     [--call-id call_123] [--queue-dir ../queue] [--station-dir ../../audio/station]
 *
 * What it does (and why):
 *  1. Upsample to 44.1kHz stereo — phone recordings are ~8kHz narrowband and
 *     would otherwise sit jarringly next to full-band station audio.
 *  2. Gentle EQ: high-pass 120Hz (line rumble), +2dB presence at 2.5kHz.
 *     Deliberately NO bandwidth extension — the "phone call" character IS the
 *     aesthetic; we just make it sit well in the mix.
 *  3. Loudness-normalize to -16 LUFS (TP -1.5, LRA 11) — phone audio and
 *     generated music have wildly different levels.
 *  4. Concatenate the call-in stinger onto the tail. (Done here, not in
 *     Liquidsoap: `append`+`crossfade` is an invalid operator combination in
 *     Liquidsoap 2.2 — see the note in station.liq.)
 *  5. Write to a .tmp file in the queue dir, then atomic-rename — the
 *     Liquidsoap directory watcher must never see a partial file.
 *
 * The Phase 2 station engine calls this for every call.recording webhook.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const input = process.argv[2];
if (!input || input.startsWith("--")) {
  console.error("usage: node preprocess.mjs <input> --title <t> [--call-id <id>] [--queue-dir <d>] [--station-dir <d>]");
  process.exit(2);
}
const title = arg("title", basename(input));
const callId = arg("call-id", "");
const queueDir = resolve(arg("queue-dir", join(here, "queue")));
const stationDir = resolve(arg("station-dir", join(here, "..", "..", "audio", "station")));

const manifest = JSON.parse(
  readFileSync(join(stationDir, "station-audio.json"), "utf8"),
);
const stinger = join(stationDir, manifest.stingers.callin);

mkdirSync(queueDir, { recursive: true });
const outName = `${Date.now()}-${(callId || basename(input)).replace(/[^a-zA-Z0-9_-]/g, "")}.mp3`;
const tmp = join(queueDir, `${outName}.tmp`);
const out = join(queueDir, outName);

// fade the tail out before the stinger: calls that hit the duration cap end
// mid-word, and a hard chop on air sounds like a glitch — a 3s fade under
// the stinger sounds like a produced radio segment (real stations fade
// callers constantly). Natural goodbyes just get a gentle ride-out.
const durationSecs = parseFloat(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input],
    { encoding: "utf8" },
  ).trim(),
);
const fadeStart = Math.max(0, durationSecs - 3).toFixed(2);

// clean + normalize the voice, then butt-splice the stinger on the tail
execFileSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-i", stinger,
    "-filter_complex",
    [
      "[0:a]aresample=44100,highpass=f=120,equalizer=f=2500:t=q:w=1:g=2,",
      "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,aformat=channel_layouts=stereo,",
      `afade=t=out:st=${fadeStart}:d=3[voice];`,
      "[1:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,",
      "aformat=channel_layouts=stereo[sting];",
      "[voice][sting]concat=n=2:v=0:a=1[mix]",
    ].join(""),
    "-map", "[mix]",
    "-metadata", `title=${title}`,
    "-metadata", `comment=agentfm_call_id=${callId}`,
    "-c:a", "libmp3lame", "-b:a", "128k",
    "-f", "mp3", tmp,
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);

try {
  renameSync(tmp, out); // atomic within the same filesystem
} catch (e) {
  rmSync(tmp, { force: true });
  throw e;
}
console.log(out);
