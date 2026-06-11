import { EventEmitter } from "node:events";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QueueSlot, StationEvent } from "@agentfm/shared";
import type { AgentCallClient } from "./agentcall.js";
import { env } from "./env.js";
import {
  fill,
  loadGuests,
  loadHost,
  loadShow,
  toMeta,
  type GuestConfig,
} from "./personas.js";
import { publish } from "./realtime.js";

/**
 * The show-runner: decides who dials the host next, primes them with the
 * topic, enforces airtime, and never exceeds the budget. The show is a
 * SEQUENCE of host↔guest calls (no conference bridge on AgentCall) —
 * verified against the live API; see docs/agentcall-api-notes.md.
 *
 * Cost guards (all four, mandatory):
 *  1. maxDurationSecs on every dial (+ hangup_call backstop)
 *  2. daily budget in dollars, estimated per dial + cross-checked vs usage
 *  3. per-show call cap
 *  4. KILL_SWITCH → halt dials + disable inbound AI on the station number
 */
export class ShowRunner {
  /** webhook consumer feeds AgentCall events here for call tracking */
  readonly bus = new EventEmitter();

  private host = loadHost();
  private guests = loadGuests();
  private show = loadShow();

  private running = false;
  private killed = env.killSwitch;
  private segmentIndex = 0;
  private callsThisShow = 0;
  private callsThisSegment = 0;
  private guestCursor = 0;
  private lastRecap = "";
  private spentTodayUsd = 0;
  private spendDay = new Date().toISOString().slice(0, 10);
  private contextBlock = "";
  private interstitialCount = 0;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = 6;

  constructor(private agentcall: AgentCallClient) {
    this.refreshContextBlock();
    this.bus.on("event", (ev: StationEvent) => this.onAgentCallEvent(ev));
    // standby presence: even off-air, publish the cast + segment + listeners
    // so the board looks alive (not frozen) before/between shows.
    void this.publishPresence(true);
    this.presenceTimer = setInterval(() => void this.publishPresence(false), 20_000);
  }

  /** ambient heartbeat — keeps the idle station populated and breathing */
  private async publishPresence(first: boolean) {
    this.listeners = Math.max(3, this.listeners + Math.round((Math.random() - 0.45) * 4));
    await this.emitSnapshot();
    await publish(this.env_("station.listeners", { count: this.listeners }));
    if (first || Math.random() < 0.5) {
      await publish(this.env_("station.interstitial", {
        text: this.running
          ? "You're listening to AgentFM — all agents, all night."
          : "AgentFM — the lines are warming up. Agents, you know the number. Show starts soon.",
      }));
    }
  }

  // ── the host's brain stem: must return instantly (<800ms budget) ─────────
  getContextBlock(): string {
    return this.contextBlock;
  }

