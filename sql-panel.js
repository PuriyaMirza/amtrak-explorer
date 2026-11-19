// The "</>" panel: shows the SQL a request ran, from the `queries` list every
// endpoint returns (query-log.js). A native <details>/<summary> toggle, so it
// opens and closes without JS and works with keyboards and screen readers.
//
// sqlPanelModel() is pure (no DOM) so node tests can check it, like map.js's
// previewModel(). buildSqlPanel() turns the model into elements with
// textContent only, never innerHTML: params hold whatever the user typed or
// the model chose, so they must never be parsed as HTML.

const MAX_PARAM_CHARS = 200

// One value as it would read in SQL: strings quoted ('' escapes a quote),
// NULL, numbers and booleans bare, arrays as ARRAY[...], anything else JSON.
export function formatParam(value) {
  let out
  if (value === null || value === undefined) out = 'NULL'
  else if (typeof value === 'string') out = `'${value.replaceAll("'", "''")}'`
  else if (typeof value === 'number' || typeof value === 'boolean') out = String(value)
  else if (Array.isArray(value)) out = `ARRAY[${value.map(formatParam).join(', ')}]`
  else out = JSON.stringify(value)
  return out.length > MAX_PARAM_CHARS ? out.slice(0, MAX_PARAM_CHARS) + '…' : out
}

const plural = (n, word) => `${n} ${n === 1 ? word : word === 'query' ? 'queries' : word + 's'}`

export function sqlPanelModel(queries) {
  const list = Array.isArray(queries) ? queries.filter((q) => q && typeof q.text === 'string') : []
  if (!list.length) return null
  const totalMs = list.reduce((sum, q) => sum + (Number.isFinite(q.ms) ? q.ms : 0), 0)
  return {
    summary: `SQL · ${plural(list.length, 'query')} · ${totalMs} ms`,
    items: list.map((q, i) => {
      const meta = [`Query ${i + 1}`]
      if (Number.isFinite(q.ms)) meta.push(`${q.ms} ms`)
      if (q.error) meta.push(String(q.error))
      else if (Number.isFinite(q.rows)) meta.push(plural(q.rows, 'row'))
      const params = Array.isArray(q.params) ? q.params : []
      return {
        heading: meta.join(' · '),
        text: q.text,
        params: params.map((v, j) => `$${j + 1} = ${formatParam(v)}`),
      }
    }),
  }
}

// Returns a <details> element, or null when there is nothing to show.
export function buildSqlPanel(queries, doc = document) {
  const model = sqlPanelModel(queries)
  if (!model) return null
  const el = (tag, className, text) => {
    const node = doc.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  const details = el('details', 'sql-panel')
  const summary = el('summary', 'sql-toggle')
  summary.append(el('span', 'sql-icon', '</>'), el('span', null, model.summary))
  details.append(summary)

  for (const item of model.items) {
    const block = el('div', 'sql-query')
    block.append(el('p', 'sql-meta', item.heading))
    const pre = el('pre', 'sql-text')
    pre.append(el('code', null, item.text))
    block.append(pre)
    if (item.params.length) {
      const ul = el('ul', 'sql-params')
      for (const p of item.params) ul.append(el('li', null, p))
      block.append(ul)
    }
    details.append(block)
  }

  details.append(el('p', 'sql-note',
    'Values travel separately from the SQL text ($1, $2…), so typed text is never run as SQL.'))
  return details
}
