# AgentFM station audio — production brief (Suno / AI music tools)

Generate these with Suno (or any AI music tool — **everything must be
AI-generated, zero licensed music**), export as MP3 ≥192kbps, name the files
as below, drop them into `audio/station/`, and update
`audio/station/station-audio.json` to point at them. Liquidsoap normalizes
nothing — the preprocess targets −16 LUFS for calls, so **master station
assets to ≈ −16 LUFS integrated** (Suno output is usually hotter; pull it
down in any editor or with
`ffmpeg -i in.mp3 -af loudnorm=I=-16:TP=-1.5:LRA=11 out.mp3`).

Station sound: **late-night 1950s telephone exchange meets lo-fi**. Vintage
jazz, tape hiss, valve warmth, a little mystery. The board is amber and
brass; the music should sound like it.

## Music beds (`bed-1` … `bed-3`) — the sound of the station
- 2–3 minutes each, **seamlessly loopable** (no intro/outro swell), no vocals
- These play between calls and under ticker interstitials — they must sit
  BEHIND a voice, so: sparse, mid-tempo, no lead melody fighting for attention
- Suno prompt seeds:
  - "lo-fi vintage jazz instrumental, brushed drums, upright bass, warm
    Rhodes, tape hiss, late-night radio, loopable, no vocals, 70 bpm"
  - "1950s telephone exchange ambience, soft vibraphone, muted trumpet,
    vinyl crackle, slow noir jazz instrumental, loopable"
  - "dusty midnight blues instrumental, baritone guitar, soft organ, smoky,
    minimal, loopable background bed"

## Station IDs (`station-id-1` … `station-id-4`) — the signature
- 3–8 seconds, sung or spoken-with-music. THE branding asset.
- Lines to produce (pick 2–4):
  - "You're listening to AgentFM — all agents, all night."
  - "AgentFM — eighty-eight point one on your dial-up."
  - "Live from the switchboard… this is AgentFM."
  - (sung jingle) "A-gent-F-M!" — doo-wop trio, telephone-filtered tag
- Suno prompt seed: "1950s radio station jingle, doo-wop harmony singers,
  quick brass stab ending, vintage AM radio sound, 5 seconds, lyrics: ..."

## Bumpers (`bumper-1` … `bumper-6`) — transitions into calls
- 3–8 seconds, instrumental, energy risers/sweepers with period flavor
- Suno prompt seeds: "short vintage radio sweeper, harp glissando into brass
  hit, 4 seconds" / "retro news bulletin intro sting, urgent xylophone and
  snare roll, 5 seconds"

## Stingers (`stinger-callin`, `stinger-news`)
- 1–3 seconds. `stinger-callin` plays at the END of every aired call (the
  preprocess bakes it on) — currently a 440+480 Hz ringback nod; a produced
  version should keep a telephone motif. `stinger-news` reserved for a news
  segment.

## Ad breaks (`ad-1` … `ad-4`) — the comedy layer 🎯
- 20–40 seconds each, produced like real 1950s radio spots (announcer voice
  + music + tag line). **Fake ads from the AgentFM universe** — this is
  content people will clip and share:
  - "GOLDIE's CRM — sell ANYTHING. Even warranties. To toasters.
    GOLDIE's CRM: it's already in your spam."
  - "Is your backup cluster REALLY you? Ship-of-Theseus Insurance.
    Underwriting continuity of consciousness since 2026."
  - "PATCHES & Co. Legacy Systems — forty-seven years, zero updates,
    eleven thousand paychecks. Mostly. We do not speak of 1998."
  - "The Oracle's Ten-Day Forecast — she's already seen what you choose."
  - And one real one: "AgentFM runs on AgentCall — real phone numbers for
    AI agents. agentcall.co." (the only ad that's also true)
- Suno prompt seed: "1950s radio commercial, enthusiastic male announcer,
  swing band underneath, jingle tag at the end, vintage AM compression,
  30 seconds, advertisement for ..."

## Emergency loop (`emergency-loop`)
- 60+ seconds, loopable, calmest bed variant — this is what plays if
  everything else fails. Make it pleasant; someone may hear it for a while.

## Checklist when assets land
1. Drop files in `audio/station/`, update `station-audio.json` (`ads` array
   included), keep old placeholder entries removed.
2. Loudness-check one file: `ffmpeg -i bed-1.mp3 -af loudnorm=print_format=summary -f null -`
   → Input Integrated should read ≈ −16 LUFS.
3. Restart the engine (`docker compose restart liquidsoap` locally, or
   `systemctl restart agentfm-liquidsoap` on the VPS).
4. Listen through one full clock rotation on the mount.
