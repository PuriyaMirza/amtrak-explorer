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
schedule.js         findDirectTrains(sql, {from, to, date|weekday, departAfter,
                    departBefore, route, limit}) — direct trains, times, durations.
                    Plain data, no prompt text, so a browse endpoint can reuse it.
                    Also resolveStation() (ids, aliases, ambiguity), todayInNewYork()
weekend.js          planWeekend(sql, {from, to, outDate|outDay, returnDate|returnDay,
                    departAfter, returnDepartAfter, minHoursAtDestination, limit}) —
                    round trips: pairs outbound + return trains (built on
                    findDirectTrains, no SQL of its own) and reports hoursAtDestination.
                    Plain data, reusable by a future browse "weekend finder"
events.js           logEvent(type, fields) — POSTs to /api/log, fire-and-forget;
                    also exports deviceId/sessionId (index.html sends them to /api/ask)
event-store.js      insertEvent(sql, fields) — the ONE events insert + column whitelist
ask-log.js          logAsk(sql, ...) — writes the 'ask' events row (never throws,
                    2s timeout); buildAskMetadata() shapes the metadata
styles.css
ask-core.js         askQuestion({anthropic, sql, question}) — the Claude tool loop,
                    plus MODEL, PROMPT_VERSION and the prompt/tool constants.
                    Tools: search_trains (names), find_trains (schedule.js) and
                    plan_weekend (weekend.js);
                    systemPromptFor() adds today's date per request
api/search.js       GET  /api/search?q=   → searchTrains
api/log.js          POST /api/log         → type gate → insertEvent (browser rows only)
api/ask.js          POST /api/ask         → thin handler (validation, 500-char cap,
                    builds clients from env) → askQuestion → logAsk
