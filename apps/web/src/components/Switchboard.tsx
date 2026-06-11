import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMeta } from "@agentfm/shared";
import type { CallState, StationState } from "../lib/store";
import { AgentFace } from "./AgentFace";

/**
 * The 1950s telephone-exchange board. Pure SVG.
 * Voice activity + cable glow run on requestAnimationFrame mutating DOM nodes
 * directly — React never re-renders during a live call, so it stays at 60fps.
 */

const VB_W = 1000;
const VB_H = 540;
const HOST_POS = { x: 500, y: 168 };
const JACK_Y = 432;

function guestPos(i: number, count: number) {
  const margin = 110;
  const span = VB_W - margin * 2;
  const x = count <= 1 ? VB_W / 2 : margin + (span / (count - 1)) * i;
  return { x, y: JACK_Y };
}

/** irregular-but-deterministic "who is speaking" oscillator */
function speakingSide(t: number, seed: number): "host" | "guest" {
  const v =
    Math.sin(t * 0.00042 + seed) +
    Math.sin(t * 0.00027 + seed * 2.7) * 0.7 +
    Math.sin(t * 0.00011 + seed * 1.3) * 0.5;
  return v > 0.15 ? "host" : "guest";
}

/** speech-like amplitude envelope 0..1 */
function speechLevel(t: number, seed: number): number {
  const v =
    0.5 +
    0.28 * Math.sin(t * 0.011 + seed) +
    0.18 * Math.sin(t * 0.023 + seed * 3.1) +
    0.12 * Math.sin(t * 0.0047 + seed * 0.7);
  return Math.max(0.08, Math.min(1, v));
}

export function Switchboard({ state }: { state: StationState }) {
  const activeCall = state.activeCallId
    ? state.calls[state.activeCallId]
    : null;
  const guests = state.agents;
  const queuedIds = new Set(state.queue.map((q) => q.agentId));

  return (
    <div className="card relative overflow-hidden p-2 sm:p-3">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="AgentFM switchboard: live patch panel of agent callers"
      >
        <Defs />
        {/* board face */}
        <rect
          x="6" y="6" width={VB_W - 12} height={VB_H - 12} rx="18"
          fill="url(#boardGrad)" stroke="rgba(176,141,87,0.35)" strokeWidth="1.5"
        />
        <rect
          x="22" y="22" width={VB_W - 44} height={VB_H - 44} rx="12"
          fill="none" stroke="rgba(176,141,87,0.16)" strokeWidth="1"
        />
        {[
          [34, 34], [VB_W - 34, 34], [34, VB_H - 34], [VB_W - 34, VB_H - 34],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="5.5" fill="url(#screwGrad)" stroke="#0a0805" strokeWidth="1" />
        ))}
        <text
          x="56" y="54" textAnchor="start" fill="rgba(240,230,210,0.5)"
          style={{ font: "600 15px 'Barlow Condensed'", letterSpacing: "0.45em" }}
        >
          AGENTFM TRUNK EXCHANGE № 88.1
        </text>

        {/* patch cable (under jacks, over board) */}
        {activeCall?.agent && (
          <PatchCable
            key={activeCall.callId}
            call={activeCall}
            guestIndex={guests.findIndex((g) => g.id === activeCall.agent!.id)}
            guestCount={guests.length}
          />
        )}

        {/* host jack */}
        <HostJack host={state.host} call={activeCall} />

        {/* guest jacks */}
        {guests.map((agent, i) => {
          const pos = guestPos(i, guests.length);
          const isActive = activeCall?.agent?.id === agent.id;
          const phase: JackPhase = isActive
            ? activeCall!.phase === "live"
              ? "live"
              : activeCall!.phase === "ended"
                ? "idle"
                : "ringing"
            : queuedIds.has(agent.id)
              ? "queued"
              : "idle";
          return (
            <GuestJack
              key={agent.id}
              agent={agent}
              x={pos.x}
              y={pos.y}
              phase={phase}
              call={isActive ? activeCall : null}
            />
          );
        })}
      </svg>
    </div>
  );
}

