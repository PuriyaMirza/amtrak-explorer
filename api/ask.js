import Anthropic from '@anthropic-ai/sdk'
import { neon } from '@neondatabase/serverless'
import { askQuestion } from '../ask-core.js'

// Cheap guardrail, even behind SSO: a longer question is almost certainly a
// mistake (or someone pasting a document), and every character costs tokens.
const MAX_QUESTION_LENGTH = 500

// Thin on purpose: validate the request, build the clients from env, call the
// shared askQuestion(), return the result. The actual ask logic lives in
// ask-core.js so the eval runner and the tests can use it too.
export default async function handler(req, res) {
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
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const sql = neon(process.env.DATABASE_URL)

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
