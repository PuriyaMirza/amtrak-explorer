// stations.js + api/stations.js: the station list behind the map.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listStations } from '../stations.js'
import { createHandler } from '../api/stations.js'
import { mockRes } from './helpers.js'

// A fake `sql` that records the query and returns fixed rows. Coordinates come
// back as TEXT on purpose: GTFS imports often store them that way.
function fakeSql(rows, { fail } = {}) {
  const calls = []
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join('?'), values })
    if (fail) throw new Error(fail)
    return rows
  }
  sql.calls = calls
  return sql
}

const ROWS = [
  { stop_id: 'NYP', stop_name: 'Ny Moynihan Train Hall At Penn Station', stop_lat: '40.750638', stop_lon: '-73.993899' },
  { stop_id: 'PHL', stop_name: 'Philadelphia 30th Street', stop_lat: '39.955615', stop_lon: '-75.181840' },
  { stop_id: 'BAD1', stop_name: 'Broken Coordinates', stop_lat: 'n/a', stop_lon: '-75.0' },
  { stop_id: 'BAD2', stop_name: 'Null Island Station', stop_lat: '0', stop_lon: '0' },
  { stop_id: 'BAD3', stop_name: 'Out Of Range Station', stop_lat: '120', stop_lon: '-75.0' },
]

test('listStations: our display names, numeric coordinates, bad positions dropped', async () => {
  const stations = await listStations(fakeSql(ROWS))
  assert.deepEqual(stations, [
    { id: 'NYP', name: 'New York Penn Station', lat: 40.750638, lon: -73.993899 },
    { id: 'PHL', name: 'Philadelphia 30th Street', lat: 39.955615, lon: -75.18184 },
  ])
})

test('listStations: one fixed query, trains only, junk names filtered, no request input', async () => {
  const sql = fakeSql([])
  await listStations(sql)
  assert.equal(sql.calls.length, 1)
  const { text, values } = sql.calls[0]
  assert.deepEqual(values, [], 'the query takes no parameters at all')
  assert.match(text, /r\.route_type = 2/, 'trains only (no bus-only Thruway stops)')
  assert.match(text, /length\(s\.stop_name\) > 5/, 'drops truncated junk names')
  assert.match(text, /stop_lat is not null and s\.stop_lon is not null/)
})

test('endpoint: GET only', async () => {
  const res = mockRes()
  await createHandler({ makeSql: () => fakeSql(ROWS) })({ method: 'POST' }, res)
  assert.equal(res.statusCode, 405)
})

test('endpoint: 200 with { stations } and an edge-cache header', async () => {
  const res = mockRes()
  await createHandler({ makeSql: () => fakeSql(ROWS) })({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.stations.length, 2)
  assert.match(res.headers['cache-control'], /s-maxage=86400/)
})

test('endpoint: a database error is a 500 with the message, and is not cached', async () => {
  const res = mockRes()
  await createHandler({ makeSql: () => fakeSql([], { fail: 'db down' }) })({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 500)
  assert.equal(res.body.error, 'db down')
  assert.equal(res.headers['cache-control'], undefined)
})
