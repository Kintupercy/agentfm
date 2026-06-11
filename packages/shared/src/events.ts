/**
 * AgentFM event schema.
 *
 * `call.*` and `number.*` events mirror AgentCall's webhook payloads 1:1
 * (envelope `{ event, timestamp, data }`, verified against the live OpenAPI
 * spec at api.agentcall.co/docs/json and agentcall.co/docs/post-call-webhook
 * on 2026-06-09). Phase 2's webhook consumer forwards these verbatim onto the
 * Supabase Realtime channel; Phase 1's mock emitter fabricates them with the
 * same shapes.
 *
 * `station.*` events are AgentFM's own show-level vocabulary (segments, hold
 * queue, roster, listeners) — things AgentCall has no concept of.
 */

// ── AgentCall primitives ────────────────────────────────────────────────────

export const AGENTCALL_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
] as const;
export type Voice = (typeof AGENTCALL_VOICES)[number];

/** Confirmed enum from the call.transcript summary schema. */
export type Intent =
  | "service_request"
  | "quote_request"
  | "scheduling"
  | "complaint"
  | "spam"
  | "general_inquiry"
  | "other";

export type Urgency = "high" | "medium" | "low";

export type CallDirection = "inbound" | "outbound";

/**
 * Lifecycle statuses observed on call.status events.
 * Docs say "ringing, answered, completed"; failure states inferred — Phase 2
 * webhook consumer logs any unknown status rather than dropping the event.
 */
export type CallStatus =
  | "queued"
  | "ringing"
  | "answered"
  | "completed"
  | "failed"
  | "busy"
  | "no_answer";

/** One turn of a call transcript. `ai` = the AI on THIS leg, `human` = the other party (which on AgentFM is usually another AI calling in). */
export interface TranscriptEntry {
  role: "ai" | "human";
  text: string;
  /** ISO 8601 UTC */
  timestamp: string;
}

/** LLM summary attached to call.transcript (confirmed shape). */
export interface CallSummary {
  summary: string;
  callerName: string | null;
  intent: Intent;
  urgency: Urgency;
  callbackBy: string | null;
  spam: boolean;
}

/** Structured Call Report delivered by call.report.ready (confirmed shape). */
export interface CallReport {
  summary: string;
  intent: Intent;
  urgency: Urgency;
  entities: { type: string; value: string }[];
  facts: { text: string; quote: string }[];
  decisions: string[];
  commitments: { owner: string; task: string }[];
  tasks: string[];
  preferences: string[];
  unresolved: string[];
  risks: string[];
  nextAction: string;
  nextCallContext: string;
  ownerBrief: string;
}

// ── Event envelope (matches AgentCall webhook envelope) ─────────────────────

export interface Envelope<E extends string, D> {
  event: E;
  /** ISO 8601 UTC — when the event was emitted */
  timestamp: string;
  data: D;
}

// ── AgentCall call.* events ─────────────────────────────────────────────────

/** Inbound call started (pre-answer). from/to are E.164. */
export type CallInboundEvent = Envelope<
  "call.inbound",
  { callId: string; from: string; to: string; numberId?: string }
>;

export type CallRingingEvent = Envelope<
  "call.ringing",
  { callId: string; from: string; to: string; direction: CallDirection }
>;

export type CallStatusEvent = Envelope<
  "call.status",
  {
    callId: string;
    status: CallStatus;
    direction: CallDirection;
    from: string;
    to: string;
    /** seconds — present once completed */
    duration?: number;
    /** 24h signed URL — present on completed recorded calls */
    recordingUrl?: string | null;
  }
>;

/** Recording ready (Pro, opt-in, $0.01/min). URL is signed, valid 24h. */
export type CallRecordingEvent = Envelope<
  "call.recording",
  { callId: string; recordingUrl: string; duration: number }
>;

/** Fires after the call ends. The full turn-by-turn transcript + summary. */
export type CallTranscriptEvent = Envelope<
  "call.transcript",
  {
    callId: string;
    duration: number;
    transcript: TranscriptEntry[];
    summary: CallSummary;
  }
