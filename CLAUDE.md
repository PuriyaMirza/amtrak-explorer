# amtrak-explorer

A learning project, not a product. The goal is for Puriya (a senior PM, not a
professional engineer) to build real SQL, analytics-instrumentation, and
AI-product skills by shipping something real with actual Amtrak data.

**Live:** https://amtrak-explorer.vercel.app
**Repo:** https://github.com/PuriyaMirza/amtrak-explorer

---

## How to work on this project

This matters as much as the code. Read it before doing anything.

- **Explain in plain language as you go** — what you're about to do and why,
  in terms someone still building their fundamentals can follow. Don't write
  code silently and hand over a diff.
- **One step at a time.** Give one step, wait for confirmation, then the next.
  Don't batch five steps into one message.
- **Always name the file** being edited at the top of each step.
- **When introducing a new concept** (a library, a pattern, a technique),
  briefly explain what it is and why it's the right tool here.
- **Push back directly** when an approach seems wrong. Deference is not helpful.
- **Flag scope creep** — if a task is turning into nested sub-projects, say so
  and let Puriya decide whether it's worth it.
- **Be concise.** Bullets and tables over paragraphs where they fit.

### Debugging lesson learned the hard way
A trivial `api/hello.js` test function returned `500 FUNCTION_INVOCATION_FAILED`
with "No exports found in module" for weeks. The cause: **the file was 0 bytes.**
VS Code had warned about unsaved changes and the content never hit disk. Two
rounds of `package.json` `"type"` toggling chased the wrong thing, and one
"fix" commit was never actually pushed.

Takeaways that still apply:
- **Verify the artifact, not the intent.** `wc -c` the file. Check what Vercel
  actually deployed, not what you think you wrote.
- **Confirm the push landed** (`git status -sb` shows `[ahead N]` if not).
- **Check the deployment ID** you're reading logs from matches the one that's
  actually live.

---

## Stack

| Layer | What | Notes |
|---|---|---|
| Data | Supabase Postgres | Amtrak GTFS feed, 6 tables |
| Frontend | Plain HTML/JS/CSS, no framework | Deliberate — readable top to bottom |
| Backend | Vercel serverless function | Only for the AI layer, which needs a secret key |
| Hosting | Vercel, auto-deploys on push to `main` | |

