// Records the SQL each request runs, so the page can show it ("</>" panel).
//
// Every query module (search.js, schedule.js, stations.js) takes the Neon `sql`
// client as a parameter. withQueryLog(sql) returns a stand-in client that runs
// each query exactly as before and also writes down what ran: the text Postgres
// receives ($1, $2 placeholders), the values sent separately, the time taken and
// the row count. No query logic changes; the modules don't know it's there.
//
// Only tagged-template queries (sql`...`) are recorded. sql.query() is passed
// through unrecorded: the one caller is the events insert (event-store.js),
// which is bookkeeping, not part of answering the request.
//
// The log goes to the browser only, never into a model prompt (see api/ask.js).

// Tagged template pieces -> the text Postgres receives: "... ilike $1 ...".
export function toQueryText(strings) {
  let text = strings[0]
  for (let i = 1; i < strings.length; i++) text += `$${i}` + strings[i]
  return dedent(text)
}

// Strip the common leading indentation and blank edge lines, so a query written
// inside indented JS reads cleanly.
export function dedent(text) {
  const lines = text.replace(/\t/g, '  ').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length)
  const cut = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(cut).trimEnd()).join('\n')
}

export function withQueryLog(sql, { now = () => performance.now() } = {}) {
  const queries = []

  const logged = async (strings, ...values) => {
    // Reserve the slot at call time, so queries run together (Promise.all)
    // stay in the order the code issued them, not the order they finished.
    const entry = { text: toQueryText(strings), params: values }
    queries.push(entry)
    const started = now()
    try {
      const rows = await sql(strings, ...values)
      entry.ms = Math.round(now() - started)
      entry.rows = Array.isArray(rows) ? rows.length : null
      return rows
    } catch (err) {
      entry.ms = Math.round(now() - started)
      entry.error = 'query failed' // never the driver's message: it can echo connection details
      throw err
    }
  }

  if (typeof sql.query === 'function') logged.query = (...args) => sql.query(...args)

  return { sql: logged, queries }
}
