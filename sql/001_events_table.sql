-- Event log: one row per search, per result click, and per ask-box question.
--
-- RECONSTRUCTION, 2026-10-23. This file is NOT the original migration. The
-- table was first created on Supabase from a 2-type, 11-column draft, then
-- dumped and restored into Neon, and the live table has since gained columns
-- that were never written down. This file was rebuilt from read-only queries
-- against the live Neon database (project amtrak-explorer):
-- information_schema.columns, pg_constraint, pg_indexes, pg_policies, pg_class.
-- It describes what is live today; re-running it on a fresh database would
-- produce an equivalent table. Nothing here was applied to the live database.
--
-- event_type values in use: 'search', 'click' (written by the browser via
-- /api/log) and 'ask' (written by the server only, from /api/ask). There is
-- deliberately NO check constraint on event_type: the browser-postable list
-- lives in api/log.js, so a new type needs no migration.
--
-- Which columns each type uses:
--   search : query_id, query_text, stop_count, route_count
--   click  : query_id (ties it to its search), target_type, target_id,
--            target_label, result_position, result_group
--   ask    : query_text (the question); everything else in `metadata`:
--            answer, tool_calls [{name, input, row_count | error}], rounds,
--            latency_ms, input_tokens, output_tokens, model, prompt_version,
--            error (only when the ask failed)

create table public.events (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  event_type      text        not null,

  -- device_id: this browser, forever (localStorage). session_id: one visit
  -- (sessionStorage). Both are NOT NULL, so a caller that has neither (curl,
  -- the remote eval runner) is logged as 'unknown' by ask-log.js.
  device_id       text        not null,
  session_id      text        not null,

  query_id        uuid,
  query_text      text,
  stop_count      integer,
  route_count     integer,

  target_type     text,
  target_id       text,
  target_label    text,
  result_position integer,
  result_group    text,

  -- Escape hatch so new event types don't need a migration.
  metadata        jsonb       not null default '{}'::jsonb,

  -- A click row must say what was clicked; other types don't need to.
  constraint click_has_target check (
    event_type <> 'click'
    or (target_type is not null and target_id is not null)
  )
);

create index events_created_at_idx on public.events (created_at);
create index events_query_id_idx   on public.events (query_id);
create index events_session_id_idx on public.events (session_id);
create index events_type_time_idx  on public.events (event_type, created_at);

-- ROW LEVEL SECURITY: enabled, but with ZERO policies, and effectively inert.
--
-- The original Supabase draft enabled RLS and added an INSERT policy for the
-- `anon` role. Neon has no `anon` role, so that policy failed to restore (the
-- migration recipe in CLAUDE.md expects this) and pg_policies for this table
-- is empty today. RLS itself stayed switched on.
--
-- It does nothing for this app: the Vercel functions connect as the table
-- owner (neondb_owner), and owners bypass RLS unless it is FORCEd
-- (relforcerowsecurity is false). So every insert and select from our
-- functions works exactly as if RLS were off. It would only block a
-- different, non-owner role, and no such role is used. Don't mistake it for
-- active protection: the real protection is that the browser never talks to
-- the database (only to our endpoints).
alter table public.events enable row level security;
