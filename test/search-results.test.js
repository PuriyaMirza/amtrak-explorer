// Tests searchResultsHtml() — the search-results list in index.html.
//
// Why: the list is built as an HTML string, so any database value dropped in
// unescaped (stop_name, route_long_name, ...) would be run by the browser,
// not shown. Low risk with our own GTFS data, but it is the same XSS shape
// the ask box already guards against. These tests pin the guard.
//
// Like render-answer.test.js, the function is LIFTED OUT OF index.html (not
// copied), so this tests the code that ships. If a marker moves, the lift
// fails loudly instead of passing on a stale copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const INDEX = join(import.meta.dirname, '..', 'index.html')

function slice(html, from, to) {
  const start = html.indexOf(from)
  const end = html.indexOf(to, start)
  assert.ok(start >= 0, `"${from}" not found in index.html — did it move or get renamed?`)
  assert.ok(end > start, `"${to}" not found after "${from}" in index.html`)
  return html.slice(start, end)
}

function liftSearchResultsHtml() {
  const html = readFileSync(INDEX, 'utf8')
  const escape = slice(html, 'const escapeHtml =', '// The prompt (v5)')
  const search = slice(html, 'function routeKind', '// Debounce:')
  const { searchResultsHtml } = new Function(`${escape}\n${search}; return { searchResultsHtml }`)()
  assert.equal(typeof searchResultsHtml, 'function', 'searchResultsHtml was not defined by the lifted source')
  return searchResultsHtml
}

const searchResultsHtml = liftSearchResultsHtml()
const ATTACK = '<img src=x onerror=alert(1)>'
const QUOTE_BREAK = '" onmouseover="alert(1)'

test('normal results: one row per station and per distinct route', () => {
  const out = searchResultsHtml({
    stations: [{ stop_id: 'NYP', stop_name: 'New York Penn Station', stop_timezone: 'America/New_York' }],
    routes: [
      { route_long_name: 'Acela', route_type: 2 },
      { route_long_name: 'Acela', route_type: 2 },
      { route_long_name: 'Thruway Bus', route_type: 3 },
    ],
  }, 'q1')
  assert.match(out, /<h2>Stations \(1\)<\/h2>/)
  assert.match(out, /<h2>Routes \(2\)<\/h2>/)
  assert.match(out, /New York Penn Station <span class="meta">NYP · America\/New_York<\/span>/)
  assert.match(out, /<span class="pill">bus<\/span>/)
})

test('a hostile station name is shown as text, not run', () => {
  const out = searchResultsHtml({
    stations: [{ stop_id: 'X1', stop_name: ATTACK, stop_timezone: null }],
    routes: [],
  }, 'q1')
  assert.ok(!out.includes('<img'), 'raw <img> tag reached the HTML')
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('a hostile route name is shown as text, not run', () => {
  const out = searchResultsHtml({ stations: [], routes: [{ route_long_name: ATTACK, route_type: 2 }] }, 'q1')
  assert.ok(!out.includes('<img'), 'raw <img> tag reached the HTML')
})

test('a quote cannot break out of a data-* attribute', () => {
  const out = searchResultsHtml({
    stations: [{ stop_id: QUOTE_BREAK, stop_name: QUOTE_BREAK, stop_timezone: '' }],
    routes: [{ route_long_name: QUOTE_BREAK, route_type: 2 }],
  }, 'q1')
  assert.ok(!out.includes('" onmouseover='), 'a quote closed the attribute early')
  assert.match(out, /data-label="&quot; onmouseover=&quot;alert\(1\)"/)
})

test('a null timezone shows as empty instead of "null" or a crash', () => {
  const out = searchResultsHtml({ stations: [{ stop_id: 'BOS', stop_name: 'Boston South', stop_timezone: null }], routes: [] }, 'q1')
  assert.match(out, /BOS · <\/span>/)
})

test('no results: both empty states', () => {
  const out = searchResultsHtml({ stations: [], routes: [] }, 'q1')
  assert.match(out, /No matching stations\./)
  assert.match(out, /No matching routes\./)
})
