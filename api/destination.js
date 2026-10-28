import { neon } from '@neondatabase/serverless'
import { destinationSummary } from '../destination.js'
import { resolveHomeStation } from '../ask-core.js'

// GET /api/destination?to=PHL[&from=NYP][&date=2026-10-31]
//   → destinationSummary (destination.js): the destination header numbers.
//
// Thin on purpose, like api/search.js: validate, build the client, call the
// shared function. No query logic here (CLAUDE.md, "The architecture rule").
// No AI in this path.
//
// Inputs are ids, not free text: `to` comes from a clicked search result's
// stop_id, `from` from the station picker. `from` goes through the same guard
// the ask box uses (resolveHomeStation: id-shaped AND a real stops.stop_id, else
// New York Penn), so the browser can't steer the lookup with arbitrary text.
const STOP_ID = /^[A-Za-z0-9]{1,10}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function createHandler({ makeSql }) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Use GET' })
    }

    const to = req.query?.to
    if (typeof to !== 'string' || !STOP_ID.test(to)) {
      return res.status(400).json({ error: 'Pass ?to= with a station id, e.g. PHL' })
    }
    const date = req.query?.date
    if (date !== undefined && (typeof date !== 'string' || !ISO_DATE.test(date))) {
      return res.status(400).json({ error: '"date" must be YYYY-MM-DD' })
    }

    try {
      const sql = makeSql()
      const home = await resolveHomeStation(sql, typeof req.query?.from === 'string' ? req.query.from : undefined)
      const data = await destinationSummary(sql, { from: home.stop_id, to, date })
      return res.status(200).json(data)
    } catch (err) {
      console.error('destination failed:', err)
      return res.status(500).json({ error: err.message })
    }
  }
}

export default createHandler({ makeSql: () => neon(process.env.DATABASE_URL) })
