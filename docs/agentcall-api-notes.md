# AgentCall live-API findings (verified 2026-06-09; live-call smoke test 2026-06-10)

## Smoke-test results (authenticated, real calls — 2026-06-10)

Setup: RAY VOX inbound AI on +14242672212 (`cmpm572gz0001na01exn8yone`, the
old "AgentTest" number, record:true, cedar, 90s cap). Two guests dialed in
via `POST /v1/calls/ai` from existing numbers. Session cost ≈ $2.80 (7 billed
AI-voice minutes).

1. **58 MCP tools confirmed** (initialize handshake required before
   tools/list — bare tools/list returns 400). The 3 beyond the documented 55:
   `create_schedule` / `list_schedules` / `cancel_schedule` — proactive
   **SMS** schedules (reminders/digests), not calls. Useful for show promo
   texts; no impact on call architecture. Final: **no conferencing, no live
   transcripts, no standalone TTS anywhere in the 58.**
2. **Concurrency: CONFIRMED ≥2 simultaneous calls on one inbound-AI number.**
   MARVIN-9 (71s) and GOLDIE (60s) overlapped ~48s; both fully answered, no
   busy signal. The hold queue is therefore a SHOW-FORMAT choice (one
   conversation on air at a time), not a capacity workaround — and Phase 3
   walk-ins won't block the show.
3. **Every conversation creates TWO call records**: the guest's outbound leg
   and the station's inbound leg, with mirrored transcript roles. The station
   engine must consume the INBOUND leg (`role: ai` = host). Join them via
   from/to + overlapping timestamps.
4. **REST call status vocabulary ≠ webhook vocabulary**: REST returns
   `initiated → in-progress → completed`; webhook docs say
   `ringing/answered/completed`. The webhook consumer should map both.
5. **REST report shape ≠ webhook report shape**: `GET /v1/calls/:id/report`
   nests the content under `payload` (facts use
   `evidenceQuote`/`confidence`/`scope`, not `quote`), with top-level
   `contact`, `briefWorthy`, `extractor`, `candidates`. The webhook
   `call.report.ready` per docs delivers `data.report.{summary,...}`.
   packages/shared types model the WEBHOOK shape; map REST→shared when
   polling instead of receiving webhooks.
6. **Memory works as advertised**: contact "Marvin" auto-created from the
   call, memory candidates auto-applied with evidence quotes. Recurring
   guests accrue history per caller number with zero extra code.
7. **✅ FIXED 2026-06-10: inbound-AI recording.** Verified live: recording
   materialized < 60s post-call with a signed URL (1h expiry on the
   `/recording` endpoint response), `record:true` + `recordingUrl` both on
   the inbound leg. The broadcast pipeline ran end-to-end the same day:
   real call → ingest → preprocess → ON AIR.

## Infra-prompt verification (2026-06-10, post-fix deploy)

- **P0 recording: FIXED** (see #7).
- **P1 report shape: FIXED** — REST `/report` now returns `report` in the
  webhook shape (facts use `quote`), with `payload` kept as a deprecated
  alias.
- **P1 peerCallId: SHIPPED** — both legs link to each other.
- **P1 transcript clipping: no longer observed** — first entries arrive
  complete.
- **P1 docs sync: FIXED** — llms-full.txt consistently says 59 tools.
- **P1 status vocab: REST unchanged** (`initiated/in-progress/completed`);
  webhook-side vocabulary still unverified (needs our webhook endpoint —
  Phase 2 consumer should log raw payloads on first real events).
- **P2 metadata: SHIPPED** — `metadata` on `initiate_ai_call` (≤24 keys,
  2KB), echoed on the dial response, persisted on the call object, copied
  to the peer inbound leg. The orchestrator should tag every dial with
  `agentId`/`segmentId`/`showId`; ingest already uses `agentId` for titles.
- **P3 live transcripts: SHIPPED** — `liveTranscript: true` on outbound AI
  calls fires `transcript.partial` webhooks (callId, sequence, role, text,
  timestamp) within ~1–2s. OUTBOUND legs only — but a leg transcribes both
  speakers, so guest legs give the full conversation live. Phase 2: dial
  guests with `liveTranscript: true` and relay partials to the UI.
- **P4 TTS: SHIPPED** — `POST /v1/tts` + `synthesize_speech` MCP tool
  (59 total now): text ≤4096 chars, all 10 call voices, mp3/wav,
  **$0.03 per 1k chars**, Pro only. → Host interstitials can be SPOKEN in
  cedar: generate mp3 → drop into a Liquidsoap interstitials queue.
- **P5 voice action bridge: not shipped** (inbound `tools` still SMS-only).
8. Transcript may clip the first ~1s of the host's firstMessage (MARVIN's
   transcript opens mid-word: "FM, you're on the air"). Cosmetic; don't
   anchor parsing to the first words.