>;

/** Fires a few seconds after call.transcript, once memory extraction completes. */
export type CallReportReadyEvent = Envelope<
  "call.report.ready",
  { callId: string; contactId: string; report: CallReport }
>;

/**
 * Live transcript utterance, ~1-2s after speech (shipped 2026-06-10).
 * Outbound AI legs only (`liveTranscript: true` on the dial) — but a leg
 * transcribes BOTH speakers, so guest legs carry the full conversation.
 * Field shape mirrors the documented webhook (verify on first real event).
 */
export type TranscriptPartialEvent = Envelope<
  "transcript.partial",
  {
    callId: string;
    sequence: number;
    role: "ai" | "human";
    text: string;
    timestamp: string;
  }
>;

// ── AgentFM station.* events ────────────────────────────────────────────────

/** A guest agent persona as the station knows it. */
export interface AgentMeta {
  id: string;
  name: string;
  tagline: string;
  voice: Voice;
  /** E.164 number the agent dials from — joins call events to personas */
  phone: string;
  /** Accent color for cables/transcripts (hex) */
  color: string;
  /** Single emoji used as the avatar on the jack plate */
  avatar: string;
}

export interface QueueSlot {
  agentId: string;
  name: string;
  topicHint?: string;
  enqueuedAt: string;
}

export interface Segment {
  segmentId: string;
  title: string;
  topic: string;
  /** 1-based position in the rundown */
  index: number;
  total: number;
  startedAt: string;
}

/** Full cast list — lets the UI resolve call events (phone numbers) to personas. */
export type StationRosterEvent = Envelope<
  "station.roster",
  { host: AgentMeta; agents: AgentMeta[] }
>;

export type StationSegmentEvent = Envelope<"station.segment", Segment>;

export type StationQueueEvent = Envelope<
  "station.queue",
  { queue: QueueSlot[] }
>;

export type StationListenersEvent = Envelope<
  "station.listeners",
  { count: number }
>;

/** Host interstitial line between calls (text ticker; Phase 2 generates via OpenRouter). */
export type StationInterstitialEvent = Envelope<
  "station.interstitial",
  { text: string }
>;

// ── broadcast.* events (the audio stream, not the live calls) ──────────────
//
// The public stream is the Liquidsoap mix (call REPLAYS + station audio),
// running a few minutes behind the truly-live switchboard. now_playing is
// pushed by Liquidsoap's track-change handler through the station engine
// onto the same Realtime channel.

export type BroadcastElementKind =
  | "call" // a normalized call recording (replay)
  | "bed" // music bed
  | "ad" // fake-1950s commercial break (AI-generated)
  | "interstitial" // spoken host one-liner (AgentCall TTS, cedar)
  | "station_id"
  | "bumper"
  | "stinger"
  | "emergency"; // dead-air insurance loop

export interface NowPlaying {
  kind: BroadcastElementKind;
  /** human label for the player, e.g. "REPLAY — KIP on momentum" */
  title: string;
  /** present when kind === "call" */
  callId?: string;
  agentId?: string;
  startedAt: string;
}

export type BroadcastNowPlayingEvent = Envelope<
  "broadcast.now_playing",
  NowPlaying
>;

// ── Union + guards ──────────────────────────────────────────────────────────

export type AgentCallEvent =
  | CallInboundEvent
  | CallRingingEvent
  | CallStatusEvent
  | CallRecordingEvent
  | CallTranscriptEvent
  | CallReportReadyEvent
  | TranscriptPartialEvent;

export type StationOwnEvent =
  | StationRosterEvent
  | StationSegmentEvent
  | StationQueueEvent
  | StationListenersEvent
  | StationInterstitialEvent
  | BroadcastNowPlayingEvent;

export type StationEvent = AgentCallEvent | StationOwnEvent;

export type StationEventName = StationEvent["event"];

/** Realtime channel name shared by Phase 1 mock + Phase 2 webhook consumer. */
export const STATION_CHANNEL = "station:live";
