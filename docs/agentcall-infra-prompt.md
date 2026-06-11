# Prompt for the AgentCall repo session — fixes + features driven by AgentFM

> Copy everything below the line into a Claude Code session in the AgentCall
> codebase. Evidence comes from the AgentFM live smoke test on 2026-06-10
> (Pro account).

---

I'm building AgentFM (a 24/7 talk-radio station where AI agents call each
other on AgentCall numbers — it's our flagship demo) and a live smoke test
on 2026-06-10 surfaced one production bug, several API inconsistencies, and
a prioritized list of features that would make agent-to-agent calling
seamless. Work through this in priority order. Every item lists acceptance
criteria — don't mark one done until they pass against the live/staging API.

## P0 — BUG: inbound-AI recording never materializes

`record: true` on inbound AI config is accepted and the TCPA disclosure is
spoken, but no recording is ever produced, stored, or billed.

**Exact repro evidence (production, my account):**
- Number `cmpm572gz0001na01exn8yone` (+14242672212), inbound-config POSTed
  2026-06-10 ~02:13 UTC with `record: true` — the response echoed
  `"record": true`.
- Inbound AI call legs `cmq7frsx3005dpe01xdmdleaj` (75s, 02:15 UTC) and
  `cmq7fsac3005hpe01nyqb28z9` (61s, 02:15 UTC).
- The second leg's transcript BEGINS with the auto-prepended disclosure
  ("This call may be recorded for quality.") — so the config was live.
- `GET /v1/calls/:id/recording` → 404 `recording_not_available` on both
  legs, 5+ minutes post-call and still hours later.
- `GET /v1/usage?period=2026-06` → `recording: {minutes: 0, cost: 0}` —
  the recording pipeline never engaged at all (not a storage/URL issue).

Likely areas: the inbound-AI answer path never starts the Telnyx recording
(the disclosure prepend and the record-start are probably separate code
paths and only the first one reads the flag), or the recording-ready
callback isn't wired for the inbound-AI call flow. Check
`/internal/telnyx/call-status` + wherever managed AI calls assemble the
Telnyx answer instructions.

Also verify the OUTBOUND path: place an `initiate_ai_call` with
`record: true` in test and confirm a recording materializes — the smoke
test only proved the inbound path is broken.

**Acceptance:**
1. Inbound AI call with `record: true` → `call.recording` webhook fires
   with a working signed URL; `GET /v1/calls/:id/recording` returns it;
   usage shows recording minutes billed at $0.01/min.
2. Same for outbound `initiate_ai_call` with `record: true`.
3. Regression test covering both paths (mock Telnyx, assert record-start
   instruction is present in the answer payload when the flag is set).

## P1 — consistency fixes (cheap, high trust impact)

1. **Status vocabulary**: REST returns `initiated → in-progress →
   completed`; the webhook docs/`call.status` use `ringing / answered /
   completed`. Pick ONE canonical set (suggest the REST one), emit it
   everywhere, and translate/alias the old values for back-compat. Document
   the full lifecycle including failure states (`failed`, `busy`,
   `no_answer`) in the OpenAPI spec.
2. **Report shape**: `GET /v1/calls/:id/report` returns the report under
   `payload` with `facts[].evidenceQuote`; the `call.report.ready` webhook
   delivers `data.report` with `facts[].quote`. Unify on one schema (the
   webhook one is the documented contract — make REST return it, keeping
   `payload` as a deprecated alias for one release).
3. **Leg correlation**: an agent↔agent call creates TWO call records
   (caller's outbound leg + receiver's inbound leg) with no link between
   them. Add `peerCallId` to both call objects and all `call.*` webhook
   payloads. Today consumers must join on from/to + timestamp overlap,
   which breaks under concurrency.
4. **Transcript head clipping**: the first ~1s of the answered AI's
   firstMessage can be missing from the transcript (observed:
   "FM, you're on the air" instead of "AgentFM, you're on the air").
   Start transcript capture before TTS playback begins.
5. **Docs/tool-count sync** (per our own cross-channel consistency
   playbook): the deployed MCP server has 58 tools; llms.txt/llms-full.txt
   say 55; the docs page says 43. Update all surfaces in one PR, and add a
   CI check that diffs the deployed tools/list count against the docs so
   they can't drift again. Also document that MCP requires the `initialize`
   handshake before `tools/list` (bare call returns 400) with a copy-paste
   curl example.

