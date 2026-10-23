// Runs every case in cases.js and prints pass/fail, then appends a row to
// eval/RESULTS.md.
//
// Two modes:
//
//   LOCAL (default): calls askQuestion() in this process, with a real
//   Anthropic client and a real Neon connection. No HTTP, so the SSO wall in
//   front of the deployed site doesn't matter. Needs DATABASE_URL and
//   ANTHROPIC_API_KEY, which you get with:
//
//       vercel env pull .env.local
//       npm run eval                # loads .env.local automatically
//       # or: node --env-file=.env.local eval/run.js
//
//   REMOTE: set ASK_URL and it POSTs to that endpoint instead (e.g. a
//   `vercel dev` server; the deployed site is behind SSO, so plain fetch gets
//   a login page):
//
//       ASK_URL=http://localhost:3000/api/ask node eval/run.js
//
// Flags:
//   --no-record      don't append a row to eval/RESULTS.md (use while iterating)
//   --allow-failures exit 0 even if some cases failed (what `npm run eval` uses).
//                    Without it, exit 1 = some cases failed. Setup problems exit
//                    2, and a run where every request errored exits 3, either way.
//
// Cost note: a run makes ~40+ real model calls. Run it on demand, never in CI.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CASES } from './cases.js'
import { chooseMode, runCases, emptyEnvVars, allRequestErrors } from './runner.js'
import { formatResultsRow, appendResultsRow } from './results.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RESULTS_PATH = fileURLToPath(new URL('./RESULTS.md', import.meta.url))
const ENV_FILE = `${ROOT}.env.local`

const args = process.argv.slice(2)
const record = !args.includes('--no-record')
// `npm run eval` passes this so npm doesn't bury the results under its own
// "command failed" error block when some cases fail (expected at baseline).
// Failures are still printed and recorded; only the exit code differs. Plain
// `node eval/run.js` exits 1 if any case failed, which is what scripts want.
const allowFailures = args.includes('--allow-failures')

// Node 20.12+ can read a .env file itself, so no dotenv dependency.
// loadEnvFile never overwrites variables that are already set, so a real
// shell export still wins over the file.
if (existsSync(ENV_FILE)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(ENV_FILE)
  } else {
    console.error(
      `This Node (${process.version}) is too old to load .env files itself (needs 20.12+).\n` +
        'Run with:  node --env-file=.env.local eval/run.js   (also needs Node 20.6+)\n' +
        'or upgrade Node.',
    )
    process.exit(2)
  }
}

const REQUIRED_FOR_LOCAL = ['DATABASE_URL', 'ANTHROPIC_API_KEY']

function printSetupHelp() {
  console.error(`Can't run evals: no way to reach the ask logic.

Local mode (recommended) needs DATABASE_URL and ANTHROPIC_API_KEY.
Pull them from Vercel into a git-ignored file, then run again:

    vercel env pull .env.local
    npm run eval

(eval/run.js loads .env.local automatically. You can also do
 node --env-file=.env.local eval/run.js)

Remote mode: set ASK_URL to an /api/ask endpoint you can reach, e.g.
 ASK_URL=http://localhost:3000/api/ask node eval/run.js   (with \`vercel dev\`)
The deployed site is behind Vercel SSO, so it can't be used as ASK_URL.`)
}

// Remote mode: POST to a running endpoint.
function makeRemoteAsk(url) {
  return async (question) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    return res.json()
  }
}

// Local mode: build real clients from env and call the shared ask logic.
// Imported lazily so remote mode doesn't need the SDKs initialised.
async function makeLocalAsk() {
  const [{ default: Anthropic }, { neon }, core] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('@neondatabase/serverless'),
    import('../ask-core.js'),
  ])
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const sql = neon(process.env.DATABASE_URL)
  return {
    ask: (question) => core.askQuestion({ anthropic, sql, question }),
    model: core.MODEL,
    promptVersion: core.PROMPT_VERSION,
  }
}

