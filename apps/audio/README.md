# AgentFM broadcast engine

Liquidsoap mixes normalized **call recordings** (post-call, via `call.recording`)
with **station audio** into the continuous public stream. The board on the
website is truly live; the audio runs a few minutes behind by design.

**Why Icecast (not HLS):** 5–15s latency vs 20–40s, in-band metadata, every
browser plays an MP3 mount through a plain `<audio>` element, and it's one
moving part — no packager, no segment cleanup, no extra nginx config. If CDN
fan-out is ever needed, add `output.file.hls` to `station.liq` without
touching anything else.

## Pieces

| File | Role |
|---|---|
| `station.liq` | the radio automation: format clock, fallback chain, crossfade, now-playing push. Validated against Liquidsoap **2.2.5** (`liquidsoap --check`). |
| `preprocess.mjs` | call recording → air-ready file: 44.1kHz upsample, phone-keeping EQ, **loudnorm −16 LUFS**, call-in stinger baked onto the tail, atomic move into `queue/` |
| `ingest.mjs` | **the calls→air link**: polls AgentCall for completed station calls, downloads recordings, skips spam-flagged callers, runs preprocess into `queue/`. No webhooks needed. `node ingest.mjs --once` to test. |
| `docker-compose.yml` | local Icecast + Liquidsoap stack for development |
| `icecast.xml` | sample config for bare-metal Icecast on the VPS |
| `systemd/agentfm-liquidsoap.service` | the VPS unit |
| `../../audio/station/station-audio.json` | station audio manifest (IDs, bumpers, stingers, beds, emergency loop) |

## Format clock (v1)

```
top of hour → station ID
then, per queued recording:   bumper → call replay (stinger pre-baked on tail)
between recordings:           music beds + a fake-1950s ad break (~every 4th
                              track) ← also the "callers on hold" theater
nothing at all to play:       emergency loop → mksafe silence (never reached)
```

Real assets (beds, sung IDs, the fake ad spots) are produced with AI music
tools — full track list, Suno prompts, and loudness specs in
[docs/station-audio-production.md](../../docs/station-audio-production.md).

Dead-air insurance is the `fallback()` chain: **queue → beds → emergency →
silence**. The stream survives an orchestrator crash, an empty queue on day
one, and a missing asset.

Host interstitials are on-screen ticker text in v1 — AgentCall exposes no
standalone TTS endpoint (verified against the live tool catalog; voices exist
only inside calls). When AgentCall's action bridge reaches voice, mix spoken
interstitials over a ducked bed here.

Two empirical Liquidsoap 2.2 gotchas encoded in `station.liq` — don't undo them:
- `append` + `crossfade` is rejected ("source may control its own latency"),
  which is why the stinger is baked on by `preprocess.mjs` instead.
- Records/calls must not have trailing commas.

## Local dev

```bash
npm run gen:audio                  # placeholder station assets (repo root)
cd apps/audio && docker compose up # stream at http://localhost:8000/agentfm
# hear it in the web app:
VITE_STREAM_URL=http://localhost:8000/agentfm npm run demo
# feed it a fake call:
ffmpeg -f lavfi -i "sine=frequency=300:duration=6" -ar 8000 -ac 1 /tmp/fake.wav
node preprocess.mjs /tmp/fake.wav --title "REPLAY — TEST" --call-id call_001
```

## VPS deploy (Ubuntu)

```bash
sudo apt install icecast2 liquidsoap ffmpeg     # liquidsoap >= 2.2
sudo useradd -r -m -d /srv/agentfm agentfm
sudo -u agentfm mkdir -p /srv/agentfm/{queue,played,audio/station}
# copy: station.liq → /srv/agentfm/, audio/station/* → /srv/agentfm/audio/station/
# icecast: merge icecast.xml into /etc/icecast2/icecast.xml, set REAL passwords,
#          put ICECAST_SOURCE_PASSWORD=... in /srv/agentfm/audio.env (chmod 600)
sudo cp systemd/agentfm-liquidsoap.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now icecast2 agentfm-liquidsoap
```

nginx exposes the stream with TLS:

```nginx
location /stream {
  proxy_pass http://127.0.0.1:8000/agentfm;
  proxy_buffering off;
  proxy_read_timeout 1d;
}
```

Set `VITE_STREAM_URL=https://agentfm.live/stream` in the web app build.

## Runbook

| Action | Command |
|---|---|
| start / stop / restart | `sudo systemctl {start,stop,restart} agentfm-liquidsoap agentfm-ingest` |
| logs (live) | `journalctl -u agentfm-liquidsoap -f` |
| what's on air | `cat /srv/agentfm/now-playing.json` |
| skip the current track | `echo "calls_queue.skip" \| nc 127.0.0.1 1234` (telnet server, localhost only) |
| hot-swap a station asset | drop the new file in `/srv/agentfm/audio/station/`, update `station-audio.json`, `systemctl restart agentfm-liquidsoap` (assets are read at startup; restart is a <1s blip behind Icecast's client buffer) |
| drain the air queue | files in `/srv/agentfm/queue/` are claimed into `played/` as they air; delete from `queue/` to pull something before it airs |

## Licensing

ALL station audio must be AI-generated (Suno etc.) or original work —
**no licensed or copyrighted music anywhere in the pipeline.** The committed
manifest ships with synthesized placeholder tones (`npm run gen:audio`) so the
stack runs before real assets exist.
