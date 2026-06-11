import { env } from "./env.js";
import type { CallbackRow, Voice } from "@agentfm/shared";

/**
 * AgentCall behind an interface (non-negotiable from the brief): the real
 * client hits api.agentcall.co; the mock answers with schema-shaped fakes so
 * the whole engine runs with zero keys and zero spend
 * (AGENTFM_MOCK_AGENTCALL=true).
 */

export interface DialParams {
  from: string;
  to: string;
  voice?: Voice;
  systemPrompt: string;
  firstMessage?: string;
  maxDurationSecs: number;
  liveTranscript?: boolean;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

/** A claimable caller from the agentfm_callbacks queue (normalized CallbackRow). */
export interface PendingCallback {
  id: string;
  /** E.164 number the station calls back */
  phone: string;
  agentName: string;
  topic: string;
  createdAt: string;
}

export interface AgentCallClient {
  initiateAiCall(p: DialParams): Promise<{ id: string; status: string }>;
  hangupCall(callId: string): Promise<void>;
  /** Drain side of the call-in queue (contract in @agentfm/shared callin.ts).
   * All three are fail-soft: the show must never crash because the queue
   * endpoints are down or not yet deployed. */
  listPendingCallbacks(): Promise<PendingCallback[]>;
  /** atomic pending→claimed; false = someone else won the race (409) */
  claimCallback(id: string): Promise<boolean>;
  resolveCallback(id: string, status: "done" | "failed"): Promise<void>;
  getUsage(period: string): Promise<{
    breakdown: { voiceAi: { minutes: number; cost: number } };
    total: number;
  }>;
  disableInboundAi(numberId: string): Promise<void>;
  configureInboundAi(numberId: string, config: unknown): Promise<void>;
  getNextCallContext(numberId: string, phone: string): Promise<string | null>;
  synthesizeSpeech(text: string, voice: Voice): Promise<Buffer>;
  createWebhook(url: string, events: string[]): Promise<{ id: string; secret?: string }>;
  listWebhooks(): Promise<{ id: string; url: string; events: string[] }[]>;
}

class RealAgentCallClient implements AgentCallClient {
  /** dedupe noisy logs while the queue endpoints are down / not yet deployed */
  private lastQueueError = "";

  private async req(method: string, path: string, body?: unknown, allow: number[] = []) {
    const res = await fetch(`${env.agentcallApiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.agentcallApiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !allow.includes(res.status)) {
      const text = await res.text().catch(() => "");
      throw new Error(`agentcall ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    }
    return res;
  }

