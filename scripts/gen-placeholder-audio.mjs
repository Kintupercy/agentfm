/**
 * Synthesizes placeholder station audio so `npm run demo` and the local
 * Liquidsoap stack work before the real AI-generated assets (Suno etc.)
 * exist. Pure Node, no dependencies — writes 16-bit mono WAVs:
 *
 *   audio/station/bed-*.wav         lo-fi chord-loop music beds (~32s, loopable)
 *   audio/station/emergency-loop.wav  60s dead-air insurance loop
 *   audio/station/station-id-*.wav  3-note station motifs
 *   audio/station/bumper-*.wav      short sweeps
 *   audio/station/stinger-*.wav     transition hits (callin = phone-ring cadence)
 *   apps/web/public/demo-bed.wav    copy of bed-1 for the web player demo mode
 *
 * Real assets replace these file-for-file via audio/station/station-audio.json.
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "audio", "station");
const RATE = 22050;

mkdirSync(outDir, { recursive: true });

function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const sec = (s) => Math.floor(s * RATE);

/** lo-fi chord: detuned sine partials + gentle tremolo + tape hiss */
function bed(progression, totalSec, gain = 0.22) {
  const out = new Float32Array(sec(totalSec));
  const chordLen = sec(totalSec / progression.length);
  for (let c = 0; c < progression.length; c++) {
    const freqs = progression[c];
    for (let i = 0; i < chordLen; i++) {
      const t = i / RATE;
      const idx = c * chordLen + i;
      if (idx >= out.length) break;
      // soft attack/release so the loop point doesn't click
      const env =
        Math.min(1, i / sec(0.8)) * Math.min(1, (chordLen - i) / sec(0.8));
      let v = 0;
      for (const f of freqs) {
        v += Math.sin(2 * Math.PI * f * t);
        v += 0.35 * Math.sin(2 * Math.PI * (f * 1.003) * t); // detune shimmer
        v += 0.12 * Math.sin(2 * Math.PI * f * 2 * t); // octave partial
      }
      const tremolo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.35 * (idx / RATE));
      const hiss = (Math.random() - 0.5) * 0.012;
      out[idx] = (v / (freqs.length * 1.5)) * env * tremolo * gain + hiss;
    }
  }
  return out;
}

function tone(freq, durSec, { gain = 0.5, decay = 4 } = {}) {
  const out = new Float32Array(sec(durSec));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] =
      gain *
      Math.exp(-decay * t) *
      (Math.sin(2 * Math.PI * freq * t) +
        0.3 * Math.sin(2 * Math.PI * freq * 2 * t));
  }
  return out;
}

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function sweep(f0, f1, durSec, gain = 0.4) {
  const out = new Float32Array(sec(durSec));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const k = t / durSec;
    const f = f0 * Math.pow(f1 / f0, k);
    const env = Math.sin(Math.PI * k); // fade in+out
    out[i] = gain * env * Math.sin(2 * Math.PI * f * t);
  }
  return out;
}

const A = 220, C4 = 261.63, D4 = 293.66, E4 = 329.63, F4 = 349.23,
  G4 = 392, B3 = 246.94, G3 = 196;

// never clobber: real produced assets (and prior placeholders) are kept —
// this only fills gaps so a fresh clone still demos end-to-end
const write = (name, samples) => {
  const p = join(outDir, name);
  if (existsSync(p)) return console.log("  keep ", name);
  writeFileSync(p, toWav(samples));
  console.log("  wrote", name);
};

console.log("Generating placeholder station audio →", outDir);

// beds: Am7 – Dm7 – G7 – Cmaj7 / and a ii-V-I-vi variant
write("bed-1.wav", bed([
  [A, C4, E4, G4],
  [D4 / 2 + 73.42, F4, A, C4], // Dm7-ish voicing
  [G3, B3, D4, F4],
  [C4 / 2 + 65.4, E4, G4, B3 * 2],
], 32));
write("bed-2.wav", bed([
  [D4, F4, A, C4],
  [G3, B3, F4, A],
  [C4, E4, G4, B3 * 2],
  [A, C4, E4, G4],
], 36, 0.2));
write("emergency-loop.wav", bed([
  [A, C4, E4],
  [F4 / 2 + 87.3, A, C4],
  [G3, B3, D4],
  [E4 / 2 + 82.4, G4, B3],
], 60, 0.16));

// station IDs: rising 3-note motif
write("station-id-1.wav", concat([
  tone(E4 * 2, 0.5), tone(G4 * 2, 0.5), tone(B3 * 4, 1.6, { decay: 2 }),
]));
write("station-id-2.wav", concat([
  tone(A * 2, 0.4), tone(C4 * 2, 0.4), tone(E4 * 2, 0.4),
  tone(A * 4, 1.8, { decay: 2 }),
]));

// bumpers: short character sweeps
write("bumper-1.wav", sweep(200, 1600, 3));
write("bumper-2.wav", sweep(1400, 300, 3.5));
write("bumper-3.wav", concat([sweep(300, 900, 1.5), sweep(900, 500, 1.5)]));
write("bumper-4.wav", concat([tone(G4, 0.3), tone(D4, 0.3), tone(G4 * 2, 2, { decay: 3 })]));

// ad-break placeholders: jaunty jingle-ish tone sequences (~10s) standing in
// for the produced fake-1950s spots (see docs/station-audio-production.md)
write("ad-1.wav", concat([
  tone(C4 * 2, 0.35), tone(E4 * 2, 0.35), tone(G4 * 2, 0.35), tone(C4 * 4, 0.8, { decay: 2.5 }),
  bed([[C4, E4, G4], [F4, A, C4]], 6, 0.18),
  tone(G4 * 2, 0.3), tone(C4 * 4, 1.2, { decay: 2 }),
]));
write("ad-2.wav", concat([
  tone(D4 * 2, 0.3), tone(D4 * 2, 0.3), tone(A * 2, 0.6, { decay: 3 }),
  bed([[D4, F4, A], [G3, B3, D4]], 6, 0.18),
  tone(A * 2, 0.3), tone(D4 * 4, 1.2, { decay: 2 }),
]));

// stingers — callin is a nod to a US ringback tone (440+480 Hz)
write("stinger-news.wav", concat([tone(880, 0.25, { decay: 8 }), tone(1320, 1.2, { decay: 5 })]));
const ring = new Float32Array(sec(1.6));
for (let i = 0; i < ring.length; i++) {
  const t = i / RATE;
  const on = t < 1.2 ? 1 : 0;
  ring[i] =
    0.35 * on * Math.exp(-1.2 * t) *
    (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) / 2;
}
write("stinger-callin.wav", ring);

// demo bed for the web player (kept if a real one is already in place)
const demoTarget = join(root, "apps", "web", "public");
mkdirSync(demoTarget, { recursive: true });
const demoBed = join(demoTarget, "demo-bed.wav");
if (!existsSync(demoBed)) {
  copyFileSync(join(outDir, "bed-1.wav"), demoBed);
  console.log("  wrote apps/web/public/demo-bed.wav");
} else {
  console.log("  keep  apps/web/public/demo-bed.wav");
}
console.log("Done.");
