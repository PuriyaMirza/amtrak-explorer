import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertEvent, INSERTABLE_COLUMNS } from '../event-store.js'
import log from '../api/log.js'
import { mockRes } from './helpers.js'

function recordingSql() {
  const calls = []
  return { calls, query: async (text, params) => { calls.push({ text, params }) } }
}

test('insertEvent writes every whitelisted column, in order, as parameters', async () => {
  const sql = recordingSql()
  await insertEvent(sql, { event_type: 'click', device_id: 'd', session_id: 's', target_type: 'station', target_id: 'CHI' })
  const { text, params } = sql.calls[0]
  assert.equal(params.length, INSERTABLE_COLUMNS.length)
  assert.equal(params[INSERTABLE_COLUMNS.indexOf('target_id')], 'CHI')
  assert.equal(params[INSERTABLE_COLUMNS.indexOf('query_text')], null) // missing -> NULL
  assert.deepEqual(params[INSERTABLE_COLUMNS.indexOf('metadata')], {}) // metadata defaults to {}
  assert.match(text, /^insert into events \(event_type, device_id/)
  assert.match(text, /\$13\)$/)
})

test('insertEvent ignores unknown fields (cannot reach id, created_at, or anything else)', async () => {
  const sql = recordingSql()
  await insertEvent(sql, {
    event_type: 'search', device_id: 'd', session_id: 's',
    id: 'forged-id', created_at: '1999-01-01', evil: 'x); drop table events;--',
  })
  const { text, params } = sql.calls[0]
  const columns = text.match(/\(([^)]*)\) values/)[1].split(', ')
  assert.deepEqual(columns, INSERTABLE_COLUMNS)
  assert.ok(!text.includes('forged') && !text.includes('evil') && !text.includes('drop'))
  assert.ok(!params.includes('forged-id') && !params.includes('1999-01-01'))
})

test('api/log.js still rejects event_type "ask" from the browser', async () => {
  const res = mockRes()
  await log({ method: 'POST', body: { event_type: 'ask', device_id: 'd', session_id: 's' } }, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /Unknown event_type/)
})

test('api/log.js rejects an unknown type and missing ids', async () => {
  let res = mockRes()
  await log({ method: 'POST', body: { event_type: 'bogus', device_id: 'd', session_id: 's' } }, res)
  assert.equal(res.statusCode, 400)
  res = mockRes()
  await log({ method: 'POST', body: { event_type: 'search' } }, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /Missing/)
})
