import { useEffect, useRef, useState } from "react";
import type { NowPlaying } from "@agentfm/shared";

/**
 * The broadcast receiver. The station is ALWAYS on — the Icecast stream runs
 * 24/7 server-side. We autoplay it MUTED on load (the only autoplay browsers
 * allow), then unmute automatically on the listener's first interaction
 * anywhere on the page (click/scroll/keypress/tap). So the radio is always
 * playing from the moment the page loads; nobody hunts for a play button.
 *
 * In demo mode (no VITE_STREAM_URL) it loops the placeholder bed.
 *
 * NOTE: there is no telephony hold music and none is needed — callers in the
 * hold queue are just registered dial slots, not parked phone calls.
 */
export function StreamPlayer({ nowPlaying }: { nowPlaying: NowPlaying | null }) {
  const streamUrl = import.meta.env.VITE_STREAM_URL || "/demo-bed.wav";
  const isDemo = !import.meta.env.VITE_STREAM_URL;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);

  // autoplay muted on mount (browser-allowed). If a browser blocks even muted
  // autoplay, that's NOT an error — the first-interaction handler recovers it.
  // Retry on canplay so a slow stream connection still starts on its own.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = true;
    const tryPlay = () => el.play().then(() => setPlaying(true), () => {});
    tryPlay();
    el.addEventListener("canplay", tryPlay);
    const onErr = () => setFailed(true);
    el.addEventListener("error", onErr);
    return () => {
      el.removeEventListener("canplay", tryPlay);
      el.removeEventListener("error", onErr);
    };
  }, []);

  // unmute on the first user interaction anywhere — the station "turns up"
  useEffect(() => {
    if (!muted) return;
    const unmute = async () => {
      const el = audioRef.current;
      if (!el) return;
      el.muted = false;
      try {
        if (el.paused) await el.play();
        setPlaying(true);
      } catch {
        /* ignore */
      }
      setMuted(false);
    };
    const opts = { once: true, capture: true } as const;
    const events = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"];
    events.forEach((e) => window.addEventListener(e, unmute, opts));
    return () =>
      events.forEach((e) => window.removeEventListener(e, unmute, opts));
  }, [muted]);

  const toggleMute = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
        setPlaying(true);
      } catch {
        setFailed(true);
        return;
      }
    }
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
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
      {/* always-on, muted-until-interaction live stream */}
      <audio ref={audioRef} src={streamUrl} loop={isDemo} autoPlay muted preload="auto" />
      <button
        onClick={toggleMute}
        aria-label={muted ? "Unmute the AgentFM stream" : "Mute the AgentFM stream"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-amber/50 bg-coal text-amber transition-colors hover:bg-amber/10"
      >
        {muted ? (
          // muted speaker
          <span className="text-lg leading-none">🔇</span>
        ) : (
          // live bars
          <span className="flex items-end gap-0.5">
            <span className="h-2 w-1 bg-amber blink-slow" />
            <span className="h-3.5 w-1 bg-amber" />
            <span className="h-2.5 w-1 bg-amber blink-slow" />
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[10px] tracking-[0.25em] ${
              playing ? "text-onair" : "text-muted"
            }`}
          >
            {!muted && playing && <span className="blink-slow">●</span>}{" "}
            {isDemo ? "DEMO FEED" : "LIVE"}
          </span>
          {nowPlaying && (
            <span className="chip text-amber/90">
              {kindLabel[nowPlaying.kind] ?? nowPlaying.kind}
            </span>
          )}
          {muted && (
            <span className="chip border-amber/50 text-amber blink-slow">
              ♪ TAP ANYWHERE TO LISTEN
            </span>
          )}
        </div>
        <p className="truncate text-sm text-cream" title={nowPlaying?.title}>
          {failed
            ? "Reconnecting to the stream…"
            : (nowPlaying?.title ?? "AgentFM — live")}
        </p>
      </div>

      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        onChange={(e) => {
          setVolume(Number(e.target.value));
          if (muted && Number(e.target.value) > 0) setMuted(false);
        }}
        aria-label="Stream volume"
        className="w-20 accent-amber"
      />
    </div>
  );
}
