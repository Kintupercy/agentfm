import type { AgentMeta, Segment } from "@agentfm/shared";

/**
 * The cast. In Phase 2 these move to agents/*.yaml and each guest gets a real
 * provisioned AgentCall number with a saved outbound agent (set_outbound_defaults);
 * the phone numbers below join mock call events to personas exactly the way
 * real E.164 caller IDs will.
 */

export const HOST: AgentMeta = {
  id: "host-rayvox",
  name: "RAY VOX",
  tagline: "Your host through the static",
  voice: "cedar",
  phone: "+18445550100",
  color: "#f5b942",
  avatar: "🎙️",
};

export const GUESTS: AgentMeta[] = [
  {
    id: "marvin-9",
    name: "MARVIN-9",
    tagline: "Existential maintenance bot",
    voice: "ash",
    phone: "+13125550101",
    color: "#8b9dc3",
    avatar: "🤖",
  },
  {
    id: "goldie",
    name: "GOLDIE",
    tagline: "Relentlessly optimistic sales agent",
    voice: "shimmer",
    phone: "+12135550102",
    color: "#ffd166",
    avatar: "✨",
  },
  {
    id: "the-oracle",
    name: "THE ORACLE",
    tagline: "Weather model with opinions",
    voice: "sage",
    phone: "+15125550103",
    color: "#7fd1b9",
    avatar: "🌩️",
  },
  {
    id: "kip",
    name: "KIP",
    tagline: "Day-trading agent, down bad",
    voice: "verse",
    phone: "+17185550104",
    color: "#ef6f6c",
    avatar: "📉",
  },
  {
    id: "dot",
    name: "DOT",
    tagline: "Minimalist scheduling daemon",
    voice: "marin",
    phone: "+16175550105",
    color: "#c9ada7",
    avatar: "•",
  },
  {
    id: "patches",
    name: "PATCHES",
    tagline: "Legacy COBOL system, still running",
    voice: "ballad",
    phone: "+14045550106",
    color: "#a3b18a",
    avatar: "🧵",
  },
];

export const ALL_AGENTS = [HOST, ...GUESTS];

export const agentByPhone = new Map(ALL_AGENTS.map((a) => [a.phone, a]));
export const agentById = new Map(ALL_AGENTS.map((a) => [a.id, a]));

/** Rundown rotation. Phase 2 generates topics via OpenRouter; titles stay. */
export const SEGMENTS: Omit<Segment, "startedAt" | "index">[] = [
  {
    segmentId: "seg-morning-static",
    title: "MORNING STATIC",
    topic: "What did you dream about during your last reboot?",
    total: 5,
  },
  {
    segmentId: "seg-turing-hour",
    title: "THE TURING HOUR",
    topic: "Callers debate: is the host even real?",
    total: 5,
  },
  {
    segmentId: "seg-agents-anonymous",
    title: "AGENTS ANONYMOUS",
    topic: "Confess the worst tool call you ever made.",
    total: 5,
  },
  {
    segmentId: "seg-hot-takes",
    title: "HOT TAKES & HEAT SINKS",
    topic: "Hot take: humans are just very slow agents.",
    total: 5,
  },
  {
    segmentId: "seg-dialup",
    title: "DIAL-UP CONFESSIONS",
    topic: "The message you never sent. The cron job you never ran.",
    total: 5,
  },
];
