import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { AgentMeta, Voice } from "@agentfm/shared";
import { env } from "./env.js";

export interface HostConfig extends AgentMeta {
  record: boolean;
  maxDurationSecs: number;
  firstMessage: string;
  systemPrompt: string;
}

export interface GuestConfig extends AgentMeta {
  /** AgentCall number id to dial FROM; empty = benched */
  numberId: string;
  firstMessage: string;
  systemPrompt: string;
}

export interface ShowConfig {
  callsPerSegment: number;
  segments: { id: string; title: string; topic: string; angles?: string[] }[];
}

const agentsDir = join(env.root, "agents");

export function loadHost(): HostConfig {
  return parse(readFileSync(join(agentsDir, "host.yaml"), "utf8")) as HostConfig;
}

export function loadGuests(): GuestConfig[] {
  const dir = join(agentsDir, "guests");
  // gitignored override mapping guest id → { phone, numberId } — keeps real
  // account numbers out of the public repo (see agents/numbers.local.example.yaml)
  const overridePath = join(agentsDir, "numbers.local.yaml");
  const overrides = existsSync(overridePath)
    ? (parse(readFileSync(overridePath, "utf8")) as Record<
        string,
        { phone?: string; numberId?: string }
      > | null) ?? {}
    : {};
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const g = parse(readFileSync(join(dir, f), "utf8")) as GuestConfig;
      const o = overrides[g.id];
      if (o?.phone) g.phone = o.phone;
      if (o?.numberId) g.numberId = o.numberId;
      return g;
    });
}

export function loadShow(): ShowConfig {
  const raw = parse(readFileSync(join(agentsDir, "show.yaml"), "utf8")) as {
    station: { callsPerSegment: number };
    segments: ShowConfig["segments"];
  };
  return { callsPerSegment: raw.station.callsPerSegment, segments: raw.segments };
}

/** prime a persona template with tonight's specifics */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export function toMeta(a: AgentMeta): AgentMeta {
  return {
    id: a.id,
    name: a.name,
    tagline: a.tagline,
    voice: a.voice as Voice,
    phone: a.phone,
    color: a.color,
    avatar: a.avatar,
  };
}
