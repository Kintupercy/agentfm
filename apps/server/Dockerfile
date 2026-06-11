# AgentFM station engine — webhook consumer + show-runner.
FROM node:20-slim
WORKDIR /app

# workspace manifests first (layer cache). tsx (the TS runner) is a
# devDependency, so install the full tree, not --omit=dev.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace=@agentfm/server --include-workspace-root

# source (tsx runs TS directly — no build step)
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
COPY agents/ agents/

ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "run", "start", "--workspace=@agentfm/server"]
