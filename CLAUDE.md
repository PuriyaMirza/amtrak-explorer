# amtrak-explorer

A learning project, not a product. The goal is for Puriya (a senior PM, not a
professional engineer) to build real SQL, analytics-instrumentation, and
AI-product skills by shipping something real with actual Amtrak data.

**Live:** https://amtrak-explorer.vercel.app
**Repo:** https://github.com/PuriyaMirza/amtrak-explorer
**Database:** Neon project `amtrak-explorer`, AWS US East 1 (N. Virginia)

---

## How to work on this project

This matters as much as the code. Read it before doing anything.

- **Explain in plain language as you go** — what you're about to do and why,
  in terms someone still building their fundamentals can follow. Don't write
  code silently and hand over a diff.
- **One step at a time.** Give one step, wait for confirmation, then the next.
- **Always name the file** being edited at the top of each step.
- **When introducing a new concept** (a library, a pattern, a technique),
  briefly explain what it is and why it's the right tool here.
- **Push back directly** when an approach seems wrong. Deference is not helpful.
- **Flag scope creep** — if a task is turning into nested sub-projects, say so
  and let Puriya decide whether it's worth it.
- **Don't send him to the terminal for things a GUI does faster.** Terminal is
  for things that *run*: npm, git, psql, pg_dump. Creating files and folders is
  faster in Finder or VS Code. Write file contents directly rather than handing
  over heredocs to paste.
- **Be concise.** Bullets and tables over paragraphs where they fit.

### Debugging lessons learned the hard way

**The empty file.** A trivial `api/hello.js` returned `500
FUNCTION_INVOCATION_FAILED` with "No exports found in module" for weeks. The
cause: the file was 0 bytes. VS Code had warned about unsaved changes and the
content never hit disk. Two rounds of `package.json` `"type"` toggling chased
the wrong thing, and one "fix" commit was never pushed.

**The paused database.** Supabase free tier auto-paused after a week of
inactivity, silently breaking the live site. Diagnosed twice as a code problem
before anyone checked project status.

Rules that came out of these:
- **Verify the artifact, not the intent.** `wc -c` the file. Check what the
  host actually deployed, not what you think you wrote.
- **Confirm the push landed** (`git status -sb` shows `[ahead N]` if not).
- **Check infrastructure state first** when something breaks after a gap.
- **Don't stack two unknowns.** Test one change before making the next.

---

## Stack

| Layer | What |
|---|---|
| Database | Neon (serverless Postgres 18.6) |
| Frontend | Plain HTML/JS/CSS, no framework, no build step |
| Backend | Vercel serverless functions — all database access goes through these |
| Hosting | Vercel, auto-deploys on push to `main` |

`npx serve` for local static dev, but it can't run the `api/` functions —
test those on the deployed site, or use `vercel dev`.

### Files
```
index.html          search UI + natural-language ask UI; no DB client
search.js           searchTrains(sql, {query, limit}) — SINGLE SOURCE OF TRUTH
events.js           logEvent(type, fields) — POSTs to /api/log, fire-and-forget
styles.css
api/search.js       GET  /api/search?q=   → searchTrains
api/log.js          POST /api/log         → inserts one events row
api/ask.js          POST /api/ask         → Claude tool-calling loop
sql/                schema history (SEE WARNING BELOW)
```

### The architecture rule

**The browser never touches the database.** It calls our own endpoints; those
hold the credentials and talk to Postgres.

This was a deliberate choice during the Neon migration. Neon's Data API
requires a JWT even for anonymous reads, which would have meant enabling an
auth service for an app with no users. Routing through functions removed that
whole category of complexity — no RLS, no JWTs, no auth service — and keeps
database credentials strictly server-side.

**`search.js` takes the `sql` client as a parameter** rather than importing one
(dependency injection). That's what lets `api/search.js` and `api/ask.js` share
one implementation. **Do not give any endpoint its own query logic.**