async function main() {
  const mode = chooseMode(process.env)
  if (!mode) {
    // A variable that exists but is empty gets its own message: the usual
    // cause is that `vercel env pull` blanks Sensitive variables.
    const empty = emptyEnvVars(process.env, REQUIRED_FOR_LOCAL)
    if (empty.length) {
      console.error(`${empty.join(' and ')} ${empty.length > 1 ? 'are' : 'is'} set but EMPTY.

This is what \`vercel env pull\` does for variables marked "Sensitive" in
Vercel: it writes the name with an empty value, because Sensitive values can't
be read back. Fix it one of these ways:
  - put the real value in .env.local by hand (copy it from Neon / the
    Anthropic console), or
  - in Vercel, make the variable non-Sensitive for the Development
    environment and pull again.
Then re-run. (Secrets stay out of git: .env.local is git-ignored.)`)
      process.exit(2)
    }
    printSetupHelp()
    process.exit(2)
  }

  let ask
  let model = 'unknown'
  let promptVersion = 'unknown'
  if (mode === 'local') {
    ;({ ask, model, promptVersion } = await makeLocalAsk())
  } else {
    ask = makeRemoteAsk(process.env.ASK_URL)
  }

  const where = mode === 'local' ? 'in-process (local)' : process.env.ASK_URL
  console.log(`Running ${CASES.length} eval cases, ${where}\n`)
  const startedAt = new Date()

  const { outcomes, taxonomy } = await runCases(CASES, ask, {
    onOutcome(outcome) {
      const { caseDef } = outcome
      console.log(
        `[${outcome.pass ? 'PASS' : 'FAIL'}] ${caseDef.id} (${caseDef.category}) — "${caseDef.question}"`,
      )
      if (!outcome.pass) {
        for (const r of outcome.results.filter((r) => !r.pass)) {
          console.log(`         failed check: ${r.name}  [${r.type}]`)
        }
        if (outcome.error) console.log(`         error: ${outcome.error}`)
        if (outcome.answer) console.log(`         answer: ${outcome.answer}`)
      }
    },
  })

  // Remote runs learn the model/prompt version from the endpoint's response
  // (older deployments don't send them, hence 'unknown').
  if (mode === 'remote') {
    const seen = outcomes.find((o) => o.response?.model)?.response
    if (seen) {
      model = seen.model
      promptVersion = seen.promptVersion ?? promptVersion
    }
  }

  const passed = outcomes.filter((o) => o.pass).length
  const rate = ((passed / outcomes.length) * 100).toFixed(0)
  console.log(`\n${passed}/${outcomes.length} passed (${rate}%)`)

  // Every case died on the request itself: nothing was actually evaluated.
  // Recording it would put a fake 0% in the log, so refuse and say why.
  if (allRequestErrors(outcomes)) {
    console.error(`
WARNING: every case failed with a request error, so nothing was evaluated.
Nothing was written to eval/RESULTS.md. Likely causes:
  - a wrong or expired ANTHROPIC_API_KEY
  - the Anthropic spend limit has been reached
  - ASK_URL points at the SSO-protected site (you got a login page / HTTP 401)
  - the endpoint or database is down
First error seen: ${outcomes[0].error}`)
    process.exit(3)
  }

  const types = Object.entries(taxonomy)
  if (types.length) {
    console.log('\nFailure taxonomy (failed checks by type):')
    for (const [type, n] of types) console.log(`  ${type}: ${n}`)
  }

  if (record) {
    const row = formatResultsRow({
      date: startedAt,
      mode,
      model,
      promptVersion,
      outcomes,
      taxonomy,
    })
    appendResultsRow(RESULTS_PATH, row)
    console.log('\nRecorded a row in eval/RESULTS.md')
  } else {
    console.log('\n--no-record: nothing written to eval/RESULTS.md')
  }

  process.exit(passed === outcomes.length || allowFailures ? 0 : 1)
}

main().catch((err) => {
  console.error('Eval run crashed:', err)
  process.exit(1)
})
