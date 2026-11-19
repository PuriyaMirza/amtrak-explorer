import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withQueryLog, toQueryText, dedent } from '../query-log.js'

// A fake Neon client: a tag function that returns canned rows.
function fakeSql(rowsFor = () => [{ a: 1 }], delayFor = () => 0) {
  const calls = []
  const sql = async (strings, ...values) => {
    calls.push({ strings, values })
    await new Promise((r) => setTimeout(r, delayFor(values)))
    return rowsFor(values)
  }
  sql.query = async (text, values) => {
    calls.push({ text, values })
    return []
  }
  sql.calls = calls
  return sql
}

test('records placeholder text, params and row count; returns the real rows', async () => {
  const base = fakeSql(() => [{ x: 1 }, { x: 2 }])
  const { sql, queries } = withQueryLog(base)
  const pattern = '%boston%'
  const rows = await sql`select * from stops where stop_name ilike ${pattern} limit ${5}`
  assert.deepEqual(rows, [{ x: 1 }, { x: 2 }])
  assert.equal(queries.length, 1)
  assert.equal(queries[0].text, 'select * from stops where stop_name ilike $1 limit $2')
  assert.deepEqual(queries[0].params, ['%boston%', 5])
  assert.equal(queries[0].rows, 2)
  assert.equal(typeof queries[0].ms, 'number')
})

test('passes the original pieces and values to the real client unchanged', async () => {
  const base = fakeSql()
  const { sql } = withQueryLog(base)
  await sql`select ${1}, ${'two'}`
  assert.deepEqual(base.calls[0].values, [1, 'two'])
  assert.deepEqual([...base.calls[0].strings], ['select ', ', ', ''])
})

test('keeps issue order when queries run together and finish out of order', async () => {
  const base = fakeSql(() => [], ([v]) => (v === 'first' ? 30 : 0))
  const { sql, queries } = withQueryLog(base)
  await Promise.all([sql`select ${'first'}`, sql`select ${'second'}`])
  assert.deepEqual(queries.map((q) => q.params[0]), ['first', 'second'])
})

test('a failing query is recorded with a generic error and still throws', async () => {
  const base = async () => { throw new Error('connect ECONNREFUSED secret-host:5432') }
  const { sql, queries } = withQueryLog(base)
  await assert.rejects(() => sql`select 1`, /ECONNREFUSED/)
  assert.equal(queries[0].error, 'query failed')
  assert.ok(!JSON.stringify(queries).includes('secret-host'))
})

test('sql.query() is passed through and not recorded (events insert)', async () => {
  const base = fakeSql()
  const { sql, queries } = withQueryLog(base)
  await sql.query('insert into events (event_type) values ($1)', ['ask'])
  assert.equal(queries.length, 0)
  assert.equal(base.calls[0].text, 'insert into events (event_type) values ($1)')
})

test('dedent strips shared indentation and blank edges', () => {
  assert.equal(dedent('\n      select a\n        from b\n      where c\n    '), 'select a\n  from b\nwhere c')
  assert.equal(toQueryText(['\n    select ', '\n    from t\n  ']), 'select $1\nfrom t')
})
