// The ONE place that knows how to insert a row into the `events` table.
//
// Two callers use it:
//   - api/log.js  : rows the browser asks us to write (search, click)
//   - api/ask.js  : rows the server writes about itself (ask), via ask-log.js
//
// Like search.js, it takes the `sql` client as a parameter instead of importing
// one (dependency injection), so a test can hand it a fake.

// The columns a caller is allowed to write. This list is the whitelist: any
// other key in `fields` is silently ignored, so a caller can never write to a
// column we didn't intend to expose. (`id` and `created_at` are filled in by
// the database's own defaults.)
export const INSERTABLE_COLUMNS = [
  'event_type',
  'device_id',
  'session_id',
  'query_id',
  'query_text',
  'stop_count',
  'route_count',
  'target_type',
  'target_id',
  'target_label',
  'result_position',
  'result_group',
  'metadata',
]

// Built once from the whitelist above, never from caller input, so there is
// nothing for a caller to inject into. Values go in as $1, $2, ... parameters.
const INSERT_SQL =
  `insert into events (${INSERTABLE_COLUMNS.join(', ')}) values (` +
  INSERTABLE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ') +
  ')'

// Inserts one events row. `sql` must be a Neon client (it needs `.query`).
// Columns missing from `fields` become NULL, except `metadata`, which the
// table requires and so defaults to an empty object.
export async function insertEvent(sql, fields = {}) {
  const values = INSERTABLE_COLUMNS.map((col) =>
    col === 'metadata' ? fields.metadata ?? {} : fields[col] ?? null,
  )
  await sql.query(INSERT_SQL, values)
}
