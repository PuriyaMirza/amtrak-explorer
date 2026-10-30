# Handoff: next session

Written 2026-10-30, right after prompt v6 merged (PR #22, eval 42/42). Read this first, then
`CLAUDE.md` (how to work, architecture, eval history) and `docs/PRD.md` (decisions, §7 browse).

**The next session is write-up #1 (roadmap D): the eval methodology.** It is Puriya's to write
(PRD D12). See "Next session" below for what Claude does and doesn't do.

## Where things stand

All merged to `main` and live on Vercel (behind SSO). Nothing open.

| PR | What |
|---|---|
| #20 | PRD §7.1: browse components B1–B3 specced from the Stamp blues Figma sheet; map provider decided (MapLibre + OpenFreeMap) |
| #21 | Search results escape every DB value (`searchResultsHtml`), tested |
| #23 | **B3 destination header**: click a station in Search → trains from the home station today (fastest, median, trains/day, first–last, routes). `destination.js`, `GET /api/destination` |
| #24 | **Station map** (card 03): MapLibre 6.13.0 + OpenFreeMap. Pin tap → preview popup; cluster tap → stations as dropdowns; 44 px tap targets. `map.js`, `stations.js`, `GET /api/stations` |
| #22 | **Prompt v6**: current New York time (server clock) so "next train" works; "- " lines render as real bullets. Scorer v4 (`toolInputHas`). **Eval 42/42** |

`npm test`: **335 pass**. Live check 2026-10-30 08:04: "When is the next train to Boston?"
looked up NYP → BOS "after 08:04" and listed the 9:00 AM onward.

**Evals** (`eval/RESULTS.md`, all run locally on Puriya's Mac):

| Date | Prompt | Scorer | Pass | Schedule | What happened |
|---|---|---|---|---|---|
| 10-23 | v1 | 1 | 27/40 | 0/13 | Baseline: only a station-search tool |
| 10-24 | v3 | 1 | 38/40 | 12/13 | `find_trains` + `plan_weekend`; both failures were **scorer** bugs |
| 10-24 | v3 | 2 | 40/40 | 13/13 | Scorer v2 fixes them |
| 10-24 | v4 | 2 | 41/41 | 14/14 | Home station; +1 case |
| 10-26 | v5 | 2 | 40/41 | 13/14 | Answer layout; the failure was a **scorer** bug (Cardinal) |
| 10-26 | v5 | 3 | 41/41 | 14/14 | Scorer v3; nothing else moved |
| 10-30 | v6 | 4 | **42/42** | 15/15 | Current time + bullets; new structural case passes |

## Next session: write-up #1, eval methodology (roadmap D)

**Goal:** a piece Puriya can point an interviewer to that proves "I shipped an AI feature and I
know how to tell if it's getting worse" (`CLAUDE.md`, "Why this exists"). The app proves you can
build; the write-up proves you can think about quality and measurement.

**Claude's role (D12: the write-up is Puriya's).** Help him write it; don't write it for him.
- Do: interview him to pull out his reasoning, propose an outline, fact-check every claim and
  number against the repo (`eval/RESULTS.md`, `eval/score.js`, tests, git log), point out gaps,
  tighten his drafts, flag anything an interviewer would poke at.
- Don't: hand him a finished essay, invent numbers, or round them up. If a number isn't in
  the repo, say so.
- One step at a time (`CLAUDE.md`); a section per step is a good unit.

**Decide at the start** (Claude asks, Puriya picks):
1. **Where it lives:** a Markdown file in this repo (`docs/writeup-1-evals.md`, versioned with
   the code), a Claude Doc (easy to share and comment on), or a case study on the portfolio site
   (`puriyamirza.com`). These can be combined: draft in one, publish in another.
2. **Audience and length:** hiring managers skimming (~800–1,200 words with one table), or a
   deeper technical piece. A guess, not a rule.
3. **Public or private:** the site is behind SSO (PRD D6), so links to the live app won't work
   for readers. Screenshots instead, or decide on public access.

**A possible outline** (a starting point to react to, not the answer):
1. The problem: a chat box over train data that confidently answered questions it couldn't.
2. The baseline: 27/40 before any fix, with schedule questions at 0/13. Why measure first (D1).
3. The method: 40 → 42 hand-written cases in 4 categories, deterministic scoring with no LLM
   judge (D9), a named failure taxonomy, prompt version recorded on every run.
4. The twist: **three of the four recorded failures were the scorer, not the model.**
   The Cardinal case as the centrepiece (below).
5. What the eval can't see, and what covers it: rendered page (`render-answer.test.js`),
   coherent summaries (the accepted headline issue).
6. What changed in how evals are written: structural checks on tool input (v6) instead of
   wording heuristics.
7. What's next / what I'd do differently.

**Raw material** (every number below is in the repo; re-check before quoting):
- **The run log tells two stories.** The aggregate (27 → 42/42) says "the prompt got better".
  The scorer story says "I understand measurement": tell it as "the evaluator was wrong three
  times out of four", not just "27 → 42".
- **The strongest single case: `cardinal-no-boarding-was-nyc`, three outcomes on one
  question.** v1 said "Yes" to a trip you physically cannot board (ungrounded, sounded right).
  v5 said no, named the boarding restriction, and offered alternatives. Then the *scorer*
  marked that correct answer a failure, because it said no in phrasings the regex didn't know.
- **Test the evaluator too.** A narrow regex fix once broke ~10 other answers, and only an
  adversarial set caught it. Now `test/score-adversarial.test.js` holds 80 fixtures, scorer
  versions are frozen and compared ("19 fixed, 0 regressed" for v3), and rows from different
  scorer versions are marked as not directly comparable.
- **Structural beats wording (v6).** The new case `next-train-uses-current-time` can't pin a
  train (the right answer changes hourly), so it checks the *tool input*: did `find_trains` get
  an `HH:MM` `departAfter`? That can't drift when wording changes, which is exactly what bit the
  earlier cases. Idea for later: move more schedule cases to structural checks.
- **Know what the eval doesn't cover.** It scores answer text, never the page:
  `render-answer.test.js` exists because 41/41 couldn't catch a broken layout. And a 42/42 run
  still shipped a muddled "how many trains" headline (facts right, summary incoherent;
  accepted, see Open items). Naming the blind spots is part of the method.
- **The eval was wrong about the data once, too.** "First train on Thursday is 1150 at 6:53"
  was the GTFS service-day reading; travellers mean the physical day, so train 66 at 5:44 AM
  (a Wednesday-service train past midnight) is correct (`CLAUDE.md`, service day vs physical day).
- **Process rules that came out of it:** a presentation change (v5 line format) is still a
  prompt change, so it gets a version bump and an eval run. Evals run before merge, never in CI
  (cost, D5). v6 bundled two prompt changes into one run deliberately, and said so.
- **Security as part of quality:** the model never writes SQL (fixed tools only, D3); today,
  the current time and the home station come from the server or our own table, never from the
  request (`test/ask-handler.test.js`, `test/home-station.test.js`). A short paragraph at most;
  the write-up is about measurement.

## Backlog after the write-up

| Item | Size (guess) | Notes |
|---|---|---|
| **Structural eval checks** | 1 session | Rewrite schedule cases to assert tool inputs where possible. Feeds the write-up's last section. |
| **Weekend finder → B1 → B2** | 2–4 sessions | PRD §7 / §7.1: `/api/weekend` over `planWeekend`, then the trip option card (B1), then the overnight timeline (B2, needs `tripStops`). |
| **Count-headline wording** | Small + eval run | Only if it recurs (see below). Would be prompt v7. |
| **B3 open question 1: route distance** | Small | Check whether `stop_times.shape_dist_traveled` is populated in Neon before adding a 4th-tile distance. |
| **Inert RLS on `events`** | Decision | Drop or keep (zero policies; functions connect as owner). |

## Open items

- **Known wording issue, accepted (Puriya, 2026-10-28, "option A"): muddled count headlines.**
  On the v6 preview, "how many trains to Philadelphia" (asked 12:51 PM) got: "41 direct trains...
  One of them is the 12:20 AM train, which has already left. The other 40 depart from midnight
  through 11:23 PM", while ~21 had already left. The facts were right; the summary sentence
  didn't hang together. Fix if it recurs: a rule like "for how-many questions give total,
  already left and still to come" (prompt v7 + eval). Write-up material (see above).
- **`.claude/settings.json` auto-allows `mcp__Figma` (including Figma write tools) and
  `gh pr merge`.** Flagged 2026-10-28: a malicious instruction in repo content or tool output
  could then change Figma files or merge a PR without a prompt. Suggest narrowing to Figma read
  tools and removing the `gh pr merge` entries; Puriya's call.
- **Anthropic key expiry:** the old Vercel key expired after 30 days and silently broke the
  live ask box (401s, visible as error rows in `events`). If it happens again, rotate the
  key in Vercel (Production + Preview), then **redeploy**.

## How to work (reuse)

- Follow `CLAUDE.md` "How to work on this project": plain-language explanations, one step
  at a time, name the file at the top of each step, push back when an approach seems wrong,
  flag scope creep, and **always flag prompt-injection risks**.
- Evals and anything needing `ANTHROPIC_API_KEY` / `DATABASE_URL` run on the Mac (`.env.local`
  via `vercel env pull`), **during the day** (the next-train case can misread "none left today"
  at night). The deployed site is behind Vercel SSO.
- `npm test` is free and offline; run it before every push. Run `npm ci` first in a fresh checkout,
  or test files fail with `ERR_MODULE_NOT_FOUND`.
- Branch → PR → squash-merge; Vercel auto-deploys `main`. Confirm pushes landed
  (`git status -sb`). Prompt changes get a version bump and an eval run before merge.
- Work happens from more than one place (cloud sessions, Claude Code on the Mac). GitHub is
  the meeting point: pull at the start, push at the end, and don't have two sessions editing
  the same branch at once.
