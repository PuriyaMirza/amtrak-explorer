# Handoff: next session

Written 2026-10-26, after the prompt-v5 eval run and the scorer 3 fix.
Read this first, then `CLAUDE.md` (how to work, architecture) and `docs/PRD.md` (decisions).

## Where things stand

- **Shipped (all merged to `main`, live on Vercel):** PR #3 eval harness, #4 ask-box logging,
  #5 `find_trains`, #6 `plan_weekend`, #7 docs, #8 eval scorer v2, #11 tool labels,
  #12 home station (prompt v4), #13 station picker, #14 handoff, **#15 Stamp blues restyle
  + answer layout (prompt v5)**.
- **PR #15, what changed:**
  - `styles.css`: "Stamp blues" palette from Figma (file `z1KG6ozWc2BW0Eg6SqX5QK`, node
    `213:555`) as CSS tokens on `:root` (`--surface-1..4`, `--accent-1..2`), Manrope font,
    cards (10px radius), indigo button, aqua pills, `.lookups` callout for tool calls.
  - `index.html`: header + numbered cards (01 Search, 02 Ask); new `renderAnswer()` turns
    the v5 answer lines into a layout: line 1 = bold headline, `dep → arr · train · duration
    [· note]` lines = grid rows, a last line mentioning "holiday" = small footnote. Anything
    else stays one paragraph. Every piece goes through `escapeHtml` (tested with an
    `<img onerror>` answer: rendered as text).
  - `ask-core.js`: system prompt asks for that line format; `PROMPT_VERSION` = **v5**.
  - `.claude/settings.json`: allows all Figma MCP tools (`mcp__Figma`) without prompting,
    including Figma *write* tools.
  - Deliberately NOT built: the Figma sheet's fare, holiday-calendar, region and
    data-freshness components. The data can't back them (no fares, no `calendar_dates`,
    no static JSON build).
- **Evals** (`eval/RESULTS.md`), run locally on Puriya's Mac:

  | Run | Prompt | Scorer | Pass | Schedule |
  |---|---|---|---|---|
  | 2026-10-23 baseline | v1 | 1 | 27/40 | 0/13 |
  | 2026-10-24 after PR #6 | v3 | 1 | 38/40 | 12/13 |
  | 2026-10-24 after PR #8 | v3 | 2 | 40/40 | 13/13 |
  | 2026-10-24 after PR #12 | v4 | 2 | 41/41 | 14/14 |
  | 2026-10-26 after PR #15 | v5 | 2 | 40/41 | 13/14 |
  | 2026-10-26 after scorer 3 | v5 | 3 | **41/41** | 14/14 |

- **The v5 run came in at 40/41**, and the one failure was **not** a model bug. The answer to
  `cardinal-no-boarding-was-nyc` was correct and grounded — it said no three ways ("No.",
  "doesn't allow boarding", "no usable Cardinal") and scorer 2 recognised none of them. So the
  v5 line format did not cost a time, the "Eastern" mention or the holiday caveat; it changed
  answer *wording*, and the wording drifted outside a refusal heuristic built from v1 phrasing.
- **Scorer 3 fixes that** (`eval/score.js`): the three phrasings live in a new
  `REFUSAL_PATTERN_EXPECT`, read **only** by `refusalExpected` / `declineConstraint`.
  `REFUSAL_PATTERN_V1` and `_LOOSE` are byte-identical to before, deliberately: `noRefusal`
  falls back to `_LOOSE` whenever a scope disclaimer is cut, so widening `_LOOSE` would also
  have made the "must NOT refuse" direction stricter — the direction where an extra phrase
  fails a *correct* answer. Adversarial fixtures 75 → 80 (the real answer, two phrasing
  variants, two negatives that must keep failing). vs the frozen v1 scorer: 19 fixed,
  **0 regressed**. `npm test` 270 pass.
- **The scorer-3 re-run came in 41/41** (2026-10-26), matching the offline prediction. The other
  40 cases scored identically under scorer 2 and scorer 3, which is the live evidence that the
  three new phrasings widened nothing. **Prompt v5 is a genuine 41/41.**

## Do first (next session), in order

1. **Live check of the v5 layout** (still never done — the evals score answer *text*, not the
   page): ask "first three trains to Providence this Thursday" on the live site. Expect a
   headline, 3 rows, a footnote. If the model ignores the format, the page falls back to one
   paragraph (not broken, just unformatted) and the prompt needs firmer wording.
2. **"Next train" needs the current time** (carried over, the next real feature). "When is
   the next train to New York" got "I don't know the current time": `systemPromptFor` gives
   today's date but not the time. Fix: add the current New York time the same way (server clock,
   never the request — the same injection guard as `today`), plus an eval case that checks a time
   window or `departAfter` in the tool input, not a fixed train. Prompt change → **v6**, then
   `npm run eval` (the v5/scorer-3 41/41 is the baseline it has to beat or hold).

## Small open items

- **Unescaped DB text in search results** (found during #15, not fixed): `render()` in
  `index.html` puts `stop_name` / `route_long_name` into `innerHTML` and `data-*`
  attributes without `escapeHtml`. Low risk (our own GTFS data), but it is the same XSS
  shape the ask answer guards against. One small PR: run those values through `escapeHtml`.
- **Inert RLS on `events`:** decide drop vs keep (zero policies; functions connect as owner).
- **Write-up #1 (roadmap D), Puriya's to write.** Raw material:
  - `eval/RESULTS.md`: 27 → 38 → 40 → 41 → 40/41 (v5; the dip was the scorer, not the model).
  - The Cardinal baseline answer: "Yes" to an impossible WAS→NYP trip, an ungrounded
    answer that sounds right.
  - Scorer false negatives caught by reading failures; a narrow regex fix broke ~10 other
    answers and only a 75-answer adversarial set caught it. Test the evaluator too.
  - Service-day vs physical-day (train 66). The original eval expectation was wrong.
  - New for v5: a presentation change (line format) is still a prompt change, so it gets
    a version bump and an eval run.
  - **The strongest single case: `cardinal-no-boarding-was-nyc`, three outcomes on one
    question.** v1 said "Yes" to a trip you physically cannot board (ungrounded, sounded
    right). v5 said no and named the restriction, the direction that does work, and the
    alternatives. And the *scorer* called that correct answer a failure. Three of the four
    recorded eval failures to date have been scorer bugs — the measurement instrument drifts
    too, which is why `test/score-adversarial.test.js` (80 fixtures) and a frozen v1 scorer
    exist. That is the argument of the write-up in one case.
- **Next phase (PRD §7):** browse filters, map, weekend finder (reuse `planWeekend`
  through a plain `/api/` endpoint).
- **Anthropic key expiry:** the old Vercel key expired after 30 days and silently broke the
  live ask box (401s, visible as error rows in `events`). If it happens again, rotate the
  key in Vercel (Production + Preview), then **redeploy**.

## How to work (reuse)

- Follow `CLAUDE.md` "How to work on this project": plain-language explanations, one step
  at a time, name the file at the top of each step, push back when an approach seems wrong,
  flag scope creep, and **always flag prompt-injection risks**.
- Evals and anything needing `ANTHROPIC_API_KEY` / `DATABASE_URL` run on the Mac (`.env.local`
  via `vercel env pull`). The deployed site is behind Vercel SSO.
- `npm test` is free and offline; run it before every push. Run `npm ci` first in a fresh checkout,
  or 4 test files fail with `ERR_MODULE_NOT_FOUND`.
- Branch → PR → squash-merge; Vercel auto-deploys `main`. Confirm pushes landed
  (`git status -sb`).