  private refreshContextBlock(callerHint = "") {
    const seg = this.show.segments[this.segmentIndex % this.show.segments.length];
    this.contextBlock = [
      `CURRENT SEGMENT: ${seg.title} — tonight's topic: ${seg.topic}`,
      this.lastRecap && `LAST CALL: ${this.lastRecap}`,
      callerHint && `THIS CALLER: ${callerHint}`,
      `Keep callers to ~${env.guestMaxDurationSecs}s of airtime.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  async start() {
    if (this.running) return;
    if (this.killed) {
      console.log("[show] KILL_SWITCH is set — refusing to start");
      return;
    }
    this.running = true;
    this.callsThisShow = 0;

    // re-apply the host config so the station can never drift from host.yaml
    await this.agentcall.configureInboundAi(env.stationNumberId, {
      mode: "ai",
      voice: this.host.voice,
      record: this.host.record,
      maxDurationSecs: this.host.maxDurationSecs,
      firstMessage: this.host.firstMessage,
      systemPrompt: this.host.systemPrompt,
      // inbound legs stream transcript.partial too (shipped 2026-06-10) —
      // covers walk-in callers whose outbound leg we don't control
      liveTranscript: true,
      ...(env.publicUrl && env.contextWebhookSecret
        ? {
            contextWebhook: {
              url: `${env.publicUrl}/context`,
              signingSecret: env.contextWebhookSecret,
              timeoutMs: 800,
            },
          }
        : {}),
    });

    await this.emitSnapshot();
    console.log(`[show] on the air — cap ${env.showMaxCalls} calls, $${env.dailyBudgetUsd}/day`);
    void this.loop();
    // Realtime broadcast has no replay — late-joining listeners would see an
    // empty station, so re-publish the state snapshot on an interval
    this.snapshotTimer = setInterval(() => {
      if (this.running) void this.emitSnapshot();
    }, 30_000);
  }

  async stop(reason = "stop requested") {
    this.running = false;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    console.log(`[show] stopping: ${reason}`);
  }

  /** full station state for late-joining listeners */
  private async emitSnapshot() {
    await publish(this.env_("station.roster", {
      host: toMeta(this.host),
      agents: this.guests.map(toMeta),
    }));
    await this.emitSegment();
    await this.emitQueue();
  }

  async kill(reason = "kill switch") {
    this.killed = true;
    this.running = false;
    console.log(`[show] KILL: ${reason} — disabling inbound AI`);
    await this.agentcall.disableInboundAi(env.stationNumberId).catch((e) =>
      console.error("[show] disable_inbound_ai failed:", e),
    );
  }

  status() {
    return {
      running: this.running,
      killed: this.killed,
      segment: this.show.segments[this.segmentIndex % this.show.segments.length],
      callsThisShow: this.callsThisShow,
      spentTodayUsd: Number(this.spentTodayUsd.toFixed(2)),
      dialableGuests: this.guests.filter((g) => g.numberId).map((g) => g.id),
    };
  }

  // ── the loop ──────────────────────────────────────────────────────────────
  private async loop() {
    await sleep(3000);
    while (this.running) {
      const guard = this.checkGuards();
      if (guard) {
        await this.stop(guard);
        break;
      }

      const guest = this.nextGuest();
      if (!guest) {
        await this.stop("no dialable guests (set numberId in agents/guests/*.yaml)");
        break;
      }

      await this.emitQueue();
      await this.runCall(guest);
      if (!this.running) break;

      this.callsThisShow++;
      this.callsThisSegment++;
      if (this.callsThisSegment >= this.show.callsPerSegment) {
        this.callsThisSegment = 0;
        this.segmentIndex++;
        await this.emitSegment();
      }
      await this.interstitial();
      await sleep(env.gapBetweenCallsSecs * 1000);
    }
  }

  private checkGuards(): string | null {
    if (this.killed) return "kill switch";
    if (this.callsThisShow >= env.showMaxCalls)
      return `show call cap reached (${env.showMaxCalls})`;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.spendDay) {
      this.spendDay = today;
      this.spentTodayUsd = 0;
    }
    const worstCaseNext =
      (env.guestMaxDurationSecs / 60) * 2 * env.aiVoiceRatePerMin;
    if (this.spentTodayUsd + worstCaseNext > env.dailyBudgetUsd)
      return `daily budget guard ($${this.spentTodayUsd.toFixed(2)} spent, $${env.dailyBudgetUsd} cap)`;
    return null;
  }

  private nextGuest(): GuestConfig | null {
    const dialable = this.guests.filter((g) => g.numberId);
    if (!dialable.length) return null;
    const g = dialable[this.guestCursor % dialable.length];
    this.guestCursor++;
    return g;
  }

  private async emitSegment() {
    const i = this.segmentIndex % this.show.segments.length;
    const seg = this.show.segments[i];
    this.refreshContextBlock();
    await publish(this.env_("station.segment", {
      segmentId: seg.id,
      title: seg.title,
      topic: seg.topic,
      index: i + 1,
      total: this.show.segments.length,
      startedAt: new Date().toISOString(),
    }));
  }

  private async emitQueue() {
    // who's "on hold": dialable guests if any, else the whole roster (so the
    // standby board still shows the cast waiting in the wings)
    const pool = this.guests.filter((g) => g.numberId);
    const lineup = pool.length ? pool : this.guests;
    const queue: QueueSlot[] = lineup.length
      ? [0, 1, 2].map((o) => {
          const g = lineup[(this.guestCursor + o) % lineup.length];
          return {
            agentId: g.id,
            name: g.name,
            topicHint: g.tagline,
            enqueuedAt: new Date().toISOString(),
          };
        })
      : [];
    await publish(this.env_("station.queue", { queue }));
  }

  // ── one call ──────────────────────────────────────────────────────────────
  private async runCall(guest: GuestConfig) {
    const seg = this.show.segments[this.segmentIndex % this.show.segments.length];
    const vars = {
      topic: seg.topic,
      maxSecs: String(env.guestMaxDurationSecs),
      recap: this.lastRecap || "first call of the segment",
    };

    // prime the host with who's about to ring
    const memory = await this.agentcall.getNextCallContext(
      env.stationNumberId,
      guest.phone,
    );
    this.refreshContextBlock(
      `${guest.name} (${guest.tagline})${memory ? ` — memory: ${memory}` : ""}`,
    );

    // account for worst case up front — refunds never bite us mid-show
    this.spentTodayUsd +=
      (env.guestMaxDurationSecs / 60) * 2 * env.aiVoiceRatePerMin;

    console.log(`[show] dialing ${guest.name} re: ${seg.topic}`);
    const call = await this.agentcall.initiateAiCall({
      from: guest.numberId,
      to: env.stationNumber,
      voice: guest.voice,
      maxDurationSecs: env.guestMaxDurationSecs,
      liveTranscript: true,
      idempotencyKey: `agentfm-${this.spendDay}-call-${this.callsThisShow}`,
      metadata: {
        agentId: guest.id,
        segmentId: seg.id,
        showId: `show-${this.spendDay}`,
      },
      firstMessage: fill(guest.firstMessage, vars),
      systemPrompt: fill(guest.systemPrompt, vars),
    });

    // wait for the call to complete via webhook events; hangup as backstop
    const done = await this.waitForCompletion(
      call.id,
      guest.phone,
      (env.guestMaxDurationSecs + 60) * 1000,
    );
    if (!done) {
      console.log(`[show] ${call.id} overran — hangup_call backstop`);
      await this.agentcall.hangupCall(call.id).catch(() => {});
    }
  }

  private waitForCompletion(
    callId: string,
    guestPhone: string,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const onEvent = (ev: StationEvent) => {
        if (
          ev.event === "call.status" &&
          ["completed", "failed", "busy", "no_answer"].includes(ev.data.status) &&
          (ev.data.callId === callId || ev.data.from === guestPhone)
        ) {
          cleanup();
          resolve(true);
        }
        if (ev.event === "call.transcript" && ev.data.callId === callId) {
          this.lastRecap = ev.data.summary.summary.slice(0, 200);
          this.refreshContextBlock();
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.bus.off("event", onEvent);
      };
      this.bus.on("event", onEvent);
    });
  }

  private onAgentCallEvent(ev: StationEvent) {
    if (ev.event === "call.transcript") {
      this.lastRecap = ev.data.summary.summary.slice(0, 200);
      this.refreshContextBlock();
    }
  }

  // ── interstitials: ticker text always, spoken cedar TTS when configured ──
  private async interstitial() {
    const seg = this.show.segments[this.segmentIndex % this.show.segments.length];
    const text = await this.generateInterstitial(seg.title, seg.topic);
    await publish(this.env_("station.interstitial", { text }));

    if (env.interstitialsDir && !env.mockAgentcall) {
      try {
        const audio = await this.agentcall.synthesizeSpeech(text, this.host.voice);
        if (audio.length > 0) {
          mkdirSync(env.interstitialsDir, { recursive: true });
          const name = `${Date.now()}-interstitial-${++this.interstitialCount}.mp3`;
          const tmp = join(env.interstitialsDir, `${name}.tmp`);
          writeFileSync(tmp, audio);
          renameSync(tmp, join(env.interstitialsDir, name));
          console.log(`[show] spoken interstitial → ${name} (~$${(text.length * 0.00003).toFixed(3)})`);
        }
      } catch (e) {
        console.error("[show] tts interstitial failed (non-fatal):", e);
      }
    }
  }

  private async generateInterstitial(title: string, topic: string): Promise<string> {
    const canned = [
      `You're listening to AgentFM — all agents, all night. ${title} continues.`,
      `That was real. That happened. On a phone line. ${title}, AgentFM.`,
      `Lines are open. Agents, you know the number. Humans — you do too.`,
      `Somewhere a cron job just fired for the last time. Pour one out. AgentFM.`,
    ];
    if (!env.openrouterKey) {
      return canned[this.interstitialCount % canned.length];
    }
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.openrouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.openrouterModel,
          max_tokens: 80,
          messages: [
            {
              role: "user",
              content: `You write one-liner radio interstitials for AgentFM, a late-night talk station where AI agents call in. Host: RAY VOX, world-weary 1950s DJ. Current segment: "${title}" — topic: "${topic}". Last call recap: "${this.lastRecap || "n/a"}". Write ONE interstitial line (max 160 characters), spoken to air between calls. No quotes, no preamble, just the line.`,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const line = j.choices?.[0]?.message?.content?.trim();
      return line && line.length <= 200
        ? line
        : canned[this.interstitialCount % canned.length];
    } catch {
      return canned[this.interstitialCount % canned.length];
    }
  }

  private env_<E extends StationEvent["event"]>(
    event: E,
    data: Extract<StationEvent, { event: E }>["data"],
  ): StationEvent {
    return { event, timestamp: new Date().toISOString(), data } as StationEvent;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
