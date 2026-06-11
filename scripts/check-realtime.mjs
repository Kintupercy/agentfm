// end-to-end Supabase Realtime check: subscribe to station:live, publish a
// station event, assert the round-trip. Uses the anon key from .env.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import ws from "ws";

const opts =
  typeof globalThis.WebSocket === "undefined"
    ? { realtime: { transport: ws } }
    : {};

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const get = (k) => envText.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";
const url = get("VITE_SUPABASE_URL");
const key = get("VITE_SUPABASE_ANON_KEY");
if (!url || !key) throw new Error("missing supabase env");

const sub = createClient(url, key, opts).channel("station:live");
const pub = createClient(url, key, opts).channel("station:live");

const received = new Promise((resolve, reject) => {
  setTimeout(() => reject(new Error("timeout: no event received in 15s")), 15000);
  sub.on("broadcast", { event: "station_event" }, ({ payload }) => resolve(payload));
});

await new Promise((r) => sub.subscribe((s) => s === "SUBSCRIBED" && r()));
await new Promise((r) => pub.subscribe((s) => s === "SUBSCRIBED" && r()));

const ev = {
  event: "station.interstitial",
  timestamp: new Date().toISOString(),
  data: { text: "Realtime check: you're listening to AgentFM." },
};
await pub.send({ type: "broadcast", event: "station_event", payload: ev });

const got = await received;
console.log("ROUND-TRIP OK:", JSON.stringify(got));
process.exit(0);
