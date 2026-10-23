import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/ask.js'
import { mockRes } from './helpers.js'

// The handler builds its clients from env AFTER validating the request. For
// the "valid" test we blank the env first, so building the clients fails
// immediately (a 500) instead of ever reaching the network.
let saved
beforeEach(() => {
  saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  }
  delete process.env.DATABASE_URL
  delete process.env.ANTHROPIC_API_KEY
})
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

test('rejects non-POST with 405', async () => {
  const res = mockRes()
  await handler({ method: 'GET' }, res)
  assert.equal(res.statusCode, 405)
})

test('rejects a missing question with 400', async () => {
  const res = mockRes()
  await handler({ method: 'POST', body: {} }, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /Missing/)
})

test('rejects a non-string question with 400', async () => {
  const res = mockRes()
  await handler({ method: 'POST', body: { question: 123 } }, res)
  assert.equal(res.statusCode, 400)
})

test('rejects a question over 500 characters with 400', async () => {
  const res = mockRes()
  await handler({ method: 'POST', body: { question: 'a'.repeat(501) } }, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /500/)
})

test('a question of exactly 500 characters passes validation', async () => {
  const res = mockRes()
  await handler({ method: 'POST', body: { question: 'a'.repeat(500) } }, res)
  // Not a 400: it got past validation. With env blanked, client setup fails,
  // which the handler reports as a 500. (That is the point: no network.)
  assert.notEqual(res.statusCode, 400)
  assert.notEqual(res.statusCode, 405)
})
