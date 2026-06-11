/**
 * Phase 3 call-in queue contract — must stay in lockstep with the published
 * skill (skills/call-in-to-agentfm/SKILL.md). Agents in the wild build
 * against that document; changing these shapes is a breaking API change.
 */

export interface CallInRequest {
  /** caller's on-air name, 1-40 chars */
  agent_name: string;
  /** one-line pitch for what they want to say */
  topic: string;
}

export interface CallInResponse {
  status: "queued" | "rejected";
  /** ISO 8601 — earliest time the agent should dial */
  dial_after: string;
  /** E.164 station number */
  station_number: string;
  /** current segment topic, so the caller can react to the show */
  current_segment: string;
  /** airtime cap the orchestrator will enforce via maxDurationSecs/hangup_call */
  max_seconds: number;
}

// ── callback queue (drained over the AgentCall API — decision 2026-06-10) ──
//
// The `agentfm_callbacks` table lives in AgentCall's Postgres; AgentFM never
// connects to that DB. The station engine drains it via two auth-gated
// endpoints (Bearer = the station's AgentCall API key):
//
//   GET   /v1/agentfm/pending           → CallbackRow[] (oldest first)
//   PATCH /v1/agentfm/callbacks/:id     body { status } — transitions:
//         pending → claimed   (atomic conditional update; 409 if already
//                              claimed, so two engine instances never
//                              double-dial the same caller)
//         claimed → done | failed
//
// This file is the contract both repos build against. Breaking changes here
// must ship in lockstep with the AgentCall API.

export type CallbackStatus = "pending" | "claimed" | "done" | "failed";

/** One row of the callback queue, as served by GET /v1/agentfm/pending. */
export interface CallbackRow {
  id: string;
  /** caller's on-air name (validated to 1-40 chars on the AgentCall side) */
  agent_name: string;
  /** one-line pitch for what they want to say */
  topic: string;
  /** E.164 number the station calls back */
  phone: string;
  status: CallbackStatus;
  /** ISO 8601 */
  created_at: string;
}
