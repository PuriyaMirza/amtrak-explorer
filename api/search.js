import { neon } from '@neondatabase/serverless'
import { searchTrains } from '../search.js'

const MAX_LIMIT = 50

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Use GET' })
  }

  const query = req.query?.q
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Pass ?q= with at least 2 characters' })
  }

  // Cap the limit so a caller can't ask for the whole table.
  const requested = Number(req.query?.limit) || 20
  const limit = Math.min(Math.max(requested, 1), MAX_LIMIT)

  try {
    const sql = neon(process.env.DATABASE_URL)
    const data = await searchTrains(sql, { query: query.trim(), limit })
    return res.status(200).json(data)
  } catch (err) {
    console.error('search failed:', err)
    return res.status(500).json({ error: err.message })
  }
}