function Defs() {
  return (
    <defs>
      <linearGradient id="boardGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#221b14" />
        <stop offset="0.5" stopColor="#181310" />
        <stop offset="1" stopColor="#100d0a" />
      </linearGradient>
      <radialGradient id="screwGrad">
        <stop offset="0" stopColor="#cdb285" />
        <stop offset="1" stopColor="#5d4a2e" />
      </radialGradient>
      <radialGradient id="brassRing">
        <stop offset="0.55" stopColor="#3a2f20" />
        <stop offset="0.72" stopColor="#c9a96a" />
        <stop offset="0.85" stopColor="#8a6a3a" />
        <stop offset="1" stopColor="#52401f" />
      </radialGradient>
      <radialGradient id="jackHole">
        <stop offset="0" stopColor="#000" />
        <stop offset="0.8" stopColor="#0a0805" />
        <stop offset="1" stopColor="#241c12" />
      </radialGradient>
      <linearGradient id="cableGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#f5b942" />
        <stop offset="0.5" stopColor="#ffd97a" />
        <stop offset="1" stopColor="#f5b942" />
      </linearGradient>
      <filter id="cableGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.2" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

type JackPhase = "idle" | "queued" | "ringing" | "live";

const LED: Record<JackPhase, { fill: string; cls?: string; glow: boolean }> = {
  idle: { fill: "#3a2f20", glow: false },
  queued: { fill: "#f5b942", cls: "blink-slow", glow: true },
  ringing: { fill: "#f5b942", cls: "blink-fast", glow: true },
  live: { fill: "#ffd97a", glow: true },
};

function GuestJack({
  agent,
  x,
  y,
  phase,
  call,
}: {
  agent: AgentMeta;
  x: number;
  y: number;
  phase: JackPhase;
  call: CallState | null;
}) {
  const led = LED[phase];
  return (
    <g opacity={phase === "idle" ? 0.72 : 1}>
      {phase === "live" && call && (
        <VoicePulse x={x} y={y} color={agent.color} side="guest" callId={call.callId} />
      )}
      {/* operator portrait, framed above the jack */}
      <rect
        x={x - 25} y={y - 90} width="50" height="50" rx="6"
        fill="#0e0b08"
        stroke={phase === "live" ? agent.color : "rgba(176,141,87,0.45)"}
        strokeWidth={phase === "live" ? 1.8 : 1}
      />
      <AgentFace seed={agent.id} color={agent.color} size={44} x={x - 22} y={y - 87} />
      {/* LED on the frame corner */}
      <circle
        cx={x + 25} cy={y - 90} r="4.5"
        fill={led.fill}
        className={led.cls}
        filter={led.glow ? "url(#softGlow)" : undefined}
      />
      {/* jack */}
      <circle cx={x} cy={y} r="22" fill="url(#brassRing)" />
      <circle cx={x} cy={y} r="12.5" fill="url(#jackHole)" />
      {/* label plate */}
      <rect
        x={x - 62} y={y + 32} width="124" height="40" rx="5"
        fill="#0e0b08" stroke="rgba(176,141,87,0.4)" strokeWidth="1"
      />
      <text
        x={x} y={y + 49} textAnchor="middle" fill={phase === "live" ? agent.color : "#d8c9a8"}
        style={{ font: "600 15px 'Barlow Condensed'", letterSpacing: "0.12em" }}
      >
        {agent.name}
      </text>
      <text
        x={x} y={y + 64} textAnchor="middle" fill="rgba(156,142,120,0.85)"
        style={{ font: "10.5px 'Barlow Condensed'", letterSpacing: "0.04em" }}
      >
        {agent.tagline}
      </text>
      {phase === "live" && call?.answeredAt && (
        <DurationText x={x} y={y - 100} since={call.answeredAt} color={agent.color} />
      )}
    </g>
  );
}

function HostJack({
  host,
  call,
}: {
  host: AgentMeta | null;
  call: CallState | null;
}) {
  const { x, y } = HOST_POS;
  const live = call?.phase === "live";
  return (
    <g>
      {live && call && (
        <VoicePulse x={x} y={y} color="#f5b942" side="host" callId={call.callId} />
      )}
      <circle cx={x} cy={y} r="30" fill="url(#brassRing)" />
      <circle cx={x} cy={y} r="17" fill="url(#jackHole)" />
      {/* the host's portrait hangs above the studio plate */}
      <rect
        x={x - 30} y={y - 142} width="60" height="60" rx="7"
        fill="#0e0b08"
        stroke={live ? "#f5b942" : "rgba(176,141,87,0.5)"}
        strokeWidth={live ? 1.8 : 1}
      />
      {host && (
        <AgentFace seed={host.id} color={host.color} size={54} x={x - 27} y={y - 139} />
      )}
      <rect
        x={x - 86} y={y - 78} width="172" height="34" rx="5"
        fill="#0e0b08" stroke="rgba(176,141,87,0.5)" strokeWidth="1"
      />
      <text
        x={x} y={y - 56} textAnchor="middle"
        fill={live ? "#f5b942" : "#d8c9a8"}
        style={{ font: "600 17px 'Barlow Condensed'", letterSpacing: "0.18em" }}
      >
        STUDIO · {host?.name ?? "—"}
      </text>
      {live && call?.answeredAt && (
        <DurationText x={x} y={y + 56} since={call.answeredAt} color="#f5b942" />
      )}
    </g>
  );
}

/** mm:ss ticker, re-renders once per second only */
function DurationText({
  x,
  y,
  since,
  color,
}: {
  x: number;
  y: number;
  since: number;
  color: string;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <text
      x={x} y={y} textAnchor="middle" fill={color} filter="url(#softGlow)"
      style={{ font: "600 13px 'IBM Plex Mono'", letterSpacing: "0.1em" }}
    >
      ● {mm}:{ss}
    </text>
  );
}

/** voice-activity rings — rAF mutates the circles directly */
function VoicePulse({
  x,
  y,
  color,
  side,
  callId,
}: {
  x: number;
  y: number;
  color: string;
  side: "host" | "guest";
  callId: string;
}) {
  const r1 = useRef<SVGCircleElement>(null);
  const r2 = useRef<SVGCircleElement>(null);
  const seed = useMemo(
    () => [...callId].reduce((a, c) => a + c.charCodeAt(0), 0) % 97,
    [callId],
  );

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      const talking = speakingSide(t, seed) === side;
      const level = talking ? speechLevel(t, seed + (side === "host" ? 0 : 31)) : 0.04;
      const base = side === "host" ? 34 : 26;
      if (r1.current) {
        r1.current.setAttribute("r", String(base + level * 14));
        r1.current.setAttribute("stroke-opacity", String(0.15 + level * 0.55));
      }
      if (r2.current) {
        r2.current.setAttribute("r", String(base + 8 + level * 26));
        r2.current.setAttribute("stroke-opacity", String(0.05 + level * 0.3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seed, side]);

  return (
    <g filter="url(#softGlow)">
      <circle ref={r1} cx={x} cy={y} r="30" fill="none" stroke={color} strokeWidth="2" />
      <circle ref={r2} cx={x} cy={y} r="40" fill="none" stroke={color} strokeWidth="1.2" />
    </g>
  );
}

/** glowing patch cable with sag; draws in on connect, pulses while live */
function PatchCable({
  call,
  guestIndex,
  guestCount,
}: {
  call: CallState;
  guestIndex: number;
  guestCount: number;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);
  const connected = call.phase === "live";
  const g = guestPos(Math.max(0, guestIndex), guestCount);

  const d = useMemo(() => {
    const { x: hx, y: hy } = HOST_POS;
    // one clean hanging curve: drop from the guest plug, sag, rise to the studio
    const sag = 120 + Math.abs(g.x - hx) * 0.12;
    return `M ${g.x} ${g.y} C ${g.x} ${g.y + sag}, ${hx} ${hy + sag * 1.6}, ${hx} ${hy}`;
  }, [g.x, g.y]);

  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength());
  }, [d]);

  // breathing glow while connected
  const glowRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    if (!connected) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      if (glowRef.current) {
        glowRef.current.setAttribute(
          "stroke-opacity",
          String(0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.004))),
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected]);

  return (
    <g>
      {/* glow underlay */}
      <path
        ref={glowRef}
        d={d}
        fill="none"
        stroke="#f5b942"
        strokeWidth="7"
        strokeOpacity="0.4"
        filter="url(#cableGlow)"
        strokeDasharray={len || undefined}
        strokeDashoffset={len ? (connected ? 0 : len) : undefined}
        style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }}
      />
      {/* cable core */}
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke="url(#cableGrad)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={len || undefined}
        strokeDashoffset={len ? (connected ? 0 : len) : undefined}
        style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }}
      />
      {/* plugs */}
      <circle cx={g.x} cy={g.y} r="7" fill="#caa55f" stroke="#0a0805" strokeWidth="1.5" />
      {connected && (
        <circle
          cx={HOST_POS.x} cy={HOST_POS.y} r="8.5"
          fill="#caa55f" stroke="#0a0805" strokeWidth="1.5"
        />
      )}
    </g>
  );
}
