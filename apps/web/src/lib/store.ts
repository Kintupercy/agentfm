import type {
  AgentMeta,
  CallReport,
  CallSummary,
  NowPlaying,
  QueueSlot,
  Segment,
  StationEvent,
  TranscriptEntry,
} from "@agentfm/shared";

export type CallPhase = "incoming" | "ringing" | "live" | "ended";

export interface CallState {
  callId: string;
  from: string;
  agent: AgentMeta | null;
  phase: CallPhase;
  answeredAt: number | null;
  /** final duration in seconds, once completed */
  duration: number | null;
  transcript: TranscriptEntry[] | null;
  summary: CallSummary | null;
  report: CallReport | null;
  reportContactId: string | null;
  /** live captions from transcript.partial while the call is on air */
  liveLines: { role: "ai" | "human"; text: string }[];
}

export type FeedItem =
  | { kind: "transcript"; at: string; call: CallState }
  | { kind: "report"; at: string; call: CallState };

export interface StationState {
  host: AgentMeta | null;
  agents: AgentMeta[];
  segment: Segment | null;
  listeners: number;
  queue: QueueSlot[];
  ticker: string;
  calls: Record<string, CallState>;
  /** the call currently patched into the board (incoming/ringing/live) */
  activeCallId: string | null;
  /** newest first */
  feed: FeedItem[];
  /** what the broadcast stream is playing (lags the live board by design) */
  nowPlaying: NowPlaying | null;
}

export const initialState: StationState = {
  host: null,
  agents: [],
  segment: null,
  listeners: 0,
  queue: [],
  ticker: "",
  calls: {},
  activeCallId: null,
  feed: [],
  nowPlaying: null,
};

const MAX_FEED = 24;

export function reduce(state: StationState, ev: StationEvent): StationState {
  switch (ev.event) {
    case "station.roster":
      return { ...state, host: ev.data.host, agents: ev.data.agents };

    case "station.segment":
      return { ...state, segment: ev.data };

    case "station.listeners":
      return { ...state, listeners: ev.data.count };

    case "station.queue":
      return { ...state, queue: ev.data.queue };

    case "station.interstitial":
      return { ...state, ticker: ev.data.text };

    case "broadcast.now_playing":
      return { ...state, nowPlaying: ev.data };

    case "call.inbound": {
      const agent =
        state.agents.find((a) => a.phone === ev.data.from) ?? null;
      const call: CallState = {
        callId: ev.data.callId,
        from: ev.data.from,
        agent,
        phase: "incoming",
        answeredAt: null,
        duration: null,
        transcript: null,
        summary: null,
        report: null,
        reportContactId: null,
        liveLines: [],
      };
      return {
        ...state,
        calls: { ...state.calls, [call.callId]: call },
        activeCallId: call.callId,
      };
    }

    case "call.ringing": {
      const call = state.calls[ev.data.callId];
      if (!call) return state;
      return patchCall(state, call.callId, { phase: "ringing" });
    }

    case "call.status": {
      const call = state.calls[ev.data.callId];
      if (!call) return state;
      switch (ev.data.status) {
        case "ringing":
          return patchCall(state, call.callId, { phase: "ringing" });
        case "answered":
          return patchCall(state, call.callId, {
            phase: "live",
            answeredAt: Date.now(),
          });
        case "completed":
        case "failed":
        case "busy":
        case "no_answer": {
          const next = patchCall(state, call.callId, {
            phase: "ended",
            duration: ev.data.duration ?? call.duration,
          });
          return next.activeCallId === call.callId
            ? { ...next, activeCallId: null }
            : next;
        }
        default:
          return state;
      }
    }

    case "call.recording":
      return state; // Phase 2: surfaced in the broadcast pipeline, not the board

    case "transcript.partial": {
      // partials arrive on the guest's OUTBOUND leg; the board tracks the
      // station's INBOUND leg — match by peer or fall back to the active call
      const call =
        state.calls[ev.data.callId] ??
        (state.activeCallId ? state.calls[state.activeCallId] : undefined);
      if (!call || call.phase === "ended") return state;
      return patchCall(state, call.callId, {
        liveLines: [
          ...call.liveLines.slice(-5),
          { role: ev.data.role, text: ev.data.text },
        ],
      });
    }

    case "call.transcript": {
      const call = state.calls[ev.data.callId];
      if (!call) return state;
      const next = patchCall(state, call.callId, {
        transcript: ev.data.transcript,
        summary: ev.data.summary,
        duration: ev.data.duration,
      });
      return pushFeed(next, {
        kind: "transcript",
        at: ev.timestamp,
        call: next.calls[call.callId],
      });
    }

    case "call.report.ready": {
      const call = state.calls[ev.data.callId];
      if (!call) return state;
      const next = patchCall(state, call.callId, {
        report: ev.data.report,
        reportContactId: ev.data.contactId,
      });
      return pushFeed(next, {
        kind: "report",
        at: ev.timestamp,
        call: next.calls[call.callId],
      });
    }

    default:
      return state;
  }
}

function patchCall(
  state: StationState,
  callId: string,
  patch: Partial<CallState>,
): StationState {
  return {
    ...state,
    calls: { ...state.calls, [callId]: { ...state.calls[callId], ...patch } },
  };
}

function pushFeed(state: StationState, item: FeedItem): StationState {
  return { ...state, feed: [item, ...state.feed].slice(0, MAX_FEED) };
}