No build step. `npx serve` for local dev (modules won't load over `file://`).

### Files
```
index.html          search UI + natural-language ask UI
search.js           searchTrains(supabase, {query, limit}) — SINGLE SOURCE OF TRUTH
events.js           logEvent(type, fields) — fire-and-forget usage logging
supabaseClient.js   shared browser client (CDN import)
styles.css
api/ask.js          serverless: tool-calling loop, holds the API key
sql/                schema history (SEE WARNING BELOW)
```

### The one architectural rule
`search.js` takes the Supabase client as a **parameter** rather than importing
it. That's dependency injection, and it exists so the browser (CDN client) and
the serverless function (npm client) run the *exact same* search code. The AI
and the UI can never disagree about what search returns.

**Do not give `api/ask.js` its own query logic.** That's how these projects rot.

---

## Database (Supabase project `qfbruzslfbfpaylwbbtq`)

Five GTFS tables from Amtrak's feed, plus one app table:

| Table | Rows | Notes |
|---|---|---|
| `stops` | 645 | has `stop_lat`/`stop_lon` — needed for the planned weather feature |
| `routes` | 61 | `route_short_name` is null in this feed; use `route_long_name` |
| `trips` | 2,732 | |
| `stop_times` | 35,691 | times run past `24:00:00` for overnight trips |
| `calendar` | 392 | |
| `events` | — | usage log |

### RLS posture
- Five GTFS tables: `public_read` policy, **SELECT only**
- `events`: **INSERT only**, no SELECT policy — visitors can log their own
  activity but can't read the log back. Read it via the SQL editor, which
  runs as the owner and bypasses RLS.

### ⚠️ `sql/001_events_table.sql` is STALE
That file is the first draft. The **live** `events` table was later rebuilt
with a better schema. Live columns (15):

```
id, created_at, event_type, device_id, session_id, query_id,
query_text, stop_count, route_count,
target_type, target_id, target_label, result_position, result_group,
metadata (jsonb)
```

Deliberate choices in the live version:
- `device_id` (localStorage, forever) vs `session_id` (sessionStorage, one
  visit) are **separate** — the first draft conflated them
- `result_position` + `result_group` — so "do people click the top result?"
  is answerable later
- `metadata jsonb` — escape hatch so new event types don't need a migration
- **No enum check on `event_type`** — adding a type shouldn't require altering
  the table. Cost: a typo lands as a new type, so define type names as JS
  constants rather than inline strings.

**Fix this file** when convenient so the repo matches reality.

### ⚠️ Free tier pauses
The project goes `INACTIVE` after ~1 week of no activity, which silently breaks
search *and* `/api/ask`. If things are mysteriously broken after a gap, check
project status first.

---

## The AI layer (`api/ask.js`)

POST `{ question }` → `{ answer, toolCalls }`

**The whole design in one sentence:** the model never touches the facts.

1. Browser POSTs the question to our function (never to Anthropic directly —
   the API key would be visible in page source)
2. Function asks Claude, offering one tool: `search_trains`
3. If Claude requests the tool, **our code** runs the real Supabase query
4. Real rows go back to Claude, which writes the final answer

It can't hallucinate a station because it can only describe rows that came
back. That's constraint-by-construction, not prompting.

Two round trips to Claude, not one. That surprises people.

**Env var:** `ANTHROPIC_API_KEY`, set in Vercel for production + preview.
Server-side only. Changing it requires a redeploy to take effect.

### Known scope limits (intentional, v1)
`search_trains` is a **name substring match only**. It cannot filter by
duration, departure time, or scenery. The system prompt tells Claude to say so
rather than guess. The original "scenic overnight from NYC under 12 hours"
vision needs a *second* tool, added after this one is proven.

---

## SQL already learned (saved as Supabase snippets)

`table_row_counts` · `find_trip_by_route_name` · `full_itinerary_join` ·
`dwell_time_per_stop` · `leg_duration_between_stops` · `overnight_trips_count` ·
`cumulative_elapsed_time` · `reachable_stations_2hr_debug` ·
`reachable_stations_8hr` · `trips_per_weekday` · `longest_legs_ranked` ·
`events_schema_check` · `recent_events`

Techniques covered: joins, `::interval` casting, `LAG`/`LEAD`/`FIRST_VALUE`/
`RANK`, recursive CTEs, aggregation, `CASE WHEN`.

### Real data-quality findings
- GTFS encodes post-midnight times as `25:30:00` etc., so time columns import
  as **text** and need `::interval` casting before math
- Some `stop_name` values are truncated garbage ("Lbo", "Old", "Saa") —
  filtered with `length(stop_name) > 5`
- Trip-day duplicates inflate results; dedupe with `GROUP BY` + `MIN()` or
  `DISTINCT ON`
- The recursive CTE blew up disk space twice: needed both a visited-path array
  (to stop A→B→A loops) **and** edge dedup before it would run
- `reachable_stations_8hr` **assumes instant transfers** — it answers "8 hours
  of pure travel time," which is not a question any traveler asks. Label it
  honestly in any UI; don't quietly present it as real trip planning.

---

## Roadmap

Sequencing note: the AI/eval work deliberately comes **before** usage
analysis. Evals are the rarer skill and need zero traffic; usage analysis is
the more common skill and is blocked on having enough data to say anything
honest.

- [x] **A** — GTFS data loaded, SQL fundamentals, search UI, event logging
- [x] **B** — AI layer with tool calling *(just shipped, needs real testing)*
- [ ] **C** — Eval harness: 40 hand-written test cases spanning easy /
      ambiguous / adversarial (e.g. "train from NYC to Honolulu" — correct
      answer is a refusal). Score on: stations exist, constraints respected,
      arrival after departure, correct refusals. A "run all" button on the
      site. Log date + prompt version + pass rate. Build a named failure
      taxonomy.
- [ ] **D** — Write-up #1: eval methodology + failure taxonomy
- [ ] **E** — Usage analysis, once there's enough data. Frame the write-up as
      "here's the event schema I designed and the questions it answers" rather
      than conclusions from 30 data points — a small sample invites an
      interviewer to attack the sample size instead of evaluating the thinking.

### Parked ideas
- **Weather tool** — second tool alongside `search_trains`. Use
  `stops.stop_lat`/`stop_lon` (unambiguous; station name strings are not).
  Must use **historical averages**, not forecasts — real forecasts only reach
  ~14 days, and the use case is "a nice weekend in early October."
- **Richer trip search** — duration / overnight / connection filters, as a
  second tool once the first is proven.

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

For interviews, the two write-ups matter more than the app. The app proves
you can build; the write-ups prove you can think about quality and
measurement.
