// Tests renderAnswer() — the v5 answer-layout parser in index.html.
//
// Why this file exists: the eval suite scores answer TEXT, never the rendered
// page. A prompt change could keep the evals at 41/41 while the page quietly
// stopped parsing the lines and fell back to one paragraph. That blind spot is
// what made shipping prompt v5 without an eval risky, and it is not something
// a model-level eval can close.
//
// renderAnswer is a pure string -> string function, so it is testable with no
// browser and no network. It is LIFTED OUT OF index.html rather than copied,
// so this tests the code that actually ships: if someone edits the function,
// this test follows the edit. If the lift fails (the function moved or was
// renamed), the test fails loudly rather than silently passing on a stale copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const INDEX = join(import.meta.dirname, '..', 'index.html')

function liftRenderAnswer() {
  const html = readFileSync(INDEX, 'utf8')
  const start = html.indexOf('const escapeHtml =')
  const end = html.indexOf('askForm.addEventListener')
  assert.ok(start >= 0, 'escapeHtml not found in index.html — did it move or get renamed?')
  assert.ok(end > start, 'askForm.addEventListener not found after escapeHtml in index.html')
  const { renderAnswer } = new Function(`${html.slice(start, end)}; return { renderAnswer }`)()
  assert.equal(typeof renderAnswer, 'function', 'renderAnswer was not defined by the lifted source')
  return renderAnswer
}

const renderAnswer = liftRenderAnswer()
const countOf = (html, re) => (html.match(re) || []).length

// A real prompt-v5 answer, captured 2026-10-26 from a live askQuestion call
// ("first three trains to Providence this Thursday"). Frozen on purpose: it is
// the contract between the prompt's line format and this parser. If the prompt
// changes shape, update this fixture deliberately and bump PROMPT_VERSION.
const V5_THREE_TRAINS = [
  "Thursday 2026-10-29, New York Penn Station to Providence, Eastern time (you didn't name a departure station, so I used your home station)",
  '5:44 AM → 9:15 AM · Northeast Regional 66 · 3h 31m · starts the evening before',
  '6:53 AM → 10:20 AM · Northeast Regional 1150 · 3h 27m',
  '7:57 AM → 10:57 AM · Acela 2150 · 3h 00m',
  'Holiday schedules are not modelled, so please confirm on amtrak.com.',
].join('\n')

test('v5 train list: headline, one row per train, holiday footnote', () => {
  const out = renderAnswer(V5_THREE_TRAINS)
  assert.match(out, /^<div class="answer">/, 'took the fallback path instead of the layout')
  assert.equal(countOf(out, /class="answer-lead"/g), 1, 'headline line')
  assert.equal(countOf(out, /class="train-row"/g), 3, 'one row per train')
  assert.equal(countOf(out, /class="answer-note"/g), 1, 'holiday footnote')
})

test('v5 train list: a row splits into times, train, duration and the optional note', () => {
  const out = renderAnswer(V5_THREE_TRAINS)
  assert.match(out, /<span class="train-times">5:44 AM → 9:15 AM<\/span>/)
  assert.match(out, /<span class="train-name">Northeast Regional 66<\/span>/)
  assert.match(out, /<span class="train-dur">3h 31m<\/span>/)
  // The service-day note (train 66 boards the evening before) must survive.
  assert.match(out, /<span class="train-note">starts the evening before<\/span>/)
  // Only the train that had a note gets one.
  assert.equal(countOf(out, /class="train-note"/g), 1)
})

test('prose answer with a holiday line: lead plus footnote, no train rows', () => {
  // The real v5 answer to cardinal-no-boarding-was-nyc: a refusal, not a list.
  const out = renderAnswer(
    "No. The Cardinal (train 50) stops at both Washington Union Station and New York Penn " +
      "Station, but it doesn't allow boarding at Washington.\n\n" +
      'Holiday schedules are not modelled, so please confirm on amtrak.com.',
  )
  assert.equal(countOf(out, /class="train-row"/g), 0)
  assert.equal(countOf(out, /class="answer-lead"/g), 1)
  assert.equal(countOf(out, /class="answer-note"/g), 1)
})