---

## Database

Neon project `amtrak-explorer`. Connection string lives in Vercel as
`DATABASE_URL` (Secret; Production, Preview, Development).

- **Pooled** connection string for the app — serverless functions connect and
  disconnect constantly.
- **Unpooled** for migrations and `pg_dump`/`pg_restore`.
- Driver is `@neondatabase/serverless`, which talks over HTTP, so each query is
  its own request and there is no connection-pool exhaustion to manage.

| Table | Rows | Notes |
|---|---|---|
| `stops` | 645 | has `stop_lat`/`stop_lon` — needed for the planned weather feature |
| `routes` | 61 | `route_short_name` is null in this feed; use `route_long_name` |
| `trips` | 2,732 | |
| `stop_times` | 35,691 | times run past `24:00:00` for overnight trips |
| `calendar` | 392 | |
| `events` | growing | usage log |

### `events` columns (15)
```
id, created_at, event_type, device_id, session_id, query_id,
query_text, stop_count, route_count,
target_type, target_id, target_label, result_position, result_group,
metadata (jsonb)
```

Deliberate choices:
- `device_id` (localStorage, forever) vs `session_id` (sessionStorage, one
  visit) are **separate**
- `result_position` + `result_group` — so "do people click the top result?" is
  answerable later
- `metadata jsonb` — escape hatch so new event types don't need a migration
- **No enum check on `event_type` in the table.** Validation lives in
  `api/log.js` instead, as a whitelist. Easy to extend, still a real gate.
- `api/log.js` lists insertable columns **explicitly** so a caller can't write
  to unintended columns.

### ⚠️ Known cleanup items

1. **`sql/001_events_table.sql` is stale** — it's the first draft, not the
   15-column schema actually live, and it still contains Supabase-specific RLS.
2. **The RLS policies are now inert.** They migrated across from Supabase, but
   the functions connect as the table owner, which bypasses RLS. They do
   nothing. Either drop them or leave them as harmless residue — but don't
   mistake them for active protection.
3. **`events` has no logging from the ask box.** `/api/ask` doesn't call
   `logEvent`, so natural-language questions aren't captured. Worth adding
   before any usage analysis.

### Migrating another project to Neon (recipe that worked)

Postgres client tools come from Postgres.app; `/etc/paths.d/postgresapp` puts
them on PATH. Supabase free projects only accept **direct** connections over
IPv6, so use the **Session pooler** string (port 5432, not Transaction/6543).

```bash
read -s SUPA_PW        # paste password, never type it into a command
pg_dump -Fc -v --schema=public --no-owner --no-acl \
  -d "postgresql://postgres.<ref>:$SUPA_PW@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  -f dump.bak
read -s NEON_URL       # paste the Neon connection string
pg_restore -d "$NEON_URL" -v --no-owner --no-acl dump.bak
```

Expect errors on policies referencing the `anon` role — Neon has no such role.
Everything else restores. Verify by comparing row counts, not by trusting the
absence of errors.

---

## The AI layer (`api/ask.js`)

POST `{ question }` → `{ answer, toolCalls }`

**The whole design in one sentence:** the model never touches the facts.

1. Browser POSTs the question to our function (never to Anthropic directly —
   the API key would be visible in page source)
2. Function asks Claude, offering one tool: `search_trains`
3. If Claude requests the tool, **our code** runs the real query
4. Real rows go back to Claude, which writes the final answer

Two round trips to Claude, not one.

**Env var:** `ANTHROPIC_API_KEY` in Vercel, server-side only.

### ⚠️ The main open problem

`search_trains` is a **name substring match only**. It returns station names
and route names, nothing else.

This means almost every real question gets a polite refusal. "What trains go
through Chicago?" → finds the station, then correctly reports it has no route
data for it. "Tell me about the Acela" → finds the name, nothing more.

