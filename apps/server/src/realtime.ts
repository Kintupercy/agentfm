import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { STATION_CHANNEL, type StationEvent } from "@agentfm/shared";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";

/**
 * Event fan-out: every StationEvent goes
 *  1. onto the Supabase Realtime channel `station:live` (the web UI's bus) —
 *     same envelope the Phase 1 mock emits, so the UI needs zero changes;
 *  2. into Postgres (`station_events`) for persistence, when configured;
 *  3. into a local JSONL log (always) — the raw-payload audit trail for
 *     shapes we haven't verified yet (transcript.partial, webhook statuses).
 */

const logDir = join(env.root, "apps", "server", "logs");
mkdirSync(logDir, { recursive: true });

let channel: RealtimeChannel | null = null;
let db: ReturnType<typeof createClient> | null = null;

let canPersist = false;

export async function initRealtime() {
  const key = env.supabaseServiceKey || env.supabaseAnonKey;
  if (!env.supabaseUrl || !key) {
    console.log("[realtime] supabase not configured — events go to local log only");
    return;
  }
  canPersist = !!env.supabaseServiceKey;
  if (!canPersist) {
    console.log("[realtime] anon key only — broadcasting, but NOT persisting to station_events (set SUPABASE_SERVICE_ROLE_KEY)");
  }
  // Node < 22 has no native WebSocket — hand realtime-js the ws package.
  // (ws's constructor is runtime-compatible but structurally differs from
  // the DOM WebSocket type realtime-js declares, hence the cast.)
  const transport =
    typeof globalThis.WebSocket === "undefined"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((await import("ws")).default as any)
      : undefined;
  db = createClient(env.supabaseUrl, key, {
    auth: { persistSession: false },
    ...(transport ? { realtime: { transport } } : {}),
  });
  channel = db.channel(STATION_CHANNEL);
  await new Promise<void>((resolve) => {
    channel!.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log(`[realtime] publishing to ${STATION_CHANNEL}`);
        resolve();
      }
    });
    setTimeout(resolve, 5000); // don't block boot on a flaky socket
  });
}

export async function publish(ev: StationEvent) {
  const day = new Date().toISOString().slice(0, 10);
  appendFileSync(join(logDir, `events-${day}.jsonl`), JSON.stringify(ev) + "\n");

  if (channel) {
    channel
      .send({ type: "broadcast", event: "station_event", payload: ev })
      .catch((e: unknown) => console.error("[realtime] send failed:", e));
  }
  if (db && canPersist) {
    // untyped client (no generated DB types) — payload validated by the schema
    db.from("station_events")
      .insert([{ event: ev.event, ts: ev.timestamp, data: ev.data }] as never)
      .then(({ error }) => {
        if (error) console.error("[realtime] persist failed:", error.message);
      });
  }
}
