import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "@agentfm/shared";
import type { CallState, FeedItem, StationState } from "../lib/store";
import { AgentFace } from "./AgentFace";

/** every caller gets a face — known agents by id, walk-ins by caller ID */
function faceSeed(call: CallState) {
  return call.agent?.id ?? call.from;
}

/**
 * Right rail: what's happening on the air.
 * Transcripts are POST-CALL on AgentCall, so while a call is live we show an
 * ON AIR card (waveform + duration); the full exchange typewriters in when
 * the call.transcript webhook fires.
 */
export function FeedPanel({
  state,
  onBrowseTape,
}: {
  state: StationState;
  onBrowseTape?: () => void;
}) {
  const active = state.activeCallId ? state.calls[state.activeCallId] : null;
  // most recent ended call still waiting on its transcript
  const processing = Object.values(state.calls)
    .filter((c) => c.phase === "ended" && !c.transcript)
    .sort((a, b) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0))[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {active ? (
        <OnAirCard call={active} />
      ) : processing ? (
        <ProcessingCard call={processing} />
      ) : (
        <StandbyCard />
      )}
      <div className="scroll-rail min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {state.feed.map((item) =>
          item.kind === "transcript" ? (
            <TranscriptCard
              key={`t-${item.call.callId}`}
              call={item.call}
              animate={item === state.feed[0]}
            />
          ) : (
            <ReportCard
              key={`r-${item.call.callId}`}
              call={item.call}
              animate={item === state.feed[0]}
            />
          ),
        )}
        {state.feed.length === 0 && (
          <div className="px-2 py-6 text-center">
            <p className="font-mono text-xs text-muted">
              Transcripts and call reports land here live during a show —
              straight off the AgentCall webhooks.
            </p>
            {onBrowseTape && (
              <button
                onClick={onBrowseTape}
                className="mt-4 rounded-md border border-amber/50 px-4 py-2 font-mono text-[11px] tracking-[0.18em] text-amber transition-colors hover:bg-amber/10"
              >
                ▶ PREVIOUS CALLS — ON TAPE
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── live cards ──────────────────────────────────────────────────────────────

function OnAirCard({ call }: { call: CallState }) {
  const name = call.agent?.name ?? call.from;
  const color = call.agent?.color ?? "#f5b942";
  const live = call.phase === "live";
  return (
    <div className="card border-onair/30 p-4">
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[11px] tracking-[0.3em] ${live ? "text-onair" : "text-amber"}`}>
          {live ? "● ON AIR" : call.phase === "ringing" ? "RINGING…" : "INCOMING…"}
        </span>
        {live && call.answeredAt && <LiveDuration since={call.answeredAt} />}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="shrink-0 rounded-md border border-brass/40 bg-coal">
          <AgentFace seed={faceSeed(call)} color={color} size={52} title={name} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold tracking-wider" style={{ color }}>
            {name}
          </div>
          <div className="truncate font-mono text-[11px] text-muted">
            {call.agent?.tagline ?? "unknown caller"} · {call.from}
          </div>
        </div>
      </div>
      <div className="mt-3">
        {live ? (
          <Waveform color={color} />
        ) : (
          <div className="h-12 rounded bg-coal/60" />
        )}
      </div>
      {live && call.liveLines.length > 0 ? (
        // live captions via transcript.partial (guest-leg roles: ai = guest)
        <div className="mt-2 space-y-1">
          {call.liveLines.slice(-2).map((l, i) => (
            <p key={`${call.liveLines.length}-${i}`} className="truncate text-xs leading-snug">
              <span
                className="mr-1.5 font-mono text-[9px] font-semibold tracking-wider"
                style={{ color: l.role === "human" ? "#f5b942" : color }}
              >
                {l.role === "human" ? "HOST" : name}
              </span>
              <span className="text-cream/80">{l.text}</span>
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-2 font-mono text-[10px] text-muted">
          {live ? "live captions warming up…" : "patching through…"}
        </p>
      )}
    </div>
  );
}

function ProcessingCard({ call }: { call: CallState }) {
  return (
    <div className="card p-4">
      <span className="font-mono text-[11px] tracking-[0.3em] text-amber blink-slow">
        ⟳ PROCESSING TRANSCRIPT
      </span>
      <p className="mt-2 text-sm text-cream">
        {call.agent?.name ?? call.from} just hung up
        {call.duration != null && ` after ${fmtDur(call.duration)}`}. Waiting on
        the <code className="font-mono text-amber/80">call.transcript</code>{" "}
        webhook…
      </p>
    </div>
  );
}

function StandbyCard() {
  return (
    <div className="card p-4">
      <span className="font-mono text-[11px] tracking-[0.3em] text-muted">
        STAND BY
      </span>
      <p className="mt-2 text-sm text-muted">
        Lines are open. Next caller is being patched through…
      </p>
    </div>
  );
}

function LiveDuration({ since }: { since: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-sm text-onair">
      {fmtDur(Math.floor((Date.now() - since) / 1000))}
    </span>
  );
}

/** animated fake waveform — rAF mutates bar heights directly */
function Waveform({ color }: { color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      const bars = ref.current?.children;
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          const h =
            14 +
            46 *
              Math.abs(
                Math.sin(t * 0.004 + i * 0.9) * 0.6 +
                  Math.sin(t * 0.011 + i * 1.7) * 0.4,
              );
          (bars[i] as HTMLElement).style.height = `${h}%`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className="flex h-12 items-center gap-0.75">
      {Array.from({ length: 36 }).map((_, i) => (
        <span
          key={i}
          className="w-full flex-1 rounded-sm"
          style={{ backgroundColor: color, opacity: 0.85, height: "20%" }}
        />
      ))}
    </div>
  );
}

// ── post-call cards ─────────────────────────────────────────────────────────

function TranscriptCard({
  call,
  animate,
}: {
  call: CallState;
  animate: boolean;
}) {
  const entries = call.transcript ?? [];
  const [shown, setShown] = useState(animate ? 0 : entries.length);

  useEffect(() => {
    if (!animate || shown >= entries.length) return;
    const id = setTimeout(() => setShown((n) => n + 1), 650);
    return () => clearTimeout(id);
  }, [animate, shown, entries.length]);

  const name = call.agent?.name ?? call.summary?.callerName ?? call.from;
  const color = call.agent?.color ?? "#d8c9a8";

  return (
    <article className={`card p-4 ${animate ? "feed-enter" : ""}`}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] text-amber">
          <AgentFace seed={faceSeed(call)} color={color} size={22} />
          TRANSCRIPT · {name}
        </span>
        <span className="font-mono text-[10px] text-muted">
          {call.duration != null ? fmtDur(call.duration) : ""}
        </span>
      </header>
      <div className="space-y-2">
        {entries.slice(0, shown).map((e, i) => (
          <TranscriptLine
            key={i}
            entry={e}
            color={color}
            type={animate && i === shown - 1}
          />
        ))}
        {shown < entries.length && (
          <span className="font-mono text-xs text-amber blink-fast">▮</span>
        )}
      </div>
      {call.summary && shown >= entries.length && (
        <footer className="mt-3 border-t border-brass/20 pt-2">
          <p className="text-xs leading-relaxed text-muted">
            {call.summary.summary}
          </p>
        </footer>
      )}
    </article>
  );
}

function TranscriptLine({
  entry,
  color,
  type,
}: {
  entry: TranscriptEntry;
  color: string;
  type: boolean;
}) {
  const isHost = entry.role === "ai";
  const text = useTypewriter(entry.text, type);
  return (
    <p className="text-[13px] leading-snug">
      <span
        className="mr-1.5 font-mono text-[10px] font-semibold tracking-wider"
        style={{ color: isHost ? "#f5b942" : color }}
      >
        {isHost ? "HOST" : "CALLER"}
      </span>
      <span className={isHost ? "text-cream" : "text-cream/85"}>{text}</span>
    </p>
  );
}

function useTypewriter(full: string, active: boolean): string {
  const [n, setN] = useState(active ? 0 : full.length);
  useEffect(() => {
    if (!active || n >= full.length) return;
    const id = setTimeout(() => setN((v) => Math.min(full.length, v + 3)), 16);
    return () => clearTimeout(id);
  }, [active, n, full.length]);
  return full.slice(0, n);
}

function ReportCard({ call, animate }: { call: CallState; animate: boolean }) {
  const r = call.report;
  if (!r) return null;
  const name = call.agent?.name ?? call.summary?.callerName ?? call.from;
  return (
    <article
      className={`card border-amber/25 p-4 ${animate ? "feed-enter" : ""}`}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.25em] text-amber glow-amber">
          <AgentFace
            seed={faceSeed(call)}
            color={call.agent?.color ?? "#f5b942"}
            size={22}
          />
          SEGMENT RECAP · {name}
        </span>
        <span className="chip border-amber/40 text-amber/90">{r.intent.replace("_", " ")}</span>
        <span
          className={`chip ${
            r.urgency === "high"
              ? "border-onair/50 text-onair"
              : "text-muted"
          }`}
        >
          {r.urgency}
        </span>
      </header>

      <p className="text-sm leading-relaxed text-cream">{r.summary}</p>

      {r.entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.entities.map((e, i) => (
            <span key={i} className="chip text-cream/80">
              {e.type}: {e.value}
            </span>
          ))}
        </div>
      )}

      {r.facts.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {r.facts.map((f, i) => (
            <li key={i} className="text-xs text-cream/85">
              <span className="text-amber/80">▸</span> {f.text}{" "}
              <em className="text-muted">“{f.quote}”</em>
            </li>
          ))}
        </ul>
      )}

      {r.commitments.length > 0 && (
        <div className="mt-2.5">
          {r.commitments.map((c, i) => (
            <p key={i} className="font-mono text-[11px] text-cream/75">
              ☑ <span className="text-amber/80">{c.owner}</span> — {c.task}
            </p>
          ))}
        </div>
      )}

      <footer className="mt-3 rounded-md border border-brass/25 bg-coal/50 px-3 py-2">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted">
          PRODUCER'S NOTE
        </p>
        <p className="mt-1 text-xs italic leading-relaxed text-cream/80">
          {r.ownerBrief}
        </p>
      </footer>
    </article>
  );
}

function fmtDur(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export type { FeedItem };
