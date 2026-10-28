# PRD: amtrak-explorer, next phase

**Status:** approved by Puriya, 2026-10-23. PRs 1-4 shipped 2026-10-23/24 (UTC merge dates; #3-#6); PR 5 (docs, #7) opened 2026-10-24. Next phase: §7. · **Owner:** Puriya · **Built by:** Claude (orchestrator) + developer/QA agents

## 1. Problem

The ask box mostly refuses. `search_trains` only knows names and which routes serve which
stations, so "first train to Boston on a Thursday?" or "fastest train Chicago → LA?" get a
polite "I can't". The data to answer them is already in Neon (`stop_times` × `trips` × `calendar`).

The eval harness that should prove the fix (Phase C) has 9 of 40 planned cases, can't run
against the SSO-protected site, and doesn't record runs, so there is no baseline to compare
against.

## 2. Goals

1. **Measure first.** Get a 40-case eval set and a recorded **baseline** pass rate before
   changing the AI layer. This is the interview claim "I can tell if it's getting worse".
2. **Then answer real questions.** Times and durations, weekday-specific schedules, and
   weekend trip pairing, via narrow fixed-SQL tools. Show the before/after pass rate.
3. **Instrument the ask box** so Phase E (usage analysis) has data.

### Non-goals (this phase)
- Connections (multi-train trips). Too error-prone; stays parked.
- Browse UI growth (filters, map, weekend finder). The browse screen stays as is this phase; all three are committed for the next phase (§7).
- Text-to-SQL. The model never writes SQL.
- Public access. The site stays behind Vercel SSO; revisit at write-up time.
- Weather tool, fares, live delays, LLM-as-judge scoring.

## 3. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | Order: evals → logging → schedule tools → weekend tool | Puriya |
| D2 | New question types: times/durations, weekday-specific, weekend pairing | Puriya |
| D3 | Few narrow fixed-SQL tools; model never writes SQL | Puriya (security) |
| D4 | Browse UI left as is this phase; filters + map + weekend finder next phase | Puriya |
| D5 | Anthropic spend < $5/month; hard limit set in Anthropic console; evals run on demand only, never in CI | Puriya (cost) |
| D6 | Access: keep Vercel SSO; decide public access at write-up time | Puriya (security) |
| D7 | One pinned model (`claude-sonnet-5-5`) for app and evals | Puriya (cost) |
| D8 | Supabase project: Puriya exports SQL snippets, then it's deleted (confirm before deleting) | Puriya |
| D9 | Eval scoring: deterministic checks only (strings + tool-call structure), no LLM judge, so it's free and repeatable | Claude |
| D10 | Ask logging records question, answer, tool calls, latency, tokens, model, prompt version | Claude |
| D11 | Usage data = Puriya's own use; write-up frames the schema and questions, not conclusions | Claude |
| D12 | Write-ups are Puriya's. The build provides the raw material (`eval/RESULTS.md` run log, failure taxonomy) | Claude |
| D13 | Tests use Node's built-in `node:test`, so no new dependency | Claude |
| D14 | Cheap guardrail even under SSO: question length cap (500 chars) | Claude |

## 4. Requirements by PR

Each PR is small, keeps `search.js`'s dependency-injection pattern (query modules take `sql`
as a parameter; endpoints have no query logic of their own), and ships tests.

### PR 1: Eval harness you can actually run
**Shipped: #3, 2026-10-23.** Baseline run (prompt v1) recorded in `eval/RESULTS.md`: 27/40, schedule 0/13.

- `eval/run.js` gains a **local mode** (default when `DATABASE_URL` + `ANTHROPIC_API_KEY`
  are set, e.g. after `vercel env pull`). It calls `askQuestion` (ask-core.js) in-process, with
  no HTTP and no SSO. Remote mode (`ASK_URL`) stays.
- Extract the ask logic into `ask-core.js` (`askQuestion({ anthropic, sql, question })`) so the
  endpoint, the eval runner and the tests share one implementation.
- `PROMPT_VERSION` constant; `MODEL` stays pinned.
- Each run appends a row to `eval/RESULTS.md`: date, model, prompt version, pass rate
  overall and per category, failed case ids.
- Grow `eval/cases.js` to **40 cases**: easy / ambiguous / adversarial, plus a new
  `schedule` category (times, weekday, weekend) that is expected to fail or decline at
  baseline. Expectations are verified against Neon data, with the SQL noted in a comment.
- Failure taxonomy: each failed check maps to a named failure type (e.g. `hallucinated-entity`,
  `missed-refusal`, `wrong-refusal`, `no-grounding`, `wrong-time`), and the runner prints counts.
- Unit tests (`npm test` → `node --test`): scorer, taxonomy, runner with mocked Anthropic.
- 500-char question cap in `/api/ask` (400 response).

