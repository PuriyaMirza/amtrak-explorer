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

// A final text response.
export function textResponse(text, usage = { input_tokens: 150, output_tokens: 30 }) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }
}

// A fake Neon `sql` tagged-template function. searchTrains() runs two
// queries (stations, routes); we tell them apart by their SQL text. Records
// every call as { text, values }.
export function fakeSql({ stations = [], routes = [], fail = null, insertFail = null } = {}) {
  const calls = []
  const sql = async (strings, ...values) => {
    const text = strings.join('?')
    calls.push({ text, values })
    if (fail) throw new Error(fail)
    if (text.includes('from stops s')) return stations
    if (text.includes('from routes r')) return routes
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
