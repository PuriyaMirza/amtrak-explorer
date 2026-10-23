// Shared fakes for the tests. No network anywhere in this directory.

// A fake Anthropic client. Hand it the responses it should return, one per
// call to messages.create(); it records what it was sent. The request is
// deep-copied at call time because ask-core keeps mutating its `messages`
// array after the call.
export function fakeAnthropic(responses) {
  const calls = []
  let i = 0
  return {
    calls,
    messages: {
      create: async (request) => {
        calls.push(JSON.parse(JSON.stringify(request)))
        if (i >= responses.length) throw new Error('fakeAnthropic: no more responses')
        return responses[i++]
      },
    },
  }
}

// A response where Claude asks for the search_trains tool.
export function toolUseResponse(query, { id = 'tu_1', usage = { input_tokens: 100, output_tokens: 20 } } = {}) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: 'search_trains', input: { query } }],
    usage,
  }
}

// A response where Claude asks for any tool, with any input.
export function toolUseFor(name, input, { id = 'tu_1', usage = { input_tokens: 100, output_tokens: 20 } } = {}) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage }
}

// A final text response.
export function textResponse(text, usage = { input_tokens: 150, output_tokens: 30 }) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }
}

// A fake Neon `sql` tagged-template function. We tell the queries apart by
// their SQL text, and records every call as { text, values }.
//
//   search_trains (search.js): stations / routes
//   find_trains   (schedule.js): `stops` (every station row; the fake applies
//     the same id/name matching the real query does), `legs` (an object keyed
//     "FROM>TO" -> rows shaped like the legs query's output), `window`
//     (the feed's first/last calendar day)
export function fakeSql({
  stations = [],
  routes = [],
  stops = [],
  legs = {},
  window = { first_day: 20260906, last_day: 20270906 },
  fail = null,
  insertFail = null,
} = {}) {
  const calls = []
  const sql = async (strings, ...values) => {
    const text = strings.join('?')
    calls.push({ text, values })
    if (fail) throw new Error(fail)
    if (text.includes('from stops s')) return stations
    if (text.includes('from routes r')) return routes
    // schedule.js: station lookup. values = [lookup, pattern]; the pattern is
    // %text% for an ILIKE, so we strip the % and compare case-insensitively.
    if (text.includes('from stops\n')) {
      const [lookup, pattern] = values
      const needle = pattern.replaceAll('%', '').toLowerCase()
      return stops
        .filter((r) => r.stop_id.toUpperCase() === lookup.toUpperCase() || r.stop_name.toLowerCase().includes(needle))
        .sort((a, b) => a.stop_name.localeCompare(b.stop_name) || a.stop_id.localeCompare(b.stop_id)) // order by stop_name, stop_id
    }
    if (text.includes('from calendar')) return [window]
    // schedule.js: the legs query. values = [fromId, toId].
    if (text.includes('from stop_times a')) return legs[`${values[0]}>${values[1]}`] ?? []
    throw new Error('fakeSql: unexpected query')
  }
  sql.calls = calls
  // Neon clients also have `.query(text, params)`, used by insertEvent.
  // Inserts are recorded in `sql.inserts` (and fail if `insertFail` is set).
  sql.inserts = []
  sql.query = async (text, params) => {
    if (insertFail) throw new Error(insertFail)
    sql.inserts.push({ text, params })
    return []
  }
  return sql
}

// Minimal Vercel-style req/res for testing a handler directly.
export function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code
      return res
    },
    json(payload) {
      res.body = payload
      return res
    },
  }
  return res
}
