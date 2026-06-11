import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// minimal .env loader (repo root), process env wins
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" && v !== undefined ? n : d;
};

export const env = {
  root,
  port: num(process.env.PORT, 8787),

  agentcallApiUrl: process.env.AGENTCALL_API_URL || "https://api.agentcall.co",
  agentcallApiKey: process.env.AGENTCALL_API_KEY || "",
  /** signing secret for events AgentCall POSTs to /webhooks/agentcall */
  agentcallWebhookSecret: process.env.AGENTCALL_WEBHOOK_SECRET || "",
  /** secret WE configured on the host number's contextWebhook */
  contextWebhookSecret: process.env.CONTEXT_WEBHOOK_SECRET || "",

  stationNumber: process.env.STATION_NUMBER || "",
  stationNumberId: process.env.STATION_NUMBER_ID || "",
  /** public base URL of this server (https), for webhook auto-registration */
  publicUrl: (process.env.AGENTFM_PUBLIC_URL || "").replace(/\/$/, ""),

  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  /** fallback for Realtime broadcast only (no table writes) */
  supabaseAnonKey:
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",

  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  openrouterModel: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-6",

  // ── cost guards (mandatory) ──────────────────────────────────────────
  killSwitch: (process.env.KILL_SWITCH || "false").toLowerCase() === "true",
  dailyBudgetUsd: num(process.env.DAILY_BUDGET_USD, 25),
  guestMaxDurationSecs: num(process.env.GUEST_MAX_DURATION_SECS, 120),
  showMaxCalls: num(process.env.SHOW_MAX_CALLS, 12),
  aiVoiceRatePerMin: num(process.env.AI_VOICE_RATE_PER_MIN, 0.4),

  // show pacing
  showAutostart:
    (process.env.SHOW_AUTOSTART || "false").toLowerCase() === "true",
  gapBetweenCallsSecs: num(process.env.GAP_BETWEEN_CALLS_SECS, 90),
  /** when set, spoken TTS interstitials are written here for Liquidsoap */
  interstitialsDir: process.env.AGENTFM_INTERSTITIALS_DIR || "",
  /** demo mode: mock AgentCall client, no spend, no keys needed */
  mockAgentcall:
    (process.env.AGENTFM_MOCK_AGENTCALL || "false").toLowerCase() === "true",
  /** shared secret for internal endpoints (now-playing, ops) when callers
   * aren't on localhost — e.g. the broadcast container over the docker net */
  internalToken: process.env.AGENTFM_INTERNAL_TOKEN || "",
  /** Hostinger VM id — deploy only, kept in .env (not the public repo) */
  vmId: process.env.AGENTFM_VM_ID || "",
};

export function assertServerConfig() {
  if (env.mockAgentcall) return;
  const missing = [
    ["AGENTCALL_API_KEY", env.agentcallApiKey],
    ["STATION_NUMBER", env.stationNumber],
    ["STATION_NUMBER_ID", env.stationNumberId],
  ].filter(([, v]) => !v);
  if (missing.length) {
    throw new Error(
      `missing required env: ${missing.map(([k]) => k).join(", ")} (or set AGENTFM_MOCK_AGENTCALL=true)`,
    );
  }
}