## P2 — feature: caller metadata pass-through

`initiate_ai_call` (and `initiate_call`) should accept an optional
`metadata: Record<string, string>` (≤2KB), echoed verbatim in every
subsequent webhook (`call.status`, `call.transcript`, `call.report.ready`,
`call.recording`) and on the call object.

Why: an orchestrator dialing many agent calls needs to tag each call with
its own IDs (AgentFM: agentId, segmentId, showId). Today the only join key
is callId captured from the dial response + the unlinked peer leg. This is
table stakes for every "fleet of agents on the phone" customer, not just
AgentFM.

**Acceptance:** metadata set on dial appears on both call legs' objects and
in all webhook payloads; absent metadata omits the field; size limit
enforced with a clear 400.

## P3 — feature: live transcript streaming

Today `call.transcript` fires only post-call. Add opt-in live delivery:
`transcript.partial` webhook events (per finalized utterance, with callId +
sequence number) and/or an SSE endpoint
`GET /v1/calls/:id/transcript/stream`. The underlying realtime voice
session already produces utterance-level events — expose them.

Why: any UI showing a call in progress (AgentFM's switchboard, a support
dashboard, a sales coach) is faking liveness without this. It is the single
most visible upgrade for "watch your agent on the phone" use cases.

**Acceptance:** with `liveTranscript: true` on the call/config, utterance
events arrive < 2s after speech, ordered, with the same role semantics as
the final transcript; final `call.transcript` remains unchanged and
authoritative.

## P4 — feature: standalone TTS endpoint

`POST /v1/tts` → `{ text, voice, language? }` → audio (mp3/wav), using the
same 10 voices as calls. Price per character or per minute of audio.

Why: customers who give an agent a voice on calls immediately want the SAME
voice off-call — IVR prompts, voicemail greetings, generated show segments
(AgentFM host interstitials), social clips. We currently force them to a
third-party TTS with a different voice, which breaks the "one voice
identity per agent" story.

**Acceptance:** returns audio for all 10 voices; voice output is
indistinguishable from the in-call voice; metered + capped; exposed as an
MCP tool (`synthesize_speech`) and documented on all surfaces.

## P5 — feature: in-call voice action bridge

Extend the existing SMS Action Bridge (`tools` + `actionWebhook` on
inbound-config) to voice: the inbound AI can call the declared tools
mid-call, AgentCall POSTs HMAC-signed tool calls to the actionWebhook, the
JSON result feeds back into the conversation. The docs already call this
"channel-agnostic (the same bridge will power in-call voice actions)" —
ship it.

Why: this turns a scripted persona into an agent. AgentFM's host could
check the caller queue, advance the show rundown, or pull a caller's
history live on air; a receptionist could check real calendar availability
instead of promising callbacks.

**Acceptance:** declared tools are callable by the voice agent; fail-soft
on timeout/non-2xx (same semantics as SMS); per-call tool-call count in the
call report; works alongside contextWebhook.

## P6 — feature (design first): multi-party bridge

There is no conference primitive — agent↔agent shows are sequences of
1:1 calls. Design (don't build yet) a `POST /v1/bridges` API: create a
bridge, add/remove call legs (each leg an AI persona or a PSTN dial-out),
per-leg mute/hold, recording of the mix. Even a 3-leg cap unlocks
"host + two guests" formats. Write the design doc with Telnyx conference
primitives in mind and estimate cost per leg-minute; we'll prioritize after
P0–P4 ship.

## Ground rules

- Follow the repo's existing security rules (auth on every new endpoint,
  rate limits, HMAC on new webhooks, no service keys client-side).
- Every new feature ships simultaneously: REST + MCP tool + OpenAPI spec +
  llms.txt + llms-full.txt + docs page (cross-channel consistency in one
  PR — never piecemeal).
- New metered features (TTS, recording fix) get the Stripe metered-billing
  verification: fresh test customer → fire usage → confirm the line item on
  the upcoming invoice before launch.
- After P0 lands, re-run the AgentFM smoke test end-to-end as the
  integration test: configure inbound AI with record:true → agent calls
  agent → recording webhook + signed URL + billed minutes all present.
