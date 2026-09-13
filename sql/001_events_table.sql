-- Event log: one row per search, one row per result click.
-- Run this in the Supabase SQL editor. This file is kept in git as a
-- record of what's been applied to the database — the DB itself has
-- no memory of its own migration history unless we write it down.

create table events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- 'search' or 'click'
  event_type text not null check (event_type in ('search', 'click')),

  -- ties a click back to the search that produced it; also the id
  -- carried on the search event itself
  query_id uuid not null,

  -- groups every event from one browser across multiple searches
  session_id text not null,

  -- search events only
  query_text text,
  stop_count int,
  route_count int,

  -- click events only
  target_type text check (target_type in ('station', 'route')),
  target_id text,
  target_label text,

  -- a click row must say what was clicked; a search row doesn't need to
  constraint click_has_target check (
    event_type = 'search'
    or (target_type is not null and target_id is not null)
  )
);

create index events_query_id_idx on events (query_id);
create index events_created_at_idx on events (created_at);

alter table events enable row level security;

-- Anyone can log an event (INSERT), but nobody can read the log back
-- through the public API — only via the SQL editor, which runs as you
-- and bypasses RLS entirely.
create policy events_insert_anon
  on events for insert
  to anon
  with check (true);
