import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatParam, sqlPanelModel, buildSqlPanel } from '../sql-panel.js'

test('formatParam reads like SQL', () => {
  assert.equal(formatParam('%boston%'), "'%boston%'")
  assert.equal(formatParam("O'Hare"), "'O''Hare'")
  assert.equal(formatParam(20), '20')
  assert.equal(formatParam(null), 'NULL')
  assert.equal(formatParam(['NYP', 'BOS']), "ARRAY['NYP', 'BOS']")
  assert.ok(formatParam('x'.repeat(500)).endsWith('…'))
})

test('sqlPanelModel: summary, per-query heading, text and numbered params', () => {
  const m = sqlPanelModel([
    { text: 'select * from stops where stop_name ilike $1 limit $2', params: ['%bos%', 20], ms: 41, rows: 3 },
    { text: 'select 1', params: [], ms: 9, rows: 1 },
  ])
  assert.equal(m.summary, 'SQL · 2 queries · 50 ms')
  assert.equal(m.items[0].heading, 'Query 1 · 41 ms · 3 rows')
  assert.equal(m.items[1].heading, 'Query 2 · 9 ms · 1 row')
  assert.deepEqual(m.items[0].params, ["$1 = '%bos%'", '$2 = 20'])
  assert.deepEqual(m.items[1].params, [])
})

test('sqlPanelModel: a failed query shows its generic error, not a row count', () => {
  const m = sqlPanelModel([{ text: 'select 1', params: [], ms: 5, error: 'query failed' }])
  assert.equal(m.items[0].heading, 'Query 1 · 5 ms · query failed')
})

test('sqlPanelModel: nothing to show -> null (no panel)', () => {
  assert.equal(sqlPanelModel(undefined), null)
  assert.equal(sqlPanelModel([]), null)
  assert.equal(sqlPanelModel([{ nope: 1 }]), null)
})

// A tiny fake document: records textContent and children, and fails the test
// if anything ever sets innerHTML.
function fakeDoc() {
  const make = (tag) => {
    const node = { tag, className: '', children: [], _text: undefined }
    Object.defineProperty(node, 'textContent', { set(v) { node._text = v }, get() { return node._text } })
    Object.defineProperty(node, 'innerHTML', { set() { throw new Error('innerHTML must not be used') } })
    node.append = (...kids) => node.children.push(...kids)
    return node
  }
  return { createElement: make }
}
const allText = (n) => [n._text ?? '', ...n.children.flatMap(allText)].join('\n')

test('buildSqlPanel: user text in params stays text (textContent only, never innerHTML)', () => {
  const evil = '<img src=x onerror=alert(1)>'
  const panel = buildSqlPanel([{ text: 'select $1', params: [evil], ms: 1, rows: 0 }], fakeDoc())
  assert.equal(panel.tag, 'details')
  assert.equal(panel.children[0].tag, 'summary')
  assert.ok(allText(panel).includes(`$1 = '${evil}'`))
})

test('buildSqlPanel: returns null when there are no queries', () => {
  assert.equal(buildSqlPanel([], fakeDoc()), null)
})