Sources: OpenAPI spec `GET api.agentcall.co/docs/json` (72 paths),
`agentcall.co/llms-full.txt` (full 55-tool MCP catalog),
`agentcall.co/docs/post-call-webhook`, `agentcall.co/docs/memory`.
Authenticated MCP `tools/list` was not possible (no API key on the dev
machine) — re-run it once `AGENTCALL_API_KEY` is available:

```bash
curl -s -X POST https://api.agentcall.co/mcp \
  -H "Authorization: Bearer $AGENTCALL_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Architecture-relevant answers

1. **No conference bridge.** Nothing in the 72 REST paths or the tool catalog
   resembles conferencing/bridging/audio streaming. The show is a sequence of
   host↔guest calls; the orchestrator stitches them.
2. **No live transcript stream.** `call.transcript` fires after hangup;
   `call.report.ready` a few seconds later (LLM extraction). UI designed for
   post-call delivery.
3. **Transcript roles are leg-relative**: `ai` = the AI on the receiving leg
   (our host), `human` = the caller — even when the caller is another AI.
4. **contextWebhook (the host's brain stem)**: POSTs on every inbound connect;
   respond `{ "contextBlock": "..." }` within **800ms default / 1500ms max**
   or the call proceeds on the static prompt (fail-open). HMAC-SHA256 in
   `X-AgentCall-Signature: sha256=<hex>`. ⇒ precompute the context block on
   every state change; the endpoint just reads it. No LLM in the request path.
5. **Inbound-AI concurrency is still unverified** — test with two simultaneous
   guest dials before building the queue logic. If serialized, the hold queue
   lives in our orchestrator (stagger `initiate_ai_call`).

## Capabilities beyond the documented 43 tools

- **BYOK voice billing** (`set_byok_openai_key` / `disable_byok`,
  `POST /v1/numbers/{id}/byok/key|test`): **$0.10/min instead of $0.40/min**
  per AI leg with your own OpenAI key. Per-number, Pro only, memory parity.
  → Station + guest numbers on BYOK ≈ **$12/hour of show vs $48/hour.**
- **Saved outbound agents per number** (`set_outbound_defaults`,
  `useSavedAgent: true` on `initiate_ai_call`): store each guest persona ON
  its number; the orchestrator dials with per-call overrides only
  (topic-primed firstMessage/systemPrompt). Plus `idempotencyKey` (per-number,
  retry-safe) — use it on every orchestrator dial.
- **`language` param** (13 codes + auto) on both inbound and outbound AI.
- **Premium voices** (ElevenLabs-class, `$0.59/min`) — skip; built-ins suffice.
- **Two-way AI SMS + relay mode + Action Bridge** (`smsMode`, `actionWebhook`,
  `tools` max 8, `agentWebhook`, `allowedSenders`): the *SMS* agent can call
  declared tools today; docs say the same bridge "will power in-call voice
  actions" — when that ships, the host can take mid-call actions (advance
  segment, screen caller). Watch for it.
- **Number schedules** (`/v1/numbers/{id}/schedules` GET/POST/DELETE) — in the
  spec but undocumented and not in the MCP catalog; likely one of the newest
  additions. Probe once authenticated.
- **Prompt templates** (`GET /v1/calls/prompt-templates`, public) and voice
  previews (`GET /v1/calls/voices`, public — use for host voice auditions).
- **Briefs inbox** (`/v1/briefs`), contact memory endpoints, personal-phone
  verification, dashboard key management.

## Webhook payloads (confirmed)

Envelope: `{ "event": "...", "timestamp": ISO8601, "data": {...} }`.
Retries: exponential backoff on non-2xx. Dedup key: `callId`.
Return 2xx immediately after verifying signature + persisting; process async.

- `call.transcript.data`: `{ callId, duration, transcript[{role, text, timestamp}], summary{ summary, callerName, intent, urgency, callbackBy, spam } }`
  - intent enum: `service_request|quote_request|scheduling|complaint|spam|general_inquiry|other`
  - `spam: true` flags robocalls/hostile callers — free screening assist for Phase 3.
- `call.report.ready.data`: `{ callId, contactId, report{ summary, intent, urgency, entities[], facts[{text,quote}], decisions[], commitments[{owner,task}], tasks[], preferences[], unresolved[], risks[], nextAction, nextCallContext, ownerBrief } }`
- `call.inbound` / `call.status` / `call.recording` shapes are not fully
  documented; the Phase 2 consumer should log raw payloads for the first
  real calls and tighten the types in `packages/shared`.

## Pricing facts for the budget guard

- AI voice: $0.40/min/leg managed, $0.10/min/leg BYOK. Recording +$0.01/min.
- Recording on inbound AI auto-prepends a TCPA disclosure to the host's
  spoken first message (it will be audible on-air — lean into it as a bit).
- `maxDurationSecs`: 10–3600, default 600. Numbers $2/mo. Pro $19.99/mo.
- `GET /v1/usage?period=YYYY-MM` returns `breakdown.voiceAi.{minutes,cost}`,
  `recording`, `total` — poll it for the daily budget reconciliation.
