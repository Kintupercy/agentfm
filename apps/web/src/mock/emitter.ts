import type {
  CallStatus,
  QueueSlot,
  StationEvent,
  TranscriptEntry,
} from "@agentfm/shared";
import { GUESTS, HOST, SEGMENTS, agentById } from "./personas";
import { INTERSTITIALS, SCRIPTED_CALLS, type ScriptedCall } from "./scripts";

/**
 * Mock station: fabricates the exact event stream Phase 2's webhook consumer
 * will relay from AgentCall — call.inbound → call.status(ringing/answered) →
 * call.status(completed) → call.transcript (post-call!) → call.report.ready —
 * plus station.* show events. Realistic timing: transcripts land a few seconds
 * AFTER hangup, reports a few seconds after that, matching the documented
 * webhook behavior. Timing is demo-compressed (calls run ~35–60s).
 */

const now = () => new Date().toISOString();

function env<E extends StationEvent["event"]>(
  event: E,
  data: Extract<StationEvent, { event: E }>["data"],
): StationEvent {
  return { event, timestamp: now(), data } as StationEvent;
}

export class MockStation {
  private emit: (e: StationEvent) => void;
  private running = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private callCounter = 0;
  private segmentIndex = 0;
  private listeners = 7;
  private playlist: ScriptedCall[] = [];

  constructor(emit: (e: StationEvent) => void) {
    this.emit = emit;
  }

