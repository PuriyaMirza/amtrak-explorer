// Runs every case in cases.js against a live /api/ask and prints pass/fail.
//
//   node eval/run.js                                   # deployed site
//   ASK_URL=http://localhost:3000/api/ask node eval/run.js   # vercel dev

import { CASES } from './cases.js'
import { scoreCase } from './score.js'

const ASK_URL = process.env.ASK_URL || 'https://amtrak-explorer.vercel.app/api/ask'

async function askOne(question) {
  const res = await fetch(ASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return res.json()
}

async function main() {
  console.log(`Running ${CASES.length} eval cases against ${ASK_URL}\n`)

  const outcomes = []
  for (const caseDef of CASES) {
    let outcome
    try {
      const response = await askOne(caseDef.question)
      const { pass, results } = scoreCase(caseDef, response)
      outcome = { caseDef, pass, results, answer: response.answer }
    } catch (err) {
      outcome = { caseDef, pass: false, results: [{ name: 'request', pass: false }], error: err.message }
    }
    outcomes.push(outcome)

    const status = outcome.pass ? 'PASS' : 'FAIL'
    console.log(`[${status}] ${caseDef.id} (${caseDef.category}) — "${caseDef.question}"`)
    if (!outcome.pass) {
      for (const r of outcome.results.filter((r) => !r.pass)) {
        console.log(`         failed check: ${r.name}`)
      }
      if (outcome.error) console.log(`         error: ${outcome.error}`)
      if (outcome.answer) console.log(`         answer: ${outcome.answer}`)
    }
  }

  const passed = outcomes.filter((o) => o.pass).length
  const rate = ((passed / outcomes.length) * 100).toFixed(0)
  console.log(`\n${passed}/${outcomes.length} passed (${rate}%)`)

  process.exit(passed === outcomes.length ? 0 : 1)
}

main()
