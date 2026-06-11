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
