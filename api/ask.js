import Anthropic from '@anthropic-ai/sdk'
import { neon } from '@neondatabase/serverless'
import { askQuestion } from '../ask-core.js'
import { logAsk } from '../ask-log.js'

// Cheap guardrail, even behind SSO: a longer question is almost certainly a
// mistake (or someone pasting a document), and every character costs tokens.
const MAX_QUESTION_LENGTH = 500

// Accepts an id only if it's a non-empty string of sane length.
function cleanId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : undefined
}

// The default way to get clients: real ones, built from env vars.
function clientsFromEnv() {
  return {
    anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    sql: neon(process.env.DATABASE_URL),
  }
}

// Thin on purpose: validate the request, build the clients, call the shared
// askQuestion(), log the exchange (ask-log.js), return the result. The actual
// ask logic lives in ask-core.js so the eval runner and the tests can use it too.
//
// createHandler takes `makeClients` as a parameter (dependency injection, like
// search.js) so a test can supply fakes. Vercel only uses the default export.
export function createHandler({ makeClients }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Use POST' })
    }

    const question = req.body?.question
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Missing "question" in request body' })
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return res
        .status(400)
        .json({ error: `Question too long (max ${MAX_QUESTION_LENGTH} characters)` })
    }

    // device_id / session_id are optional (same ids events.js sends to /api/log).
    // Anything that isn't a reasonable string is ignored; logAsk substitutes a
    // placeholder because the table requires both.
    const deviceId = cleanId(req.body?.device_id)
    const sessionId = cleanId(req.body?.session_id)

    try {
      const { anthropic, sql } = makeClients()

      const startedAt = Date.now()
      let result
      try {
        result = await askQuestion({ anthropic, sql, question })
      } catch (err) {
        // Log the failed ask too, then let the outer catch send the 500.
        await logAsk(sql, {
          question, deviceId, sessionId,
          error: err.message,
          latencyMs: Date.now() - startedAt,
        })
        throw err
      }

      // logAsk never throws and gives up after a short timeout, so logging
      // can't break or noticeably delay the answer.
      await logAsk(sql, { question, deviceId, sessionId, result, latencyMs: Date.now() - startedAt })

      const { answer, toolCalls, model, promptVersion } = result

      // model + promptVersion are extra fields: the browser ignores them, but
      // a remote eval run (ASK_URL mode) uses them to label its RESULTS.md row.
      return res.status(200).json({ answer, toolCalls, model, promptVersion })
    } catch (err) {
      console.error('ask handler failed:', err)
      return res.status(500).json({ error: err.message })
    }
  }
}

export default createHandler({ makeClients: clientsFromEnv })
