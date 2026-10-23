import { neon } from '@neondatabase/serverless'
import { insertEvent } from '../event-store.js'

// Event types a BROWSER may submit. 'ask' is deliberately absent: ask rows are
// written server-side only (api/ask.js), so a browser can't forge them.
const VALID_TYPES = ['search', 'click']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' })
  }

  const body = req.body ?? {}

  if (!VALID_TYPES.includes(body.event_type)) {
    return res.status(400).json({ error: 'Unknown event_type' })
  }
  if (!body.device_id || !body.session_id) {
    return res.status(400).json({ error: 'Missing device_id or session_id' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    // insertEvent owns the column whitelist (see event-store.js), so passing
    // the whole body is safe: keys it doesn't list are ignored.
    await insertEvent(sql, body)

    return res.status(204).end()
  } catch (err) {
    console.error('log failed:', err)
    return res.status(500).json({ error: err.message })
  }
}