### PR 2: Ask-box logging and cleanup
**Shipped: #4, 2026-10-23.**

- Every `/api/ask` call inserts one `events` row with `event_type = 'ask'`: `query_text` =
  question, and `metadata` = answer, tool calls (name, input, row count), rounds, latency_ms,
  input/output tokens, model, prompt_version, error if any. The insert happens server-side;
  a logging failure never fails the answer.
- Shared server-side insert helper, so `api/log.js` and `ask` use one column whitelist.
- Replace stale `sql/001_events_table.sql` with the live 15-column schema (from Neon), and
  document the inert RLS policies (no DB change).

### PR 3: Schedule tool (times, durations, weekdays)
**Shipped: #5, 2026-10-23** (prompt v2). Declared deviations from the spec below:
- A `weekday` with no `date` means the *next* such date (today counts), not "any day with that weekday flag", so one real timetable is used instead of mixing calendar windows. Days are physical days: a trip's service day is the requested date minus whole days of boarding offset.
- Added a `route` filter and a `summary` (earliest, latest, fastest over *all* trains), so a capped list (12 default, 20 max) still answers "first/last/fastest" correctly.

- New query module `schedule.js`: `findDirectTrains(sql, { from, to, date?, weekday?, departAfter?, departBefore? })`.
  - Matches station by id or name and returns direct trips only: same `trip_id`, `from`
    stop before `to` stop, pickup allowed at `from` and drop-off allowed at `to`.
  - Filters on calendar: `weekday` flag, and `date` between `start_date`/`end_date`.
  - Handles times past `24:00:00`: compute seconds, report a `+1 day` arrival, and compute
    duration correctly.
  - Returns train number, route, depart, arrive, duration, overnight flag, and the active
    calendar window. Results come back sorted by departure.
  - If the date falls outside the feed's calendar range, it says so explicitly.
- New tool `find_trains` in the ask loop, alongside `search_trains`. The system prompt is
  updated: the model may state times only if a tool returned them, and must warn that
  holidays aren't modelled (the feed has no `calendar_dates`).
- `PROMPT_VERSION` bump. `duration-constraint` and the schedule cases flip to expecting answers.
- Tests: SQL logic against fixture rows, including an overnight trip; tool wiring with mocked Anthropic.

### PR 4: Weekend trip tool
**Shipped: #6, 2026-10-24 (UTC merge)** (prompt v3). Declared deviations from the spec below:
- **Pair-cap rule:** each outbound train is paired only with its *latest* working return, then at most `limit` pairs are kept (default 10, max 20), rather than every outbound x return combination.
- **DST:** `hoursAtDestination` is real elapsed time (clock changes between the two days are accounted for, with a note), not wall-clock difference. `findDirectTrains` durations are still wall-clock and can be 1h off through the DST hour (CLAUDE.md, Known limitations).

- `planWeekend(sql, { from, to, outDay, returnDay, ... })`: pairs outbound and return direct
  trains and reports hours at destination (overnight outbound reduces it). Defaults to Fri → Sun.
- Exposed as tool `plan_weekend`; weekend eval cases.

### PR 5: Docs
**Shipped: #7** (this PR; docs only, no code changes).

- Update `CLAUDE.md` (files, tools, roadmap ticks, how to run evals locally) and the README.

## 5. Acceptance criteria (phase)
- `npm test` passes, with no network needed.
- `npm run eval` runs locally with `vercel env pull` credentials, and records a row in `eval/RESULTS.md`.
- A baseline row exists **before** PR 3 merges, and a post-PR-4 row shows the schedule category improving.
- "First train to Boston on Thursday" is answered with real times that match a direct SQL check.
- Ask questions appear in `events`.
- No secret in the repo or the browser. The site stays behind SSO.

## 6. Risks
- **Evals can't run in Claude's sandbox** (no API key; SSO). Puriya runs `npm run eval`
  locally at two checkpoints (baseline after PR 1; after PR 4). About $0.50–1 per run (a guess).
- **No holiday data:** answers must say so.
- **String checks are brittle on prose:** prefer `toolCalls` structure checks where possible.

## 7. Next phase (committed, not yet specced)

