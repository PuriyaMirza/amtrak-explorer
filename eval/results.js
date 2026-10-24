// Formatting and appending of eval/RESULTS.md rows. Kept free of any
// network/model code so it can be unit-tested directly.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { FAILURE_TYPE_DESCRIPTIONS } from './taxonomy.js'
import { SCORER_VERSION } from './score.js'

export const RESULTS_HEADER = `# Eval run log

One row per \`npm run eval\` run, appended automatically (skip with \`--no-record\`).
This is the evidence for "I can tell whether the AI layer is getting better or
worse": compare rows with the same case count, and look at what changed in
Prompt (the \`PROMPT_VERSION\` in ask-core.js) between them.

Columns:

- **Date (UTC)**: when the run started, ISO 8601.
- **Mode**: \`local\` (askQuestion called in-process with real clients) or \`remote\` (HTTP to ASK_URL).
- **Model / Prompt**: the pinned model and \`PROMPT_VERSION\` the run used. Rows from scorer v2 on append the scorer version, e.g. \`v3 (scorer 2)\`; a bare \`v3\` was scored by scorer v1.
- **Pass**: cases passed / cases run. A case passes only if ALL its checks pass.
- **By category**: the same, per case category (easy, ambiguous, adversarial, schedule).
- **Failure types**: how many *failed checks* of each type (a case can fail several checks, so this can exceed the number of failed cases). Types:
${Object.entries(FAILURE_TYPE_DESCRIPTIONS)
  .map(([type, desc]) => `  - \`${type}\`: ${desc}`)
  .join('\n')}
- **Failed cases**: ids of the cases that failed (see eval/cases.js).

Scorer changes (\`SCORER_VERSION\` in eval/score.js). A scorer change moves pass
rates just like a prompt change, so rows scored by different versions are not
directly comparable. Existing rows are untouched and are implicitly scorer v1.

- **v1**: the original scorer.
- **v2**: two changes, kept minimal from v1.
  1. Refusal pattern adds plural "no trains / no routes / no stations" (not when
     the next word is after/before/on/during/until/past/between/stop, so "no
     trains after 11 PM" is not a refusal) and "unable to", "not able to",
     "couldn't / could not".
  2. \`noRefusal\` cuts scope-disclaimer clauses before testing: "<can't / cannot /
     unable to / don't / do not> <see, show, give, provide, check, book, reserve,
     access, have, tell, know, offer, quote, confirm, make, process, handle>
     <fares, prices, tickets, seat availability, delays, live status, booking,
     reservations, connections>", or "<those topics> aren't available / supported".
     Only the clause is cut, so "I can't look that up, and I can't see fares" still
     fails. A clause is left alone (and still counts as a refusal) if the negation
     continues ("can't see fares or give times") or points at the route ("between /
     from / to / via / of"). find, search and look up are deliberately not disclaimer verbs.
  Motivating false negatives, both found in the post-PR-4 run (prompt v3):
  \`anchorage-refusal\` and \`weekend-generic-philadelphia\`. Known gaps are listed
  in test/fixtures/scorer-adversarial.js (\`knownLimitation\`).

| Date (UTC) | Mode | Model | Prompt | Pass | By category | Failure types | Failed cases |
|---|---|---|---|---|---|---|---|
`

// Table cells can't contain a pipe or a newline.
function cell(text) {
  const s = String(text ?? '')
  return (s === '' ? '-' : s).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ')
}

function fraction(passed, total) {
  const pct = total === 0 ? 0 : Math.round((passed / total) * 100)
  return `${passed}/${total} (${pct}%)`
}

// Pure function: run summary in, one markdown table row out (no trailing newline).
//   date          Date (we print it as ISO, to the minute)
//   mode          'local' | 'remote'
//   model, promptVersion
//   scorerVersion  defaults to the current SCORER_VERSION; shown in the Prompt
//                  column as "v3 (scorer 2)" so rows from different scorers
//                  can be told apart
//   outcomes      [{ caseDef: { id, category }, pass, results }]
//   taxonomy      { [failureType]: count }   (from countFailures)
export function formatResultsRow({
  date,
  mode,
  model,
  promptVersion,
  scorerVersion = SCORER_VERSION,
  outcomes,
  taxonomy,
}) {
  const passed = outcomes.filter((o) => o.pass).length

  // Per-category tally, in the order categories first appear in the case list.
  const byCategory = new Map()
  for (const o of outcomes) {
    const c = byCategory.get(o.caseDef.category) || { passed: 0, total: 0 }
    c.total++
    if (o.pass) c.passed++
    byCategory.set(o.caseDef.category, c)
  }
  const categories = [...byCategory]
    .map(([name, c]) => `${name} ${c.passed}/${c.total}`)
    .join(', ')

  const types = Object.entries(taxonomy)
    .map(([type, n]) => `${type} ${n}`)
    .join(', ')

  const failedIds = outcomes.filter((o) => !o.pass).map((o) => o.caseDef.id).join(', ')

  const iso = new Date(date).toISOString().slice(0, 16) + 'Z'

  return (
    '| ' +
    [iso, mode, model, `${promptVersion} (scorer ${scorerVersion})`, fraction(passed, outcomes.length), categories, types, failedIds]
      .map(cell)
      .join(' | ') +
    ' |'
  )
}

// Creates RESULTS.md (with its header) on first use, then appends one row.
export function appendResultsRow(path, row) {
  if (!existsSync(path)) {
    writeFileSync(path, RESULTS_HEADER)
  } else if (!readFileSync(path, 'utf8').endsWith('\n')) {
    // Guard against a hand-edited file that lost its final newline; otherwise
    // our row would be glued onto the previous line.
    appendFileSync(path, '\n')
  }
  appendFileSync(path, row + '\n')
}