test('a one-line answer stays a single plain paragraph', () => {
  const out = renderAnswer('Penn Station is served by 14 routes.')
  assert.equal(out, '<p class="answer">Penn Station is served by 14 routes.</p>')
})

// The guard that matters most: the answer is model output going into innerHTML.
test('model output is escaped, in both the layout and the fallback path', () => {
  const payload = '<img src=x onerror="alert(1)">'

  // Fallback path (single line).
  const one = renderAnswer(payload)
  assert.ok(!one.includes('<img'), 'raw <img> reached the fallback output')
  assert.match(one, /&lt;img/)

  // Layout path, including inside a train row's cells.
  const many = renderAnswer(
    `${payload}\n5:44 AM → 9:15 AM · ${payload} · 3h 31m\nHoliday schedules are not modelled.`,
  )
  assert.ok(!many.includes('<img'), 'raw <img> reached the layout output')
  assert.equal(countOf(many, /&lt;img/g), 2, 'escaped in both the headline and the train name')
  assert.ok(!many.includes('onerror="'), 'an unescaped attribute quote survived')
})

// v6: "- " lines become real bullets. Fixture = the real answer from the live
// site on 2026-10-28 ("How many trains to Philadelphia today?"), which used
// "- " lines even under the v5 "no bullet points" rule.
const BULLET_ANSWER = [
  'There are 41 direct trains from New York Penn Station to Philadelphia today, Wednesday 2026-10-28.',
  '- The first is Northeast Regional 1169 at 12:20 AM Eastern time. It started the evening before.',
  '- The last is Northeast Regional 67 at 11:23 PM Eastern time. It arrives at 12:51 AM the next day.',
  '- The fastest is Acela 2133 at 12:10 PM Eastern time, which takes 1h 08m.',
  'This count covers direct trains only, not connections. Holiday schedules are not modelled, so confirm on amtrak.com.',
].join('\n')

test('v6 bullets: consecutive "- " lines become ONE list, dashes removed', () => {
  const out = renderAnswer(BULLET_ANSWER)
  assert.equal(countOf(out, /<ul class="answer-list">/g), 1, 'one list for the three lines')
  assert.equal(countOf(out, /<li>/g), 3)
  assert.match(out, /<li>The first is Northeast Regional 1169 at 12:20 AM/)
  assert.ok(!out.includes('<li>- '), 'the "- " marker should be stripped')
  assert.equal(countOf(out, /class="answer-lead"/g), 1, 'headline still bold')
  assert.equal(countOf(out, /class="answer-note"/g), 1, 'holiday line still a footnote')
})

test('v6 bullets: "•" also works; separate runs make separate lists', () => {
  const out = renderAnswer('Head\n• one\n• two\nMiddle sentence.\n- three')
  assert.equal(countOf(out, /<ul class="answer-list">/g), 2)
  assert.equal(countOf(out, /<li>/g), 3)
})

test('v6 bullets: a "- " in front of a train line keeps it a train row', () => {
  const out = renderAnswer('Head\n- 5:44 AM → 9:15 AM · Northeast Regional 66 · 3h 31m')
  assert.equal(countOf(out, /class="train-row"/g), 1)
  assert.equal(countOf(out, /<li>/g), 0)
  assert.match(out, /<span class="train-times">5:44 AM → 9:15 AM<\/span>/)
})

test('v6 bullets: a hyphen inside a sentence is not a bullet', () => {
  const out = renderAnswer('Head\nThe Acela is a fast-ish train - usually.')
  assert.equal(countOf(out, /<li>/g), 0)
})

test('v6 bullets: bullet text is escaped', () => {
  const out = renderAnswer('Head\n- <img src=x onerror="alert(1)">')
  assert.ok(!out.includes('<img'))
  assert.match(out, /<li>&lt;img/)
})
