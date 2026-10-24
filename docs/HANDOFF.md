# Handoff: next session

Written 2026-10-24 at the end of the "evals → logging → schedule tools" phase.
Read this first, then `CLAUDE.md` (how to work, architecture) and `docs/PRD.md` (decisions).

## Where things stand

- **Shipped (all merged to `main`, live on Vercel):** PR #3 eval harness, #4 ask-box logging,
  #5 `find_trains`, #6 `plan_weekend`, #7 docs, #8 eval scorer v2.
- **Evals** (`eval/RESULTS.md`), all run locally on Puriya's Mac:

  | Run | Prompt | Scorer | Pass | Schedule |
  |---|---|---|---|---|
  | 2026-10-23 baseline | v1 | 1 | 27/40 | 0/13 |
  | 2026-10-24 after PR #6 | v3 | 1 | 38/40 | 12/13 |
  | 2026-10-24 after PR #8 | v3 | 2 | **40/40** | **13/13** |

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

## Do first (found in Puriya's live test)

1. **Bug: "Searched for: `undefined`"** under answers. `index.html` (~line 161-163) renders
   `toolCalls[].query`, which only `search_trains` entries have. `find_trains` /
   `plan_weekend` entries have `name` + `input` instead. Fix: render per tool, e.g.
   "Looked up trains NYP → BOS, Thu 2026-10-29" / "Planned a weekend NYP ⇄ PHL". Small
   PR. There are no browser tests, so add a pure formatting function plus a unit test.
2. **Product decision (ask Puriya, it's his call):** with no origin given, the model asks
   "where are you leaving from?", and each question is independent, so the follow-up
   had to restate everything. Options:
   - (a) **Default origin = NYP** when none is given. The app's home base, a one-line
     prompt rule; say "from New York Penn" in the answer.
   - (b) **Conversation memory.** Send prior turns to `/api/ask`. More cost and tokens per
     question, more eval surface (multi-turn cases), and the 500-char cap needs rethinking.
   - (c) Both.
   Either one changes `SYSTEM_PROMPT` → bump `PROMPT_VERSION` to v4 and re-run evals.
   Add an eval case for the no-origin question.

## Still open (from CLAUDE.md, carried over)

- **Inert RLS on `events`:** decide drop vs keep (zero policies; functions connect as owner).
- **Planning repo `amtrak-trip-planner`:** draft PR #1 (old M0 spike) to close or merge.
  That repo is reference only now.
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