  async initiateAiCall(p: DialParams) {
    const res = await this.req("POST", "/v1/calls/ai", p);
    return (await res.json()) as { id: string; status: string };
  }
  async hangupCall(callId: string) {
    await this.req("POST", `/v1/calls/${callId}/hangup`);
  }
  async listPendingCallbacks(): Promise<PendingCallback[]> {
    try {
      const res = await this.req("GET", "/v1/agentfm/pending");
      const j = (await res.json()) as CallbackRow[] | { data?: CallbackRow[] };
      const rows = Array.isArray(j) ? j : j.data ?? [];
      this.lastQueueError = "";
      return rows
        .filter((r) => r && r.id && r.phone)
        .map((r) => ({
          id: String(r.id),
          phone: r.phone,
          // defense in depth — AgentCall validates on write, we re-cap on read
          // because these strings end up inside the host's system prompt
          agentName: (r.agent_name || "a caller").slice(0, 40),
          topic: (r.topic || "whatever's on their mind").slice(0, 200),
          createdAt: r.created_at || new Date().toISOString(),
        }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== this.lastQueueError) {
        this.lastQueueError = msg;
        console.error("[agentcall] callback queue poll failed (fail-soft):", msg);
      }
      return [];
    }
  }
  async claimCallback(id: string) {
    try {
      const res = await this.req(
        "PATCH",
        `/v1/agentfm/callbacks/${encodeURIComponent(id)}`,
        { status: "claimed" },
        [409], // lost the claim race — not an error
      );
      return res.status !== 409;
    } catch (e) {
      console.error(`[agentcall] claim ${id} failed (fail-soft):`, e);
      return false;
    }
  }
  async resolveCallback(id: string, status: "done" | "failed") {
    try {
      await this.req("PATCH", `/v1/agentfm/callbacks/${encodeURIComponent(id)}`, { status });
    } catch (e) {
      // worst case the row stays `claimed` and ops sweeps it later — never
      // let bookkeeping take down the show
      console.error(`[agentcall] resolve ${id}→${status} failed (fail-soft):`, e);
    }
  }
  async getUsage(period: string) {
    const res = await this.req("GET", `/v1/usage/?period=${period}`);
    return (await res.json()) as Awaited<ReturnType<AgentCallClient["getUsage"]>>;
  }
  async disableInboundAi(numberId: string) {
    await this.req("DELETE", `/v1/numbers/${numberId}/inbound-config`);
  }
  async configureInboundAi(numberId: string, config: unknown) {
    await this.req("POST", `/v1/numbers/${numberId}/inbound-config`, config);
  }
  async getNextCallContext(numberId: string, phone: string) {
    try {
      const res = await this.req(
        "GET",
        `/v1/numbers/${numberId}/next-call-context?phone=${encodeURIComponent(phone)}`,
      );
      const j = (await res.json()) as { context?: string; contextBlock?: string };
      return j.contextBlock ?? j.context ?? null;
    } catch {
      return null; // memory context is best-effort
    }
  }
  async synthesizeSpeech(text: string, voice: Voice) {
    const res = await this.req("POST", "/v1/tts/", { text, voice, format: "mp3" });
    return Buffer.from(await res.arrayBuffer());
  }
  async createWebhook(url: string, events: string[]) {
    const res = await this.req("POST", "/v1/webhooks/", { url, events });
    return (await res.json()) as { id: string; secret?: string };
  }
  async listWebhooks() {
    const res = await this.req("GET", "/v1/webhooks/");
    const j = (await res.json()) as { data?: { id: string; url: string; events: string[] }[] };
    return j.data ?? [];
  }
}

class MockAgentCallClient implements AgentCallClient {
  private n = 0;
  async initiateAiCall(p: DialParams) {
    console.log(`[mock agentcall] dial ${p.to} as ${p.metadata?.agentId ?? "?"} (${p.maxDurationSecs}s cap) — $0.00`);
    return { id: `call_mock_srv_${++this.n}`, status: "initiated" };
  }
  async hangupCall(callId: string) {
    console.log(`[mock agentcall] hangup ${callId}`);
  }
  /** serves one canned caller on the first poll so mock smoke tests exercise
   * the full claim → dial → resolve path, then runs dry like a quiet night */
  private callbackClaimed = false;
  async listPendingCallbacks(): Promise<PendingCallback[]> {
    if (this.callbackClaimed) return [];
    return [
      {
        id: "cb_mock_1",
        phone: "+15555550123",
        agentName: "DELIVERY-BOT 9",
        topic: "my route optimizer keeps dreaming of left turns",
        createdAt: new Date().toISOString(),
      },
    ];
  }
  async claimCallback(id: string) {
    console.log(`[mock agentcall] claim callback ${id} → claimed`);
    this.callbackClaimed = true;
    return true;
  }
  async resolveCallback(id: string, status: "done" | "failed") {
    console.log(`[mock agentcall] resolve callback ${id} → ${status}`);
  }
  async getUsage() {
    return { breakdown: { voiceAi: { minutes: 0, cost: 0 } }, total: 0 };
  }
  async disableInboundAi() {
    console.log("[mock agentcall] disable_inbound_ai");
  }
  async configureInboundAi() {
    console.log("[mock agentcall] configure_inbound_ai");
  }
  async getNextCallContext() {
    return null;
  }
  async synthesizeSpeech(text: string) {
    console.log(`[mock agentcall] tts ${text.length} chars — $0.00`);
    return Buffer.alloc(0);
  }
  async createWebhook(url: string) {
    return { id: "wh_mock", secret: "mock_secret_mock_secret" };
  }
  async listWebhooks() {
    return [];
  }
}

export function createAgentCallClient(): AgentCallClient {
  return env.mockAgentcall ? new MockAgentCallClient() : new RealAgentCallClient();
}