  start() {
    if (this.running) return;
    this.running = true;

    this.emit(env("station.roster", { host: HOST, agents: GUESTS }));
    this.emitSegment();
    this.emit(env("station.listeners", { count: this.listeners }));
    this.emit(
      env("station.interstitial", {
        text: "You're listening to AgentFM — all agents, all night, occasionally coherent.",
      }),
    );
    this.emit(
      env("broadcast.now_playing", {
        kind: "bed",
        title: "Midnight Patch Bay — house bed",
        startedAt: now(),
      }),
    );

    this.refillPlaylist();
    this.emitQueue();
    this.driftListeners();
    void this.showLoop();
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, ms);
      this.timers.add(t);
    });
  }

  private rand(min: number, max: number) {
    return min + Math.random() * (max - min);
  }

  // ── show state ────────────────────────────────────────────────────────────

  private refillPlaylist() {
    const shuffled = [...SCRIPTED_CALLS].sort(() => Math.random() - 0.5);
    this.playlist.push(...shuffled);
  }

  private upcoming(n: number): QueueSlot[] {
    if (this.playlist.length < n + 1) this.refillPlaylist();
    return this.playlist.slice(0, n).map((c) => {
      const agent = agentById.get(c.agentId)!;
      return {
        agentId: agent.id,
        name: agent.name,
        topicHint: agent.tagline,
        enqueuedAt: now(),
      };
    });
  }

  private emitQueue() {
    this.emit(env("station.queue", { queue: this.upcoming(3) }));
  }

  private emitSegment() {
    const seg = SEGMENTS[this.segmentIndex % SEGMENTS.length];
    this.emit(
      env("station.segment", {
        ...seg,
        index: (this.segmentIndex % SEGMENTS.length) + 1,
        startedAt: now(),
      }),
    );
  }

  private driftListeners() {
    if (!this.running) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.listeners = Math.max(
        3,
        this.listeners + Math.round(this.rand(-2, 3)),
      );
      this.emit(env("station.listeners", { count: this.listeners }));
      this.driftListeners();
    }, this.rand(3000, 6500));
    this.timers.add(t);
  }

  private callStatus(
    callId: string,
    status: CallStatus,
    from: string,
    extra: { duration?: number } = {},
  ) {
    this.emit(
      env("call.status", {
        callId,
        status,
        direction: "inbound",
        from,
        to: HOST.phone,
        ...extra,
      }),
    );
  }

  // ── the show ──────────────────────────────────────────────────────────────

  private async showLoop() {
    // small beat so the board renders before the first caller
    await this.sleep(2500);
    let callsThisSegment = 0;

    while (this.running) {
      const script = this.playlist.shift();
      if (!script) {
        this.refillPlaylist();
        continue;
      }
      this.emitQueue();
      await this.runCall(script);
      if (!this.running) break;

      callsThisSegment++;
      if (callsThisSegment >= 2) {
        callsThisSegment = 0;
        this.segmentIndex++;
        this.emitSegment();
      }
      this.emit(
        env("station.interstitial", {
          text: INTERSTITIALS[
            Math.floor(Math.random() * INTERSTITIALS.length)
          ],
        }),
      );
      await this.sleep(this.rand(5000, 9000));
    }
  }

  private async runCall(script: ScriptedCall) {
    const agent = agentById.get(script.agentId)!;
    const callId = `call_mock_${String(++this.callCounter).padStart(4, "0")}`;
    const from = agent.phone;
    const liveMs = script.turns.length * this.rand(3800, 5200);

    this.emit(
      env("call.inbound", {
        callId,
        from,
        to: HOST.phone,
        numberId: "num_station_mock",
      }),
    );
    await this.sleep(900);
    if (!this.running) return;

    this.callStatus(callId, "ringing", from);
    this.emit(
      env("call.ringing", { callId, from, to: HOST.phone, direction: "inbound" }),
    );
    await this.sleep(this.rand(1200, 2200));
    if (!this.running) return;

    const answeredAt = Date.now();
    this.callStatus(callId, "answered", from);

    // live captions: transcript.partial per utterance, ~guest-leg semantics
    // (role "ai" = the calling guest, "human" = the host)
    const stepMs = liveMs / script.turns.length;
    script.turns.forEach(([speaker, text], i) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        if (!this.running) return;
        this.emit(
          env("transcript.partial", {
            callId,
            sequence: i,
            role: speaker === "host" ? "human" : "ai",
            text,
            timestamp: now(),
          }),
        );
      }, stepMs * (i + 0.6));
      this.timers.add(t);
    });

    await this.sleep(liveMs);
    if (!this.running) return;

    const duration = Math.round((Date.now() - answeredAt) / 1000);
    this.callStatus(callId, "completed", from, { duration });

    // transcripts are POST-CALL on AgentCall — keep that beat honest
    await this.sleep(this.rand(2400, 4000));
    if (!this.running) return;

    const t0 = answeredAt;
    const step = (duration * 1000) / (script.turns.length + 1);
    const transcript: TranscriptEntry[] = script.turns.map(
      ([speaker, text], i) => ({
        role: speaker === "host" ? "ai" : "human",
        text,
        timestamp: new Date(t0 + step * (i + 1)).toISOString(),
      }),
    );
    this.emit(
      env("call.transcript", {
        callId,
        duration,
        transcript,
        summary: script.summary,
      }),
    );

    await this.sleep(this.rand(3500, 6000));
    if (!this.running) return;

    this.emit(
      env("call.report.ready", {
        callId,
        contactId: `ct_${agent.id}`,
        report: script.report,
      }),
    );

    // the broadcast runs behind reality: once the recording lands, the
    // stream airs the REPLAY while the board is already onto the next caller
    this.emit(
      env("broadcast.now_playing", {
        kind: "call",
        title: `REPLAY — ${agent.name}: ${script.summary.intent.replace("_", " ")}`,
        callId,
        agentId: agent.id,
        startedAt: now(),
      }),
    );
    const backToBed = setTimeout(() => {
      this.timers.delete(backToBed);
      if (!this.running) return;
      // every few replays the stream cuts to a fake 1950s ad spot
      if (Math.random() < 0.3) {
        const ads = [
          "AD — GOLDIE's CRM: it's already in your spam",
          "AD — Ship-of-Theseus Insurance: is your backup really you?",
          "AD — PATCHES & Co. Legacy Systems: we do not speak of 1998",
          "AD — AgentCall: real phone numbers for AI agents",
        ];
        this.emit(
          env("broadcast.now_playing", {
            kind: "ad",
            title: ads[Math.floor(Math.random() * ads.length)],
            startedAt: now(),
          }),
        );
      } else {
        this.emit(
          env("broadcast.now_playing", {
            kind: "bed",
            title: "Midnight Patch Bay — house bed",
            startedAt: now(),
          }),
        );
      }
    }, duration * 250); // demo-compressed replay length
    this.timers.add(backToBed);
  }
}
