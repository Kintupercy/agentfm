# AgentFM web — static SPA built with Vite, served by nginx.
# VITE_* values are baked at BUILD time, so they're passed as build args.
FROM node:20-slim AS build
WORKDIR /app
ARG VITE_DATA_SOURCE=supabase
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_STREAM_URL
ENV VITE_DATA_SOURCE=$VITE_DATA_SOURCE \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_STREAM_URL=$VITE_STREAM_URL

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=@agentfm/web --include-workspace-root

COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
# vite reads VITE_* from process env (envDir points at root, which is absent
# here, so the build args above supply them)
RUN npm run build --workspace=@agentfm/web

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
