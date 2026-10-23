// The eval loop itself, separated from the CLI (run.js) so tests can drive it
// with a fake `ask` function: no network, no API key.
import { scoreCase } from './score.js'
import { countFailures, failureTypeOf } from './taxonomy.js'

// Decides where questions get answered.
//   remote: ASK_URL is set (an explicit choice always wins)
//   local:  DATABASE_URL and ANTHROPIC_API_KEY are both set
//   null:   neither, so the CLI should explain how to get credentials
export function chooseMode(env) {
  if (env.ASK_URL) return 'remote'
  if (env.DATABASE_URL && env.ANTHROPIC_API_KEY) return 'local'
  return null
}

// Names of variables that are SET but EMPTY. `vercel env pull` writes an empty
// value (KEY="") for variables marked Sensitive in Vercel, so a present-but-
// empty DATABASE_URL means "the pull succeeded but Vercel withheld the value",
// which needs a different fix than "you never pulled".
export function emptyEnvVars(env, names) {
  return names.filter((n) => n in env && String(env[n]).trim() === '')
}

// True when the run produced no real answers at all: every single case
// failed with a request error (bad API key, spend limit hit, SSO login page,
// endpoint down). Such a run says nothing about answer quality, so it must
// not be recorded as a data point in RESULTS.md.
export function allRequestErrors(outcomes) {
  return (
    outcomes.length > 0 &&
    outcomes.every((o) => o.results.length > 0 && o.results.every((r) => r.type === 'request-error'))
  )
}

// Runs every case through `ask(question)` (which resolves to
// { answer, toolCalls, ... } or throws) and scores it. Never throws for a
// single bad case: a failed request is recorded as a `request-error` failure
// so the rest of the run still happens.
//
// onOutcome(outcome) is called as each case finishes, for live printing.
export async function runCases(cases, ask, { onOutcome } = {}) {
  const outcomes = []
  for (const caseDef of cases) {
    let outcome
    try {
      const response = await ask(caseDef.question)
      const { pass, results } = scoreCase(caseDef, response)
      outcome = { caseDef, pass, results, answer: response.answer, response }
    } catch (err) {
      outcome = {
        caseDef,
        pass: false,
        results: [
          { check: 'request', name: 'request', pass: false, type: failureTypeOf('request') },
        ],
        error: err.message,
      }
    }
    outcomes.push(outcome)
    if (onOutcome) onOutcome(outcome)
  }
  return { outcomes, taxonomy: countFailures(outcomes) }
}
