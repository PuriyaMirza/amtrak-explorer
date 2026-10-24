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
  are set, e.g. after `vercel env pull`). It calls the `api/ask.js` handler in-process, with
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
- **Map:** station pins from `stops.stop_lat`/`stop_lon`.
- **Weekend finder:** pick a weekend and see destinations with Fri-out/Sun-back train pairs. Reuses PR 4's `planWeekend`.

Design implication for this phase: keep `schedule.js` and `planWeekend` free of AI-specific shapes, so the browse UI can call them through a plain `/api/` endpoint later.
