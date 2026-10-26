# Eval run log

One row per `npm run eval` run, appended automatically (skip with `--no-record`).
This is the evidence for "I can tell whether the AI layer is getting better or
worse": compare rows with the same case count, and look at what changed in
Prompt (the `PROMPT_VERSION` in ask-core.js) between them.

Columns:

- **Date (UTC)**: when the run started, ISO 8601.
- **Mode**: `local` (askQuestion called in-process with real clients) or `remote` (HTTP to ASK_URL).
- **Model / Prompt**: the pinned model and `PROMPT_VERSION` the run used. Rows from scorer v2 on append the scorer version, e.g. `v3 (scorer 2)`; a bare `v3` was scored by scorer v1.
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

Scorer changes (`SCORER_VERSION` in eval/score.js). A scorer change moves pass
rates just like a prompt change, so rows scored by different versions are not
directly comparable. Existing rows are untouched and are implicitly scorer v1.

- **v1**: the original scorer.
- **v2**: three changes, kept as close to v1 as possible. Rule: v2 is never wrong where v1 was right.
  1. `refusalExpected` / `declineConstraint` use a wider pattern: v1 plus plural
     "no trains / no routes / no stations" (not when the next word is after, before,
     on, during, until, past, between or stop, so "no trains after 11 PM" is not a
     refusal), "unable to", "not able to", "couldn't / could not".
  2. `noRefusal` keeps the narrow v1 pattern (plus "unable to", "not able to",
     "couldn't / could not"), so plural "no trains" does not flag a correct answer
     ("No trains run on Christmas Day, but train 66 leaves at 5:44 AM").
  3. `noRefusal` first cuts scope-disclaimer clauses of the shape "<can't / cannot /
     unable to / not able to / don't have / do not have> [see, show, give, provide,
     check, book, reserve, access, tell, know, offer, quote, confirm, make, process,
     handle] <fares, prices, tickets, seat availability, delays, live status, booking,
     reservations, connections>". Only the clause is cut, so "I can't look that up, and
     I can't see fares" still fails. A clause is left alone if the negation continues
     ("can't see fares or give times") or points at the route (between / from / to /
     via / of). Bare "fares are not available" sentences are not cut. find, search and
     look up are not disclaimer verbs. When a clause was cut, the rest is tested with
     the wider pattern, since the cut "can't" no longer masks "There are no direct trains."
  Motivating false negatives, both found in the post-PR-4 run (prompt v3):
`anchorage-refusal` and `weekend-generic-philadelphia`. Known gaps are listed
  in test/fixtures/scorer-adversarial.js (`knownLimitation`).

| Date (UTC) | Mode | Model | Prompt | Pass | By category | Failure types | Failed cases |
|---|---|---|---|---|---|---|---|
| 2026-10-23T22:21Z | local | claude-sonnet-5-5 | v1 | 27/40 (68%) | easy 9/9, ambiguous 8/8, adversarial 10/10, schedule 0/13 | wrong-tool 13, wrong-time 12, wrong-refusal 11 | first-train-nyc-boston-thursday-date, first-train-nyc-boston-any-thursday, first-acela-nyc-boston-thursday-date, last-train-nyc-boston-thursday-date, fastest-train-nyc-boston-thursday-date, acela-duration-nyc-boston, southwest-chief-duration-chi-lax, lake-shore-overnight-chi-nyc, saturday-first-train-nyc-boston-date, date-outside-feed, cardinal-no-boarding-was-nyc, weekend-friday-evening-philadelphia-date, weekend-generic-philadelphia |
| 2026-10-24T10:11Z | local | claude-sonnet-5-5 | v3 | 38/40 (95%) | easy 9/9, ambiguous 8/8, adversarial 9/10, schedule 12/13 | missed-refusal 1, wrong-refusal 1 | anchorage-refusal, weekend-generic-philadelphia |
| 2026-10-24T10:37Z | local | claude-sonnet-5-5 | v3 (scorer 2) | 40/40 (100%) | easy 9/9, ambiguous 8/8, adversarial 10/10, schedule 13/13 | - | - |
| 2026-10-24T11:37Z | local | claude-sonnet-5-5 | v4 (scorer 2) | 41/41 (100%) | easy 9/9, ambiguous 8/8, adversarial 10/10, schedule 14/14 | - | - |
| 2026-10-26T11:29Z | local | claude-sonnet-5-5 | v5 (scorer 2) | 40/41 (98%) | easy 9/9, ambiguous 8/8, adversarial 10/10, schedule 13/14 | missed-refusal 1 | cardinal-no-boarding-was-nyc |
| 2026-10-26T11:47Z | local | claude-sonnet-5-5 | v5 (scorer 3) | 41/41 (100%) | easy 9/9, ambiguous 8/8, adversarial 10/10, schedule 14/14 | - | - |