**The model is behaving correctly; the tool is too thin.** The data is right
there — `stop_times → trips → routes` knows exactly which routes serve CHI.
The tool just doesn't expose that join.

Fixing this is the highest-value next change.

---

## SQL learned (snippets saved in Supabase SQL Editor — note: that's the OLD
host; re-save the useful ones in Neon)

`table_row_counts` · `find_trip_by_route_name` · `full_itinerary_join` ·
`dwell_time_per_stop` · `leg_duration_between_stops` · `overnight_trips_count` ·
`cumulative_elapsed_time` · `reachable_stations_2hr_debug` ·
`reachable_stations_8hr` · `trips_per_weekday` · `longest_legs_ranked` ·
`events_schema_check` · `recent_events`

Techniques: joins, `::interval` casting, `LAG`/`LEAD`/`FIRST_VALUE`/`RANK`,
recursive CTEs, aggregation, `CASE WHEN`.

### Real data-quality findings
- GTFS encodes post-midnight times as `25:30:00`, so time columns import as
  **text** and need `::interval` casting before math
- Some `stop_name` values are truncated garbage ("Lbo", "Old", "Saa") —
  filtered with `length(stop_name) > 5`
- Trip-day duplicates inflate results; dedupe with `GROUP BY` + `MIN()` or
  `DISTINCT ON`
- The recursive CTE blew up disk space twice: needed both a visited-path array
  (to stop A→B→A loops) **and** edge dedup before it would run
- `reachable_stations_8hr` **assumes instant transfers** — it answers "8 hours
  of pure travel time," which is not a question any traveler asks. Label it
  honestly in any UI.

---

## Roadmap

Sequencing note: eval work deliberately comes **before** usage analysis. Evals
are the rarer skill and need zero traffic; usage analysis is more common and is
blocked on having enough data to say anything honest.

- [x] **A** — GTFS data loaded, SQL fundamentals, search UI, event logging
- [x] **B** — AI layer with tool calling, tested live
- [x] **B.5** — Migrated Supabase → Neon, all DB access through functions
- [ ] **Next** — A richer tool. `routes_for_station` answering "what trains go
      through X" via `stop_times → trips → routes`. Without this the AI layer
      can't answer much, which undercuts the demo.
- [ ] **C** — Eval harness: 40 hand-written cases spanning easy / ambiguous /
      adversarial ("train from NYC to Honolulu" — correct answer is a refusal).
      Score on: stations exist, constraints respected, arrival after departure,
      correct refusals. A "run all" button. Log date + prompt version + pass
      rate. Build a named failure taxonomy.
      **Test case #1 already exists:** "what trains go through Chicago?"
- [ ] **D** — Write-up #1: eval methodology + failure taxonomy
- [ ] **E** — Usage analysis, once there's enough data. Frame the write-up as
      "here's the event schema I designed and the questions it answers" rather
      than conclusions from 30 data points — a small sample invites an
      interviewer to attack the sample size instead of the thinking.

### Parked ideas
- **Weather tool** — second tool alongside `search_trains`. Use
  `stops.stop_lat`/`stop_lon` (unambiguous; station name strings are not).
  Must use **historical averages**, not forecasts — real forecasts reach only
  ~14 days, and the use case is "a nice weekend in early October."
- **Richer trip search** — duration / overnight / connection filters.
- **Migrate `bike-forecast` to Neon too** — still on Supabase. Recipe above.

---

## Why this exists (the interview story)

Three claims this project makes true, rather than aspirational:

1. **"I write SQL."** Recursive CTEs and real data-quality debugging, not
   "I've used dashboards."
2. **"I've shipped an AI feature and I know how to tell if it's getting
   worse."** Most PMs can't answer the second half. Phase C is what makes it
   answerable.
3. **"I instrumented a product and analyzed my own usage data."** Schema
   designed, queries written, conclusions drawn.

For interviews, the two write-ups matter more than the app. The app proves you
can build; the write-ups prove you can think about quality and measurement.