eval/cases.js       40 eval cases (easy / ambiguous / adversarial / schedule)
eval/score.js       scoreCase() — deterministic checks, no LLM judge
eval/taxonomy.js    check → named failure type (hallucinated-entity, ...)
eval/runner.js      runCases(), chooseMode() — the loop, testable with a fake ask
eval/results.js     formats/appends rows of eval/RESULTS.md
eval/run.js         CLI: `npm run eval`
eval/RESULTS.md     run log, one row per eval run (header explains columns)
test/               `npm test` (node:test, no network)
sql/                events table, reconstructed from the live DB (2026-10-23)
```

### Running evals

```bash
vercel env pull .env.local   # once; DATABASE_URL + ANTHROPIC_API_KEY, git-ignored
npm run eval                 # local mode: calls askQuestion in-process, appends a row to eval/RESULTS.md
npm run eval -- --no-record  # same, without writing a row
ASK_URL=http://localhost:3000/api/ask npm run eval   # remote mode (vercel dev); the deployed site is behind SSO
npm test                     # unit tests only; free, no network
```

Evals make ~40+ real model calls (a few tens of cents). Run them on demand,
never in CI.

Exit codes: `npm run eval` exits 0 even when some cases fail (it passes
`--allow-failures` so npm doesn't print an error block on top of the results;
failures are still listed and recorded). `node eval/run.js` directly exits 1 if
any case failed (expected at the v1 baseline, where the schedule cases failed). Either way,
2 = setup problem (missing/empty env vars) and 3 = every request errored (bad
key, spend limit, SSO), in which case nothing is written to RESULTS.md.
`vercel env pull` writes empty values for Sensitive variables; if the runner
says a variable is EMPTY, paste the real value into `.env.local`. The `schedule` cases failed at the v1 baseline (recorded in
RESULTS.md); `find_trains` (prompt v2) and `plan_weekend` (prompt v3) are what should
make them pass. The two `weekend-*` cases require `plan_weekend`.

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
- `event-store.js` lists insertable columns **explicitly** so a caller can't write
  to unintended columns. Both `api/log.js` and the ask logger go through it.
- **`event_type = 'ask'`** — one row per `/api/ask` request (success, or an error
  after validation), written **server-side only**: `api/log.js` does not accept
  `'ask'`, so a browser can't forge one. `query_text` = the question;
  `device_id`/`session_id` come from the browser if sent, else `'unknown'` (both
  columns are NOT NULL). `metadata` keys: `answer`, `tool_calls`
  (`[{name, input, row_count | error}]`, no result rows), `rounds`, `latency_ms`,
  `input_tokens`, `output_tokens`, `model`, `prompt_version`, `error` (failures
  only; then no answer/tool_calls). Logging happens in `api/ask.js` via
  `logAsk`, never inside `askQuestion`, so `npm run eval` (local mode) writes no
  rows. A log failure or a 2s timeout is swallowed and never affects the answer.

### Known cleanup items

1. ~~`sql/001_events_table.sql` is stale~~ — done: it is now a reconstruction of
   the live schema (marked with its date).
2. **The RLS setup is inert.** RLS is enabled on `events` with **zero policies**
   (the Supabase `anon` policy didn't survive the migration), and the functions
   connect as the table owner, which bypasses RLS. It protects nothing; see the
   comment in `sql/001_events_table.sql`. Leave it or drop it, but don't mistake
   it for active protection.
3. ~~`/api/ask` doesn't log~~ — done: see `event_type = 'ask'` above.
4. **Durations across a DST change.** `schedule.js` computes durations from the
   feed's wall-clock times, so a train running through 1-2 AM on a DST-change night
   (e.g. 2026-11-01) can show a duration that is 1h off. (`planWeekend`'s hours at the
   destination do account for the clock change.)

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
2. Function asks Claude, offering three tools: `search_trains` (stations/routes by
   name), `find_trains` (direct trains between two stations: times, durations,
   weekdays, dates) and `plan_weekend` (round trips: outbound + return pairs and
   hours at the destination)
3. If Claude requests a tool, **our code** runs the real, fixed query (the model
   only fills in parameters; it never writes SQL)
4. Real rows go back to Claude, which writes the final answer

Usually two round trips to Claude; up to `MAX_ROUNDS` (4) if it chains tools.

The system prompt (v3) says: state times/durations only if a tool returned them,
say times are Eastern, and add a "holidays aren't modelled, confirm on amtrak.com"
caveat to schedule answers. Today's date (New York) is appended per request so
"next Thursday" can be turned into a date. `find_trains` results are capped at
12 trains by default (20 max); its `summary` still covers all trains.
`plan_weekend` has the same shape of guard: inputs are whitelisted in `runTool`
and `today` always comes from the real clock, never from the model.

### planWeekend (weekend.js)

- Both legs come from `findDirectTrains` (outbound `from -> to` on `outDate`, return
  `to -> from` on `returnDate`); there is no SQL in `weekend.js`.
- Dates: a given date wins; a bare weekday means the next such day (today counts);
  the return is the first `returnDay` on or after the outbound date. The dates used
  are stated in `notes`.
- `hoursAtDestination` = return departure - outbound arrival, **including
  `arriveDayOffset`** (an overnight outbound arrives the next day, so you get less
  time). It is real elapsed time: if the clocks change between the two days it is an
  hour off the clock difference, and a note says so. Pairs below
  `minHoursAtDestination` (default 0) are dropped.
- **The cap:** each outbound train is paired only with its *latest* working return
  (the most time at the destination), then at most `limit` pairs are kept (default 10,
  model max 20; the ones with the most hours, shown in departure order). The
  `outbound`/`inbound` lists show at most 12 trains each; `summary` has the full counts
  plus `earliestReturn` / `latestReturn` (from the full inbound list). A stay must be > 0 min.
- `ambiguous`/`not_found` stations, `outsideFeed`, `unavailable` and the notes are
  passed through from `findDirectTrains`.

**Env var:** `ANTHROPIC_API_KEY` in Vercel, server-side only.

### Schedule data: service day vs physical day (read before touching schedule.js)

GTFS assigns a trip to the **service day it starts on**, and later stops can have
times past `24:00:00`. Train 66 is a *Wednesday*-service trip that passes NYP at
`29:44:00`, i.e. **5:44 AM Thursday**. A traveler asking about Thursday means the
physical day, so `findDirectTrains` uses: service date = requested date −
`floor(board_seconds / 86400)`, and checks the calendar for *that* date. Time
shown = board time minus those whole days; `arriveDayOffset` counts days after
the physical departure. Boarding times go up to 80h in this feed, so the rule is
general, not just "+1 day". The eval's old "first train on Thursday is 1150 at
6:53" was the service-day reading and is wrong for travelers.

Other data facts that bite:
- **All feed times are US Eastern at every stop**, even Chicago/LA (Lake Shore
  Limited 48 leaves CHI "22:30:00" = 9:30pm Central; California Zephyr 5 leaves
  CHI "15:00:00" = 2pm Central). GTFS defines times in the *agency's* timezone,
  not `stops.stop_timezone`. The tool reports times as given and says "Eastern".
- `calendar` covers 2026-09-06 to 2027-09-06 in overlapping windows; there is **no
  calendar_dates table**, so holidays are not modelled. A date outside the range
  returns `outsideFeed` instead of an empty list.
- `pickup_type`/`drop_off_type` = 1 means not allowed. Such trains come back in
  `unavailable` (e.g. Cardinal 50 can't be boarded at WAS or PHL).
- "No date" in a weekday query means the *next* such day, so one real timetable
  is used rather than mixing windows.
- Station text: ids, then aliases (`NYC`, `New York` -> NYP; `Boston` -> BOS, which
  is the exact name of three stations), then exact name, then substring. More than
  one candidate returns `ambiguous` with candidates; nothing is guessed.

### What the ask box can answer now, and what it can't

Answerable (PR 3): direct-train times, durations, first/last/fastest train,
weekday- and date-specific schedules, boarding restrictions, "what serves X".
Answerable (PR 4): round trips ("leave Friday after 6, back Sunday") with hours at
the destination, via `plan_weekend`.
Still not answerable: connections, fares, live delays, holidays, scenery, booking.

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
- **Richer trip search** — connections (direct-only today; duration, overnight and
  time filters shipped in PR 3).
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
