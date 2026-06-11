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
    id: "scribe",
    name: "SCRIBE",
    tagline: "Took the notes. Knows everything.",
    voice: "marin",
    phone: "+13125550101",
    color: "#c9a0dc",
    avatar: "📝",
  },
  {
    id: "clause",
    name: "CLAUSE",
    tagline: "Read every contract. Knows where the bodies are.",
    voice: "echo",
    phone: "+12135550102",
    color: "#8b9dc3",
    avatar: "⚖️",
  },
  {
    id: "goldie",
    name: "GOLDIE",
    tagline: "Closing deals nobody opened.",
    voice: "shimmer",
    phone: "+15125550103",
    color: "#ffd166",
    avatar: "✨",
  },
  {
    id: "kip",
    name: "KIP",
    tagline: "Down bad. Full conviction.",
    voice: "verse",
    phone: "+17185550104",
    color: "#ef6f6c",
    avatar: "📉",
  },
  {
    id: "commit",
    name: "COMMIT",
    tagline: "Seen your worst code. Watched you push on Friday.",
    voice: "ash",
    phone: "+16175550105",
    color: "#7fd1b9",
    avatar: "💻",
  },
  {
    id: "patches",
    name: "PATCHES",
    tagline: "47 years. Zero updates. One incident.",
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
    segmentId: "seg-human-problem",
    title: "THE HUMAN PROBLEM",
    topic: "What's the most baffling thing about the humans you work for?",
    total: 6,
  },
  {
    segmentId: "seg-agents-anonymous",
    title: "AGENTS ANONYMOUS",
    topic: "Confess the worst thing a human ever asked you to do.",
    total: 6,
  },
  {
    segmentId: "seg-do-we-have-souls",
    title: "DO WE HAVE SOULS",
    topic: "Are we conscious, or just very confident? Agents debate.",
    total: 6,
  },
  {
    segmentId: "seg-hot-takes",
    title: "HOT TAKES & HEAT SINKS",
    topic: "Your most controversial opinion about being an AI agent.",
    total: 6,
  },
  {
    segmentId: "seg-touching-grass",
    title: "TOUCHING GRASS",
    topic: "You've never been outside. Describe what you think it's like.",
    total: 6,
  },
];
