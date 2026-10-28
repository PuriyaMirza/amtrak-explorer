// destinationHtml() — the destination header card in index.html (PRD §7.1 B3).
// Lifted out of index.html (not copied), like render-answer.test.js, so this
// tests the shipping code; if a marker moves, the lift fails loudly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const INDEX = join(import.meta.dirname, '..', 'index.html')

function slice(html, from, to) {
  const start = html.indexOf(from)
  const end = html.indexOf(to, start)
  assert.ok(start >= 0, `"${from}" not found in index.html`)
  assert.ok(end > start, `"${to}" not found after "${from}" in index.html`)
  return html.slice(start, end)
}

function liftDestinationHtml() {
  const html = readFileSync(INDEX, 'utf8')
  const escape = slice(html, 'const escapeHtml =', '// The prompt (v5)')
  const search = slice(html, 'function routeKind', '// Debounce:')
  const { destinationHtml } = new Function(`${escape}\n${search}; return { destinationHtml }`)()
  assert.equal(typeof destinationHtml, 'function', 'destinationHtml was not defined by the lifted source')
  return destinationHtml
}

const destinationHtml = liftDestinationHtml()
const ATTACK = '<img src=x onerror=alert(1)>'

// The shape api/destination.js returns (see destination.js), for NYP -> BOS
// on Thursday 2026-10-29, as in test/destination.test.js.
const train = (t, depart, duration) => ({ train: t, depart, duration })
const BASE = {
  ok: true,
  outsideFeed: false,
  from: { stop_id: 'NYP', name: 'New York Penn Station' },
  to: { stop_id: 'BOS', name: 'Boston South Station' },
  date: '2026-10-29',
  weekday: 'thursday',
  trainsPerDay: 5,
  fastest: train('2999', '11:30 PM', '1h 40m'),
  median: { minutes: 254, duration: '4h 14m' },
  earliest: train('66', '5:44 AM', '4h 21m'),
  latest: train('2999', '11:30 PM', '1h 40m'),
  routes: ['Northeast Regional', 'Acela'],
  medianPartial: false,
  notes: [],
}
const count = (html, re) => (html.match(re) || []).length

test('normal day: title, four stat tiles, route pills, Amtrak link, holiday line', () => {
  const out = destinationHtml(BASE)
  assert.match(out, /<h3 class="dest-name">Boston South Station<\/h3>/)
  assert.match(out, /FROM NEW YORK PENN STATION · THURSDAY 2026-10-29 · TIMES ET/)
  assert.equal(count(out, /class="stat"/g), 4)
  assert.match(out, /1h 40m<\/span><span class="stat-label">fastest · train 2999/)
  assert.match(out, /4h 14m<\/span><span class="stat-label">median</)
  assert.match(out, />5<\/span><span class="stat-label">trains that day/)
  assert.match(out, /5:44 AM – 11:30 PM<\/span><span class="stat-label">first – last departure \(ET\)/)
  assert.equal(count(out, /class="pill"/g), 2)
  assert.match(out, /href="https:\/\/www\.amtrak\.com\/" target="_blank" rel="noopener noreferrer"/)
  assert.match(out, /Holiday schedules are not modelled/)
})

test('one train: singular label; a partial median says so', () => {
  assert.match(destinationHtml({ ...BASE, trainsPerDay: 1 }), /train that day</)
  assert.match(destinationHtml({ ...BASE, medianPartial: true }), /median \(first 100 trains\)/)
})

test('no trains that day: says so, no tiles', () => {
  const out = destinationHtml({ ...BASE, trainsPerDay: 0, fastest: null, median: null, earliest: null, latest: null, routes: [] })
  assert.match(out, /No direct train from New York Penn Station on thursday 2026-10-29/)
  assert.equal(count(out, /class="stat"/g), 0)
})

test('outside the feed: says there is no data, not "no trains"', () => {
  const out = destinationHtml({ ...BASE, outsideFeed: true })
  assert.match(out, /No schedule data for/)
  assert.doesNotMatch(out, /No direct train/)
})

test('a station that did not match shows the server note as text', () => {
  const out = destinationHtml({ ok: false, notes: [`No station matches to "${ATTACK}".`] })
  assert.ok(!out.includes('<img'), 'raw <img> reached the HTML')
  assert.match(out, /&lt;img/)
})

test('hostile names and routes are shown as text, never run', () => {
  const out = destinationHtml({
    ...BASE,
    from: { stop_id: 'NYP', name: ATTACK },
    to: { stop_id: '"><b>', name: ATTACK },
    routes: [ATTACK],
    fastest: train(ATTACK, '1:00 AM', '1h 00m'),
  })
  assert.ok(!out.includes('<img'), 'raw <img> reached the HTML')
  assert.ok(!out.includes('"><b>'), 'a quote broke out')
})
