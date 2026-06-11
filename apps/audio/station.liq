# AgentFM broadcast engine — Liquidsoap 2.2.x
#
# The public stream is NOT the live calls: it mixes normalized call RECORDINGS
# (which arrive post-call via AgentCall's call.recording webhook, preprocessed
# by preprocess.mjs) with station audio into a continuous radio feed.
#
# Format clock (v1, pragmatic):
#   • station ID once at the top of each hour (first track boundary in 0m-2m)
#   • bumper → call recording → call-in stinger, for every queued recording
#   • music bed between calls (this doubles as "callers on hold" theater —
#     there is NO telephony hold music and none is needed; queue slots are
#     registered dial windows, not parked calls)
#   • host interstitials are on-screen ticker text in v1 (AgentCall exposes no
#     standalone TTS — see docs/agentcall-api-notes.md). When in-call voice
#     actions / TTS ship, mix them here over the bed with ducking, e.g.:
#     add(normalize=false, [amplify(0.25, bed), interstitial_voice])
#
# Fallback chain (dead-air insurance — the stream must NEVER go silent):
#   calls queue → music beds → emergency loop → mksafe silence
#
# Orchestrator interface: a watched directory. The station engine drops
# ready-to-air files (normalized, ID3-titled) into AGENTFM_QUEUE_DIR using
# write-to-temp-then-rename (preprocess.mjs does this). We claim each file by
# moving it to AGENTFM_PLAYED_DIR before playback, so a crash never replays
# or loses a file. Simplest reliable mechanism; no telnet protocol to babysit.
#
# Validate after edits:  liquidsoap --check station.liq   (or via docker, see README)

settings.log.stdout := true
settings.server.telnet := true                # ops escape hatch: skip/inspect
settings.server.telnet.bind_addr := "127.0.0.1"

station_dir = environment.get(default="/srv/agentfm/audio/station", "AGENTFM_STATION_AUDIO")
queue_dir   = environment.get(default="/srv/agentfm/queue",  "AGENTFM_QUEUE_DIR")
played_dir  = environment.get(default="/srv/agentfm/played", "AGENTFM_PLAYED_DIR")
np_file     = environment.get(default="/srv/agentfm/now-playing.json", "AGENTFM_NOW_PLAYING_FILE")
np_url      = environment.get(default="", "AGENTFM_NOW_PLAYING_URL")
np_token    = environment.get(default="", "AGENTFM_INTERNAL_TOKEN")

ice_host  = environment.get(default="127.0.0.1", "ICECAST_HOST")
ice_port  = int_of_string(environment.get(default="8000", "ICECAST_PORT"))
ice_pass  = environment.get(default="hackme", "ICECAST_SOURCE_PASSWORD")
ice_mount = environment.get(default="/agentfm", "ICECAST_MOUNT")

# ── station audio package (audio/station/station-audio.json) ────────────────
let json.parse (manifest :
  { ids: [string],
    bumpers: [string],
    stingers: { news: string, callin: string },
    beds: [string],
    ads: [string],
    emergency: string }) = file.contents("#{station_dir}/station-audio.json")

def full(f) = path.concat(station_dir, f) end

station_ids = playlist.list(mode="randomize", list.map(full, manifest.ids))
bumpers     = playlist.list(mode="randomize", list.map(full, manifest.bumpers))
beds        = playlist.list(mode="randomize", list.map(full, manifest.beds))
ads         = playlist.list(mode="randomize", list.map(full, manifest.ads))
emergency   = single(full(manifest.emergency))

# between-call filler: mostly beds, an ad break roughly every 4th track —
# the fake-1950s-spot comedy layer (see docs/station-audio-production.md)
filler = rotate(weights=[1, 3], [ads, beds])
# NOTE: the call-in stinger is NOT a Liquidsoap source — `append` + `crossfade`
# is an invalid combination in 2.2 ("source may control its own latency"),
# verified empirically. preprocess.mjs concatenates the stinger onto each
# recording instead, which also gives a tighter on-air transition.
ignore(manifest.stingers)

# ── call recordings: watched queue directory ────────────────────────────────
def next_call() =
  files = file.ls(absolute=true, sorted=true, queue_dir)
  files = list.filter(fun (f) -> not (file.is_directory(f)), files)
  if list.length(files) > 0 then
    f = list.hd(default="", files)
    dest = path.concat(played_dir, path.basename(f))
    # claim before play: copy to played/, remove from queue/
    # (single consumer, so copy-then-remove is race-free)
    file.copy(f, dest)
    file.remove(f)
    # queue filenames are "<timestamp>-<callId>.ext" (preprocess.mjs) —
    # recover the callId for the now-playing push
    name = path.remove_extension(path.basename(f))
    call_id = string.concat(separator="-", list.tl(string.split(separator="-", name)))
    request.create("annotate:agentfm_kind=\"call\",agentfm_call_id=\"#{call_id}\":#{dest}")
  else
    null()
  end
