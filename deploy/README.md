# AgentFM deploy — Hostinger VPS via Docker-manager API

Deploys the whole stack as ONE isolated compose project (`agentfm`) on the
existing box (`srv&lt;VM&gt;`, shared with the Hermes agents — never touched).
TLS + routing piggyback on the box's system Traefik (same label pattern the
Hermes agents use). No SSH, no nginx, no manual cert management.

```
                              Traefik (system, Let's Encrypt)
                                       │
   https://DOMAIN/        ────────────┤→ web  (nginx, static SPA)
   https://DOMAIN/api/*   ────────────┤→ engine (webhooks + show-runner)
   https://DOMAIN/stream  ────────────┘→ icecast mount /agentfm
                                            ▲
                            broadcast (Liquidsoap) ──source──┘
                                  ▲ queue volume
                            ingest (AgentCall recordings → queue)
```

## One-time

1. **Registry access** (push images): the box pulls from GHCR.
   ```powershell
   $t = gh auth token; $t | docker login ghcr.io -u Kintupercy --password-stdin
   ```
   If this 403s, the gh token lacks package scope — run
   `gh auth refresh -s write:packages,read:packages` (opens a browser) or use
   a PAT with `write:packages`.

2. **Build + push** the four images:
   ```powershell
   ./deploy/build-and-push.ps1
   ```
   Then make the 4 packages **public** (GitHub → your profile → Packages →
   each → Package settings → Change visibility → Public), so the box pulls
   without auth. Images contain only compiled code + AI-generated audio — no
   secrets (those arrive via the API `environment` field at deploy time).

## Deploy

```bash
node deploy/deploy.mjs          # create/replace the agentfm project
node deploy/deploy.mjs --logs   # watch it come up
node deploy/deploy.mjs --down   # remove it (Hermes unaffected)
```

`deploy.mjs` reads everything from repo-root `.env` and sends secrets in the
API `environment` field. **The first deploy runs with `SHOW_AUTOSTART=false`** —
the engine serves webhooks and the contextWebhook, but does NOT dial, does NOT
reconfigure the host number, and spends nothing. Verify the stack, then start
the show explicitly.

## Verify

- Stream: `https://DOMAIN/stream` plays the station (music + ads + IDs)
- Site: `https://DOMAIN/` loads the switchboard, player points at the stream
- Engine: `https://DOMAIN/api/health` returns `{ ok: true }`

## Go live (after verify)

1. Point the live AgentCall station webhook at the box: set
   `AGENTFM_PUBLIC_URL=https://DOMAIN/api`, redeploy — the engine
   auto-registers the webhook (prints the secret once → put it in `.env` →
   redeploy so signature verification is active).
2. Start the show: `POST https://DOMAIN/api/internal/show/start`
   (needs the internal token, or run it from the box). The engine re-applies
   `agents/host.yaml` to the station number and begins the rundown.
3. Kill anytime: `POST .../api/internal/kill` → halts dials + disables
   inbound AI.

## Domain

The default `DOMAIN` is the free `agentfm.srv&lt;VM&gt;.hstgr.cloud` subdomain —
deploy and verify on it first (zero cost, no DNS wait). For `agentfm.live`:
register it (Hostinger API or hPanel), point an A record at the box's IPv4
(the box's IPv4, in `.env`), set `DOMAIN=agentfm.live` in `.env`, rebuild the web image
(the stream URL is baked in), and redeploy.
