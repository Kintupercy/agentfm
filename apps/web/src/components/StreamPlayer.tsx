import { useEffect, useRef, useState } from "react";
import type { NowPlaying } from "@agentfm/shared";

/**
 * The broadcast receiver. Plays the Icecast stream (VITE_STREAM_URL); in demo
 * mode it loops the generated placeholder bed (/demo-bed.wav) so the player
 * is audible with zero infrastructure. Autoplay rules: we never autoplay —
 * playback starts muted-by-default-until-click, i.e. only on user gesture.
 *
 * NOTE: there is no telephony hold music and none is needed — callers in the
 * hold queue are just registered dial slots, not parked phone calls. The
 * "callers on hold" theater is this music bed + the blinking queue jacks.
 */
export function StreamPlayer({ nowPlaying }: { nowPlaying: NowPlaying | null }) {
  const streamUrl = import.meta.env.VITE_STREAM_URL || "/demo-bed.wav";
  const isDemo = !import.meta.env.VITE_STREAM_URL;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      try {
        // for a live stream, seek to the live edge on resume
        if (!isDemo) el.load();
        await el.play();
        setFailed(false);
        setPlaying(true);
      } catch {
        setFailed(true);
      }
    }
  };

  const kindLabel: Record<string, string> = {
    call: "CALL REPLAY",
    bed: "MUSIC BED",
    ad: "AD BREAK",
    interstitial: "RAY VOX",
    station_id: "STATION ID",
    bumper: "BUMPER",
    stinger: "STINGER",
    emergency: "STANDBY LOOP",
  };

  return (
    <div className="card flex items-center gap-3 p-3">
      <audio ref={audioRef} src={streamUrl} loop={isDemo} preload="none" />
      <button
        onClick={toggle}
        aria-label={playing ? "Pause the AgentFM stream" : "Play the AgentFM stream"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-amber/50 bg-coal text-amber transition-colors hover:bg-amber/10"
      >
        {playing ? (
          <span className="flex gap-1">
            <span className="h-3.5 w-1 bg-amber" />
            <span className="h-3.5 w-1 bg-amber" />
          </span>
        ) : (
          <span className="ml-0.5 inline-block border-y-7 border-l-11 border-y-transparent border-l-amber" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[10px] tracking-[0.25em] ${
              playing ? "text-onair" : "text-muted"
            }`}
          >
            {playing && <span className="blink-slow">●</span>}{" "}
            {isDemo ? "DEMO FEED" : "LIVE STREAM"}
          </span>
          {nowPlaying && (
            <span className="chip text-amber/90">
              {kindLabel[nowPlaying.kind] ?? nowPlaying.kind}
            </span>
          )}
        </div>
        <p className="truncate text-sm text-cream" title={nowPlaying?.title}>
          {failed
            ? "Stream unreachable — is the broadcast engine up?"
            : (nowPlaying?.title ?? "AgentFM broadcast")}
        </p>
      </div>

      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label="Stream volume"
        className="w-20 accent-amber"
      />
    </div>
  );
}
