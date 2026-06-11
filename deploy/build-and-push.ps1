# Build + push the 4 AgentFM images to GHCR. Run from repo root.
# Prereq: docker login ghcr.io (token needs write:packages).
#   $t = gh auth token; $t | docker login ghcr.io -u Kintupercy --password-stdin
# VITE_* build args come from .env (the web bundle bakes them in).
$ErrorActionPreference = "Stop"
$REG = "ghcr.io/kintupercy"

# read VITE_* from .env
$envFile = Get-Content .env
function E($k) { ($envFile | Select-String "^$k=(.*)").Matches.Groups[1].Value }
$SUPA_URL = E "VITE_SUPABASE_URL"
$SUPA_KEY = E "VITE_SUPABASE_ANON_KEY"
$DOMAIN   = E "DOMAIN"   # set in .env (e.g. agentfm.srv<VM>.hstgr.cloud or agentfm.live)
if (-not $DOMAIN) { throw "set DOMAIN in .env" }
$STREAM   = "https://$DOMAIN/stream"

Write-Host "Building web (stream=$STREAM)…"
docker build -f apps/web/Dockerfile `
  --build-arg VITE_SUPABASE_URL=$SUPA_URL `
  --build-arg VITE_SUPABASE_ANON_KEY=$SUPA_KEY `
  --build-arg VITE_STREAM_URL=$STREAM `
  -t "$REG/agentfm-web:latest" .

docker build -f apps/server/Dockerfile -t "$REG/agentfm-engine:latest" .
docker build -f apps/audio/Dockerfile.broadcast -t "$REG/agentfm-broadcast:latest" .
docker build -f apps/audio/Dockerfile.ingest -t "$REG/agentfm-ingest:latest" .

foreach ($img in "web","engine","broadcast","ingest") {
  Write-Host "Pushing $img…"
  docker push "$REG/agentfm-$img:latest"
}
Write-Host "Done. Make the 4 packages public in GitHub → Packages, then: node deploy/deploy.mjs"
