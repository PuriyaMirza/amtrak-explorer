import { neon } from '@neondatabase/serverless'

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

    // Columns are listed explicitly rather than spread from the body, so a
    // caller can't write to a column we didn't intend to expose.
    await sql.query(
      `insert into events (
         event_type, device_id, session_id, query_id,
         query_text, stop_count, route_count,
         target_type, target_id, target_label,
         result_position, result_group, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        body.event_type,
        body.device_id,
        body.session_id,
        body.query_id ?? null,
        body.query_text ?? null,
        body.stop_count ?? null,
        body.route_count ?? null,
        body.target_type ?? null,
        body.target_id ?? null,
        body.target_label ?? null,
        body.result_position ?? null,
        body.result_group ?? null,
        body.metadata ?? {},
      ]
    )

    return res.status(204).end()
  } catch (err) {
    console.error('log failed:', err)
    return res.status(500).json({ error: err.message })
  }
}
