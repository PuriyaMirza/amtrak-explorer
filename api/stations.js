import { neon } from '@neondatabase/serverless'
import { listStations } from '../stations.js'

// GET /api/stations → listStations (stations.js): every train station with its
// position, for the map. Thin on purpose, like api/search.js: no query logic
// here, and it takes no input at all, so there is nothing to validate.
//
// The schedule data changes only when the feed is reloaded, so the response
// is cached at Vercel's edge for a day (s-maxage). Browsers revalidate.
export function createHandler({ makeSql }) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Use GET' })
    }
    try {
      const stations = await listStations(makeSql())
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=3600')
      return res.status(200).json({ stations })
    } catch (err) {
      console.error('stations failed:', err)
      return res.status(500).json({ error: err.message })
    }
  }
}

export default createHandler({ makeSql: () => neon(process.env.DATABASE_URL) })
