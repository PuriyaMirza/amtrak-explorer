import Anthropic from '@anthropic-ai/sdk'
import { neon } from '@neondatabase/serverless'
import { askQuestion } from '../ask-core.js'

// Cheap guardrail, even behind SSO: a longer question is almost certainly a
// mistake (or someone pasting a document), and every character costs tokens.
const MAX_QUESTION_LENGTH = 500

// The default way to get clients: real ones, built from env vars.
function clientsFromEnv() {
  return {
    anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    sql: neon(process.env.DATABASE_URL),
  }
}

// Thin on purpose: validate the request, build the clients, call the shared
// askQuestion(), return the result. The actual ask logic lives in ask-core.js
// so the eval runner and the tests can use it too.
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

    try {
      const { anthropic, sql } = makeClients()

      const { answer, toolCalls, model, promptVersion } = await askQuestion({
        anthropic,
        sql,
        question,
      })

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
