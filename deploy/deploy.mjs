#!/usr/bin/env node
/**
 * Deploy AgentFM to the Hostinger VPS via the Docker-manager API.
 * Creates/replaces an ISOLATED compose project named `agentfm` — it never
 * touches the hermes-agent-* projects on the same box.
 *
 *   node deploy/deploy.mjs            # deploy / update
 *   node deploy/deploy.mjs --logs     # tail project logs
 *   node deploy/deploy.mjs --down     # remove the project
 *
 * Reads from repo-root .env: HOSTINGER_API_TOKEN, AGENTFM_VM_ID (default the
 * known box), DOMAIN, and every secret the stack needs. The compose file
 * (deploy/docker-compose.prod.yml) is sent as `content`; secrets go in the
 * `environment` field — never baked into images or git.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const env = {};
if (existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}
const need = (k, fallback) => {
  const v = env[k] ?? process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`missing ${k} in .env`);
  return v;
};

const TOKEN = need("HOSTINGER_API_TOKEN");
const VM = need("AGENTFM_VM_ID"); // from .env, never the public repo
const DOMAIN = need("DOMAIN", `agentfm.srv${VM}.hstgr.cloud`);
const PROJECT = "agentfm";
// "build" (box clones+builds the public repo) or "image" (pull from GHCR)
const MODE = need("AGENTFM_DEPLOY_MODE", "build");
const REPO_URL = need("AGENTFM_REPO_URL", "https://github.com/Kintupercy/agentfm.git");
const BASE = `https://developers.hostinger.com/api/vps/v1/virtual-machines/${VM}/docker`;

const api = (method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

if (process.argv.includes("--logs")) {
  const r = await api("GET", `/${PROJECT}/logs`);
  console.log(await r.text());
  process.exit(0);
}
if (process.argv.includes("--down")) {
  const r = await api("DELETE", `/${PROJECT}/down`);
  console.log(r.status, await r.text());
  process.exit(0);
}

// the .env the engine + ingest containers read (env_file: [.env]) plus the
// compose ${interpolation} vars — assembled into the `environment` field.
const envBlock = [
  `DOMAIN=${DOMAIN}`,
  `REPO_URL=${REPO_URL}`,
  `VITE_SUPABASE_URL=${need("VITE_SUPABASE_URL")}`,
  `VITE_SUPABASE_ANON_KEY=${need("VITE_SUPABASE_ANON_KEY")}`,
  `ICECAST_SOURCE_PASSWORD=${need("ICECAST_SOURCE_PASSWORD")}`,
  `ICECAST_ADMIN_PASSWORD=${need("ICECAST_ADMIN_PASSWORD")}`,
  `AGENTFM_INTERNAL_TOKEN=${need("AGENTFM_INTERNAL_TOKEN")}`,
  // engine/ingest runtime config
  `AGENTCALL_API_KEY=${need("AGENTCALL_API_KEY")}`,
  `AGENTCALL_API_URL=${need("AGENTCALL_API_URL", "https://api.agentcall.co")}`,
  `AGENTCALL_WEBHOOK_SECRET=${need("AGENTCALL_WEBHOOK_SECRET", "")}`,
  `CONTEXT_WEBHOOK_SECRET=${need("CONTEXT_WEBHOOK_SECRET")}`,
  `STATION_NUMBER=${need("STATION_NUMBER")}`,
  `STATION_NUMBER_ID=${need("STATION_NUMBER_ID")}`,
  `SUPABASE_URL=${need("SUPABASE_URL")}`,
  `SUPABASE_SERVICE_ROLE_KEY=${need("SUPABASE_SERVICE_ROLE_KEY", "")}`,
  `SUPABASE_ANON_KEY=${need("VITE_SUPABASE_ANON_KEY", "")}`,
  `OPENROUTER_API_KEY=${need("OPENROUTER_API_KEY", "")}`,
  `OPENROUTER_MODEL=${need("OPENROUTER_MODEL", "anthropic/claude-sonnet-4-6")}`,
  // cost guards
  `KILL_SWITCH=${need("KILL_SWITCH", "false")}`,
  `DAILY_BUDGET_USD=${need("DAILY_BUDGET_USD", "25")}`,
  `GUEST_MAX_DURATION_SECS=${need("GUEST_MAX_DURATION_SECS", "120")}`,
  `SHOW_MAX_CALLS=${need("SHOW_MAX_CALLS", "12")}`,
  `AI_VOICE_RATE_PER_MIN=${need("AI_VOICE_RATE_PER_MIN", "0.40")}`,
  // SHOW_AUTOSTART stays false for the first deploy — engine runs, webhooks
  // ready, but NO dialing, NO host reconfigure, NO spend until we verify.
  `SHOW_AUTOSTART=${need("SHOW_AUTOSTART", "false")}`,
  `AGENTFM_INGEST_POLL_MS=${need("AGENTFM_INGEST_POLL_MS", "30000")}`,
].join("\n");

const composeFile =
  MODE === "image" ? "docker-compose.prod.yml" : "docker-compose.build.yml";
const content = readFileSync(join(root, "deploy", composeFile), "utf8");

console.log(`Deploying "${PROJECT}" to VM ${VM} (${MODE} mode, domain ${DOMAIN})…`);
const res = await api("POST", "", {
  project_name: PROJECT,
  content,
  environment: envBlock,
});
console.log(res.status, await res.text());
console.log("\nNext: node deploy/deploy.mjs --logs   to watch it come up.");