Browse screen growth. All three were requested; the order and details get decided when this phase ships.
- **Filters:** time of day, route.
- **Map:** station pins from `stops.stop_lat`/`stop_lon`. **Decided 2026-10-28 (Puriya): MapLibre GL JS + OpenFreeMap tiles.**
  Free, with no API key or registration and no stated limit on views ([openfreemap.org](https://openfreemap.org), checked 2026-10-28),
  so there's no secret in the browser. Loaded from a CDN `<script>` tag pinned to an exact version (no build step). Keep the
  attribution MapLibre adds automatically. Rejected: Leaflet + CARTO Positron, because CARTO raster tiles have
  required an API key since 2026-09-25 ([CARTO FAQ](https://docs.carto.com/faqs/carto-basemaps)). Station names in pin popups
  go through `escapeHtml`. Risk: OpenFreeMap is donation-funded with no SLA; if it goes away, swap the style URL (tiles are separate from MapLibre).
  **Built 2026-10-28** (PR "Map"): card 03 under Ask. `map.js` + `stations.js` + `GET /api/stations`.
  MapLibre **6.13.0** (v6 is ES-module only: `dist/maplibre-gl.mjs`, imported from jsDelivr; pinned
  to a release three weeks old rather than the newest), Positron style. Train stations only
  (route_type 2), clustered below zoom 8, home station as a lavender pin that follows the picker,
  pin tap → a popup **with a preview** (trains today, fastest, first – last, up to 3 routes; same
  `/api/destination` numbers as B3), no scrolling. Cluster tap → a popup listing its stations A–Z
  (up to 50, "+N more"), each a dropdown that loads its preview when opened, plus Zoom in.
  Previews are cached per home station for the visit; a failed one retries. Popups open on a fixed
  side (previews above, lists below) and the map slides so they fit; the phone map is 420px.
  Opening a preview logs `click` with `result_group = 'map'`. (Changed 2026-10-28 at Puriya's
  request: the first version opened the B3 header in Search, which meant scrolling up.)
  Lazy-loaded on scroll; a CDN or style failure only replaces this card with a message.
- **Weekend finder:** pick a weekend and see destinations with Fri-out/Sun-back train pairs. Reuses PR 4's `planWeekend`.

Design implication for this phase: keep `schedule.js` and `planWeekend` free of AI-specific shapes, so the browse UI can call them through a plain `/api/` endpoint later.

### 7.1 Browse components from the Stamp blues sheet

**Added 2026-10-28, approved by Puriya.** Source: Figma file `z1KG6ozWc2BW0Eg6SqX5QK`, frame
`213:555` ("Proposed components · Stamp blues"). That sheet was drawn for the old
`amtrak-trip-planner` M3–M5 plan (static JSON, fare log), so most of it can't be backed by this
repo's data. PR #15 built none of its components. Three of them fit today's data once the parts
the data can't support are removed. Each gets built against what the data actually has, not the mockup.

| Sheet # | Component | Kept | Dropped (no data) |
|---|---|---|---|
| 03 | Trip option card | Out/back legs, train numbers, durations, hours at destination, Amtrak link | Fare range and "last seen" pill, `$$` price tier |
| 05 | Overnight leg timeline | Stop list with times, +N day badge, hours-lost note, duration pill | "Sleeper available" pill |
| 07 | Destination detail header | Station name and id, fastest and median duration, trains per day, routes, Amtrak link | Region label ("MID-ATLANTIC"), route distance (unless the open question below says yes), "Show on map" (until the Map ships) |

Not taken from the sheet, and why: 01 travel window (holiday dots need `calendar_dates`),
02 smart filters (regions; the time/route filters above already cover the rest), 04 fare
provenance and 06 fare log (no fares), 08 data freshness (no static rebuild to date).

**Rules for all three**
- **No AI in the path.** Plain `/api/` endpoints over `schedule.js` / `weekend.js`, thin like
  `api/search.js`. No new query logic inside an endpoint.
- **Times are Eastern.** Show "ET" on every time. A stop whose `stops.stop_timezone` is not
  `America/New_York` gets a visible "times shown in Eastern" note (Figma 05 shows Chicago at
  "9:45a" with no zone, which would be wrong).
- **Holiday caveat** on every card that shows a schedule: one footnote line, the same wording as `schedule.js`.
- **Escape everything.** Every value from the database (`stop_name`, `route_long_name`, train
  numbers) goes through `escapeHtml` before reaching `innerHTML` or a `data-*` attribute. This
  also closes the open "unescaped DB text in search results" item for the browse screen.
- **Stamp blues tokens only** (`--surface-1..4`, `--accent-1..2`, Chip, Pill); no new colours.
- **Ask-box answers are unchanged.** These are browse-screen components. Prompt stays v5, no eval run needed.

#### B1: Trip option card (sheet 03)

Depends on the Weekend finder endpoint (`/api/weekend` → `planWeekend`), so it ships with or right after it.

- One card per `planWeekend` pair: destination name, route pill, an **OUT** row and a **BACK** row
  (date, `depart → arrive`, train number and route, duration, `+1 day` pill when
  `arriveDayOffset > 0`), then "Time in <city>" with `hoursAtDestination` and a bar
  (scale 0 → longest stay in the result set).
- `hoursAtDestination` is taken from `planWeekend` as is and **never recomputed in the browser**
  (it already handles overnight outbounds and DST).
- Button: "Check fares on Amtrak.com →" linking to `https://www.amtrak.com/` (see open question 2).
- `planWeekend` `notes` (resolved dates, DST) render as small text under the card list.

Acceptance criteria
- A known pair (verified with a direct SQL check, noted in the test) renders the same trains,
  times and hours as `planWeekend` returns.
- An overnight outbound shows `+1 day`, and its hours match `planWeekend` exactly.
- A `stop_name` containing `<img onerror>` renders as text (test).
- `npm test` passes. Render tests lift the render function out of `index.html`, as
  `test/render-answer.test.js` does.

#### B2: Overnight leg timeline (sheet 05)

Needs one new fixed query: the stops of one trip between two stations.

- `tripStops(sql, { tripId, from, to })` in `schedule.js`: rows of `stop_times` for that trip
  with `stop_sequence` between the boarding and alighting stops, joined to `stops`
  (`stop_name`, `stop_timezone`). Returns plain data: `[{ stopId, name, time, dayOffset, timezone }]`.
  `dayOffset` uses the same service-day rule as `findDirectTrains` (offset counted from the
  physical departure day, not the service day; see CLAUDE.md "service day vs physical day").
- `findDirectTrains` must expose `tripId` (and its service date) on each train so the UI can ask
  for the stops. This is an additive field and doesn't affect the ask box's tool output contract.
  Check that the eval scorer ignores it.
- UI: expands from a B1 leg or a search result. Shows origin and destination with full times,
  intermediate stops as smaller rows, and a `+N day` pill on the first stop past midnight.
  More than 8 intermediate stops collapse to "N more stops".
- When the leg is part of a B1 card and arrives the next day, show a note: "Arrives next
  day. Time in <city> is <hoursAtDestination>." The number comes from `planWeekend`.

Acceptance criteria
- Lake Shore Limited (NYP → CHI) fixture: stop order matches `stop_sequence`, Chicago shows `+1 day`,
  and the "times shown in Eastern" note appears.
- Train 66 fixture (service day ≠ physical day): offsets are counted from the physical departure day.
- Fixture tests only, no network. Escaping test as in B1.

#### B3: Destination detail header (sheet 07)

**Built 2026-10-28** (PR "B3: destination header"). Declared deviations from the spec below:
- Lives in a new `destination.js` (like `weekend.js`: no SQL of its own, built on
  `findDirectTrains`), not inside `schedule.js`. Endpoint `GET /api/destination?to=&from=&date=`.
- Open question 1 → 4 tiles without distance: fastest, median, trains that day, and first – last
  departure (ET). Distance stays parked until someone checks `shape_dist_traveled` in Neon.
- Open question 3 → opens on a station click in the search results, below the search box.
- `to` must be a stop_id (no free text); `from` goes through `resolveHomeStation`.
- Station names use our display names (`stationName`: "New York Penn Station", not the feed's
  "Ny Moynihan Train Hall At Penn Station").
- Not checked here: acceptance criterion 1 ("matches a direct SQL count") needs the live
  database. Check on the preview: NYP → PHL trains per day vs `find_trains` in the ask box.

- `destinationSummary(sql, { from, to, date })` in `schedule.js`, built on `findDirectTrains`'
  **full** train list before the 12/20 cap (the cap would make "trains per day" and "median" wrong
  on busy pairs). Returns `{ station, fastest, median, trainsPerDay, routes, date }`.
- `from` defaults to the browser's home station, validated through `resolveHomeStation`
  (never echoed raw), the same guard the ask box uses.
- UI: station name, `stop_id`, four stat tiles (fastest, median, trains/day for the date, plus a
  fourth tile from open question 1 or a 3-tile layout), route pills, "Amtrak.com →" button.
  The tiles state the date they describe.

Acceptance criteria
- For NYP → PHL on a fixed date, `trainsPerDay` and `fastest` match a direct SQL count/min (noted in the test).
- Median is correct for odd and even train counts (unit test).
- An invalid `from` falls back to NYP (test, mirroring `test/home-station.test.js`).

#### Order and size

Suggested order: **B3 → B1 → B2**. B3 needs only one new function and a thin endpoint, so it's
the smallest. B1 rides on the Weekend finder endpoint. B2 needs the only new SQL. One PR each.
Size is a guess: B3 small, B1 small-to-medium, B2 medium.

#### Open questions (decide before building)
1. **Route distance (sheet 07's 4th tile).** Does the loaded feed have
   `stop_times.shape_dist_traveled` populated? Not verified. If not, use a 3-tile layout or show
   "earliest / latest departure" instead. Don't compute straight-line distance and label it route distance.
2. **Amtrak deep link.** Sheet 03 implies a prefilled booking link. Its URL format isn't
   verified and could change without notice. Default to the plain homepage link unless a
   documented format is found.
3. **Where B3 lives.** Click-through from a search result or a map pin? The Map isn't specced
   yet; a search-result click is the default.
