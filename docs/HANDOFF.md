# Handoff: next session

Written 2026-10-26, after PR #15 (UI restyle + answer layout, prompt v5).
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
  | **v5: not run yet** | v5 | 2 | ? | ? |

- **v5 went live without an eval.** Puriya chose to merge first. Risk: the line format
  could cost a time, the "Eastern" mention or the holiday caveat in some answers.

## Do first (next session), in order

1. **Run the v5 eval** (Puriya, in the VS Code terminal; ~5 min, a few tens of cents):
   `git pull && npm run eval`. 41/41 → commit only `eval/RESULTS.md`. Any failure → read
   the answer text before blaming the model (two past "failures" were scorer bugs); a real
   regression means fixing the prompt wording in `ask-core.js`, not the scorer.
2. **Live check of the new layout:** ask "first three trains to Providence this Thursday".
   Expect a headline, 3 rows, a footnote. If the model ignores the format, the page falls
   back to one paragraph (not broken, just unformatted) and the prompt needs firmer wording.
3. **"Next train" needs the current time** (carried over). "When is the next train to New
   York" got "I don't know the current time": `systemPromptFor` gives today's date but not
   the time. Fix: add the current New York time the same way (server clock, never the
   request), plus an eval case that checks a time window or `departAfter` in the tool
   input, not a fixed train. Prompt change → **v6**, then `npm run eval`.

## Small open items

- **Unescaped DB text in search results** (found during #15, not fixed): `render()` in
  `index.html` puts `stop_name` / `route_long_name` into `innerHTML` and `data-*`
  attributes without `escapeHtml`. Low risk (our own GTFS data), but it is the same XSS
  shape the ask answer guards against. One small PR: run those values through `escapeHtml`.
- **Inert RLS on `events`:** decide drop vs keep (zero policies; functions connect as owner).
- **Write-up #1 (roadmap D), Puriya's to write.** Raw material:
  - `eval/RESULTS.md`: 27 → 38 → 40 → 41 (and v5 once run).
  - The Cardinal baseline answer: "Yes" to an impossible WAS→NYP trip, an ungrounded
    answer that sounds right.
  - Scorer false negatives caught by reading failures; a narrow regex fix broke ~10 other
    answers and only a 75-answer adversarial set caught it. Test the evaluator too.
  - Service-day vs physical-day (train 66). The original eval expectation was wrong.
  - New for v5: a presentation change (line format) is still a prompt change, so it gets
    a version bump and an eval run.
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
