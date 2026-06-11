import { createClient } from "@supabase/supabase-js";
import { STATION_CHANNEL, type StationEvent } from "@agentfm/shared";
import { MockStation } from "../mock/emitter";

/**
 * The station event bus. The UI only ever talks to this interface.
 * Phase 1: MockBus (zero keys, zero spend). Phase 2: SupabaseBus, fed by the
 * webhook consumer relaying real AgentCall events with identical payloads.
 */
export interface StationBus {
  subscribe(handler: (e: StationEvent) => void): () => void;
  start(): void;
  stop(): void;
}

class MockBus implements StationBus {
  private handlers = new Set<(e: StationEvent) => void>();
  private station = new MockStation((e) => {
    for (const h of this.handlers) h(e);
  });

  subscribe(handler: (e: StationEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  start() {
    this.station.start();
  }
  stop() {
    this.station.stop();
  }
}

class SupabaseBus implements StationBus {
  private handlers = new Set<(e: StationEvent) => void>();
  private cleanup: (() => void) | null = null;

  subscribe(handler: (e: StationEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  start() {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const client = createClient(url, key);
    const channel = client
      .channel(STATION_CHANNEL)
      .on("broadcast", { event: "station_event" }, ({ payload }) => {
        for (const h of this.handlers) h(payload as StationEvent);
      })
      .subscribe();
    this.cleanup = () => {
      channel.unsubscribe();
      client.removeAllChannels();
    };
  }

  stop() {
    this.cleanup?.();
    this.cleanup = null;
  }
}

export function createBus(): StationBus {
  const source = (import.meta.env.VITE_DATA_SOURCE as string) || "mock";
  if (
    source === "supabase" &&
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY
  ) {
    return new SupabaseBus();
  }
  return new MockBus();
}
