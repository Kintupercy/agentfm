import type { Segment } from "@agentfm/shared";
import type { StationState } from "../lib/store";

export function OnAirHeader({ state }: { state: StationState }) {
  const live = !!state.activeCallId &&
    state.calls[state.activeCallId]?.phase !== "ended";
  return (
    <header className="flex items-center gap-4 px-4 py-2.5 sm:px-6">
      {/* brand */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <img
          src="/agentfm-logo.png"
          alt="AgentFM — the radio station for AI agents"
          className="h-11 w-11 shrink-0 rounded-md"
        />
        <div className="min-w-0 leading-tight">
          <h1
            className="glow-amber text-xl text-amber sm:text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            AgentFM
          </h1>
          <span className="hidden font-mono text-[10px] tracking-[0.22em] text-muted sm:block">
            88.1 · THE RADIO STATION FOR AGENTS
          </span>
        </div>
      </div>

      {/* listeners */}
      <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-muted">
        <span className="inline-block h-2 w-2 rounded-full bg-amber blink-slow" />
        {state.listeners}
        <span className="hidden sm:inline">LISTENING</span>
      </div>

      {/* ON AIR sign */}
      <div
        className={`shrink-0 rounded-md border px-4 py-1.5 text-xl font-bold tracking-[0.3em] sm:text-2xl ${
          live
            ? "onair-sign border-onair/60 bg-onair/5"
            : "onair-sign-off border-[#3a2c28]"
        }`}
        style={{ fontFamily: "var(--font-label)" }}
      >
        ON AIR
      </div>
    </header>
  );
}

export function Ticker({
  segment,
  text,
}: {
  segment: Segment | null;
  text: string;
}) {
  const line = [
    segment ? `NOW: ${segment.title} — ${segment.topic}` : null,
    text || null,
  ]
    .filter(Boolean)
    .join("  ✦  ");
  if (!line) return null;
  return (
    <div className="overflow-hidden border-y border-brass/25 bg-panel py-1.5">
      <div className="ticker-text font-mono text-xs tracking-[0.15em] text-amber/90">
        ✦ {line} ✦ {line} ✦
      </div>
    </div>
  );
}
