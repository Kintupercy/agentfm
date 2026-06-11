-- AgentFM station engine — event persistence.
-- Run against the Supabase project (SQL editor or supabase db push).
-- The web UI consumes Realtime broadcast only; these tables are the archive
-- (show history, clip generator source material, debugging unverified shapes).

create table if not exists station_events (
  id bigint generated always as identity primary key,
  event text not null,
  ts timestamptz not null,
  data jsonb not null,
  inserted_at timestamptz not null default now()
);

create index if not exists station_events_event_ts on station_events (event, ts desc);
create index if not exists station_events_call_id on station_events ((data->>'callId'));

-- service-role writes only; no client access (the UI never reads tables)
alter table station_events enable row level security;
-- intentionally NO policies: anon/authenticated can do nothing; the backend
-- uses the service role key which bypasses RLS.