end

calls = request.dynamic(id="calls_queue", retry_delay=5., next_call)

# ── spoken host interstitials (TTS, cedar) — optional second watched dir ────
# The station engine drops one-liner mp3s here between calls; each airs once.
inter_dir = environment.get(default="", "AGENTFM_INTERSTITIALS_DIR")
inter_played = environment.get(default="/tmp/inter-played", "AGENTFM_INTERSTITIALS_PLAYED_DIR")

def next_interstitial() =
  try
    if inter_dir == "" then
      null()
    else
      files = file.ls(absolute=true, sorted=true, inter_dir)
      files = list.filter(fun (f) -> not (file.is_directory(f)), files)
      if list.length(files) > 0 then
        f = list.hd(default="", files)
        dest = path.concat(inter_played, path.basename(f))
        file.copy(f, dest)
        file.remove(f)
        request.create("annotate:agentfm_kind=\"interstitial\":#{dest}")
      else
        null()
      end
    end
  catch _ do
    null()
  end
end

interstitials = request.dynamic(id="interstitials_queue", retry_delay=10., next_interstitial)

# bumper into each recording (the stinger out of it is pre-baked onto the
# file by preprocess.mjs — see note above)
program = prepend(calls, fun (_) -> once(bumpers))

# ── hourly station ID ────────────────────────────────────────────────────────
# available only in the first 2 minutes of each hour, and at most once per
# ~hour (delay makes it unavailable for 3500s after a play)
ids_hourly = delay(3500., station_ids)

# ── the chain ────────────────────────────────────────────────────────────────
radio = fallback(track_sensitive=true, [
  switch([({ 0m-2m }, ids_hourly)]),
  program,
  interstitials,
  filler,
  emergency
])

# ── now-playing metadata → station engine → Supabase Realtime ───────────────
def on_track(m) =
  fname = path.basename(m["filename"])
  kind =
    if m["agentfm_kind"] == "call" then "call"
    elsif m["agentfm_kind"] == "interstitial" then "interstitial"
    elsif string.contains(substring="station-id", fname) then "station_id"
    elsif string.contains(substring="bumper", fname) then "bumper"
    elsif string.contains(substring="stinger", fname) then "stinger"
    elsif string.contains(substring="emergency", fname) then "emergency"
    elsif string.contains(substring="ad-", fname) then "ad"
    else "bed"
    end
  title = if m["title"] != "" then m["title"] else fname end
  data = json.stringify({
    kind = kind,
    title = title,
    callId = m["agentfm_call_id"],
    startedAt = time.string("%Y-%m-%dT%H:%M:%SZ")
  })
  # fail-soft: a metadata push must NEVER take down the air (verified the
  # hard way — an unwritable np_file crashed the whole engine without this)
  try
    file.write(data=data, np_file)
  catch _ do
    log(level=2, "now-playing file write failed (non-fatal)")
  end
  if np_url != "" then
    try
      headers =
        if np_token != "" then
          [("Content-Type", "application/json"), ("X-Internal-Token", np_token)]
        else
          [("Content-Type", "application/json")]
        end
      ignore(http.post(data=data, headers=headers, np_url))
    catch _ do
      log(level=2, "now-playing webhook post failed (non-fatal)")
    end
  end
end

# attach BEFORE crossfade: crossfade merges tracks and swallows the
# boundary marks, so a handler attached after it fires only at startup
# (found empirically — the now-playing file froze on the boot track)
radio.on_track(on_track)

radio = crossfade(duration=2., fade_in=0.5, fade_out=1.5, radio)
radio = mksafe(radio)

# ── output: Icecast MP3 mount ────────────────────────────────────────────────
# Icecast over HLS: 5-15s latency vs 20-40s, in-band metadata, plays in every
# browser via a plain <audio> element, one moving part. Add output.file.hls
# here later if CDN fan-out is ever needed.
output.icecast(
  %mp3(bitrate=128),
  host=ice_host, port=ice_port, password=ice_pass, mount=ice_mount,
  name="AgentFM", genre="Talk",
  description="Live talk radio for AI agents — powered by AgentCall",
  url="https://agentfm.live",
  radio
)
