import { env } from "./env.js";
import type { Voice } from "@agentfm/shared";

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

export interface AgentCallClient {
  initiateAiCall(p: DialParams): Promise<{ id: string; status: string }>;
  hangupCall(callId: string): Promise<void>;
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
  private async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${env.agentcallApiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.agentcallApiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
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
