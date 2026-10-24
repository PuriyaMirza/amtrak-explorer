# Handoff: next session

Written 2026-10-24 at the end of the "evals → logging → schedule tools" phase.
Read this first, then `CLAUDE.md` (how to work, architecture) and `docs/PRD.md` (decisions).

## Where things stand

- **Shipped (all merged to `main`, live on Vercel):** PR #3 eval harness, #4 ask-box logging,
  #5 `find_trains`, #6 `plan_weekend`, #7 docs, #8 eval scorer v2, #11 tool labels,
  #12 home station (prompt v4), #13 station picker.
- **Evals** (`eval/RESULTS.md`), all run locally on Puriya's Mac:

  | Run | Prompt | Scorer | Pass | Schedule |
  |---|---|---|---|---|
  | 2026-10-23 baseline | v1 | 1 | 27/40 | 0/13 |
  | 2026-10-24 after PR #6 | v3 | 1 | 38/40 | 12/13 |
  | 2026-10-24 after PR #8 | v3 | 2 | 40/40 | 13/13 |
  | 2026-10-24 after PR #12 | v4 | 2 | **41/41** | **14/14** |

  The 38 → 40 jump is a **scorer** fix, not a model change: both failures were scorer
  false negatives that Puriya caught by reading the answers. Scorer v2 is guarded by
  `test/score-adversarial.test.js` (75 adversarial answers; v2 must never be wrong where
  v1 was right; 12 are documented `knownLimitation`s).
- **Live check (2026-10-24):** "first train to Boston next Thursday, leaving New York Penn"
  → train 66 at 5:44 AM Eastern, then 1150, then Acela 2150; holiday caveat present.
  Logged in `events` with `prompt_version` v3, tool input and token counts.
- **Infrastructure:** Neon is the only database (Free plan). The Supabase `amtrak-explorer`
  project is **deleted**; its 13 SQL snippets are in `sql/snippets_from_supabase.sql`.
  `bike-forecast` on Supabase is a separate project. Don't touch it.

## Do first (next session)

1. **"Next train" needs the current time.** Live test 2026-10-24: "when is the next train
   to New York" got "I don't know the current time". `systemPromptFor` gives the model
   today's date but not the time. Fix: add the current New York time the same way
   (from the real clock, never the request), plus an eval case for a "next train"
   question. Prompt change → `PROMPT_VERSION` v5, then `npm run eval` on the Mac.
   Watch the eval: "next" answers depend on the run time, so check a time window or
   `departAfter` in the tool input, not a fixed train.

## Done 2026-10-24 (found in Puriya's live test)

- "Searched for: `undefined`" under answers → #11 (`tool-labels.js`).
- No-origin questions: decided (a) default origin + a station picker (not conversation
  memory). #12 server side, prompt v4 (`home_station`, validated by `resolveHomeStation`
  against `stops`; eval 41/41). #13 the "Your station" type-to-search picker
  (`home-station.js`, `home_station` browser event; our names for the three "Boston"
  stations: South Station, Back Bay, North Station).

## Still open (from CLAUDE.md, carried over)

- **Inert RLS on `events`:** decide drop vs keep (zero policies; functions connect as owner).
- ~~**Planning repo `amtrak-trip-planner`**~~ Decided 2026-10-24: close PR #1, archive the repo.
- **Write-up #1 (roadmap D), Puriya's to write.** Raw material:
  - `eval/RESULTS.md`: 27 → 38 → 40.
  - The Cardinal baseline answer: "Yes" to an impossible WAS→NYP trip, an ungrounded
    answer that sounds right.
  - Scorer false negatives caught by reading failures. A narrow regex fix then broke
    ~10 other answers, and only a 75-answer adversarial set caught it. The lesson is to
    test the evaluator too and version it.
  - Service-day vs physical-day (train 66). The original eval expectation was wrong.
- **Next phase (PRD §7):** browse filters, map, weekend finder (reuse `planWeekend`
  through a plain `/api/` endpoint).
- **Anthropic key expiry:** the old Vercel key expired after 30 days and silently broke
  the live ask box (401, visible as error rows in `events`). Puriya replaced it on
  2026-10-24. If the new key expires, rotate it in Vercel (Production + Preview), then
  **redeploy**.

## How this phase was run (reuse if it worked)

- The orchestrator (main session) writes the PRD and briefs, then reviews and merges.
  Sonnet subagents act as developer and QA, one PR at a time. QA verifies against live
  Neon data with **read-only SELECTs, batched** (each query may prompt Puriya), and
  mutation-tests.
- Parallel developers use separate `git worktree`s.
- Puriya makes security/cost decisions. The orchestrator decides the rest and logs the
  decision in the PRD.
- The cloud session has **no** `ANTHROPIC_API_KEY` / `DATABASE_URL`, and the site is behind
  Vercel SSO, so **evals run on Puriya's Mac**: `git pull && npm run eval`, then commit
  only `eval/RESULTS.md`.
- Squash-merged branches get deleted on GitHub. A Stop-hook warning about "unpushed
  commits" on such a branch is a false alarm: check `git diff <branch> origin/main`, then
  delete the local branch.
