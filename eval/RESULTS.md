# Eval run log

One row per `npm run eval` run, appended automatically (skip with `--no-record`).
This is the evidence for "I can tell whether the AI layer is getting better or
worse": compare rows with the same case count, and look at what changed in
Prompt (the `PROMPT_VERSION` in ask-core.js) between them.

Columns:

- **Date (UTC)**: when the run started, ISO 8601.
- **Mode**: `local` (askQuestion called in-process with real clients) or `remote` (HTTP to ASK_URL).
- **Model / Prompt**: the pinned model and `PROMPT_VERSION` the run used.
- **Pass**: cases passed / cases run. A case passes only if ALL its checks pass.
- **By category**: the same, per case category (easy, ambiguous, adversarial, schedule).
- **Failure types**: how many *failed checks* of each type (a case can fail several checks, so this can exceed the number of failed cases). Types:
  - `missing-entity`: answer left out a station/route it should have named
  - `wrong-time`: answer left out the real time, duration or train number
  - `hallucinated-entity`: answer included something it must not (invented place, price)
  - `missed-refusal`: answered when it should have refused or declined
  - `wrong-refusal`: refused when a real answer was available
  - `no-grounding`: no search query about the thing asked, so the answer is ungrounded
  - `wrong-tool`: never called the tool the question needs
  - `request-error`: the request itself failed (HTTP/API error)
- **Failed cases**: ids of the cases that failed (see eval/cases.js).

| Date (UTC) | Mode | Model | Prompt | Pass | By category | Failure types | Failed cases |
|---|---|---|---|---|---|---|---|
| 2026-10-23T22:21Z | local | claude-sonnet-5-5 | v1 | 27/40 (68%) | easy 9/9, ambiguous 8/8, adversarial 10/10, schedule 0/13 | wrong-tool 13, wrong-time 12, wrong-refusal 11 | first-train-nyc-boston-thursday-date, first-train-nyc-boston-any-thursday, first-acela-nyc-boston-thursday-date, last-train-nyc-boston-thursday-date, fastest-train-nyc-boston-thursday-date, acela-duration-nyc-boston, southwest-chief-duration-chi-lax, lake-shore-overnight-chi-nyc, saturday-first-train-nyc-boston-date, date-outside-feed, cardinal-no-boarding-was-nyc, weekend-friday-evening-philadelphia-date, weekend-generic-philadelphia |
