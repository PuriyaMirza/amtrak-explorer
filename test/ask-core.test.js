import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  askQuestion,
  MODEL,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  systemPromptFor,
  SEARCH_TOOL,
  FIND_TRAINS_TOOL,
  PLAN_WEEKEND_TOOL,
  TOOLS,
  MAX_ROUNDS,
  TRAIN_RESULT_LIMIT,
  TRAIN_RESULT_MAX,
} from '../ask-core.js'
import { fakeAnthropic, fakeSql, toolUseResponse, toolUseFor, textResponse } from './helpers.js'

const BOSTON_STATIONS = [
  { stop_id: 'BOS', stop_name: 'Boston', stop_timezone: 'America/New_York', routes: ['Acela'] },
]
const BOSTON_ROUTES = [{ route_long_name: 'Acela', stops: ['Boston', 'New Haven'] }]

test('constants: model is pinned and the prompt version is v3 (plan_weekend added)', () => {
  assert.equal(MODEL, 'claude-sonnet-5-5')
  assert.equal(PROMPT_VERSION, 'v3')
})

test('tool_use then text: runs the real query and returns the full result shape', async () => {
  const anthropic = fakeAnthropic([toolUseResponse('boston'), textResponse('The Acela serves Boston.')])
  const sql = fakeSql({ stations: BOSTON_STATIONS, routes: BOSTON_ROUTES })

  const result = await askQuestion({ anthropic, sql, question: 'What serves Boston?' })

  assert.equal(result.answer, 'The Acela serves Boston.')
  assert.equal(result.rounds, 2)
  assert.equal(result.model, MODEL)
  assert.equal(result.promptVersion, PROMPT_VERSION)
  // Tokens are summed across both rounds.
  assert.deepEqual(result.usage, { input_tokens: 250, output_tokens: 50 })

  // toolCalls records the tool name (needed for the toolCalled eval check),
  // the query, and the rows we sent back.
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].name, 'search_trains')
  assert.equal(result.toolCalls[0].query, 'boston')
  // The full input the model sent is recorded (the ask logger stores it), and
  // so is how many rows came back.
  assert.deepEqual(result.toolCalls[0].input, { query: 'boston' })
  assert.equal(result.toolCalls[0].rowCount, 2)
  assert.deepEqual(result.toolCalls[0].result.stations, [
    { id: 'BOS', name: 'Boston', timezone: 'America/New_York', routes: ['Acela'] },
  ])
  assert.deepEqual(result.toolCalls[0].result.routes, [
    { name: 'Acela', stops: ['Boston', 'New Haven'] },
  ])

  // The database was queried with the model's search text as a bound parameter.
  assert.equal(sql.calls.length, 2)
  assert.ok(sql.calls.every((c) => c.values.includes('%boston%')))
})

test('the first request carries the pinned model, system prompt (with today) and all three tools', async () => {
  const anthropic = fakeAnthropic([textResponse('hi')])
  const now = new Date('2026-10-23T16:00:00Z')
  await askQuestion({ anthropic, sql: fakeSql(), question: 'hello', now })

  const [req] = anthropic.calls
  assert.equal(req.model, MODEL)
  assert.equal(req.system, systemPromptFor(now))
  assert.ok(req.system.startsWith(SYSTEM_PROMPT))
  assert.match(req.system, /Today is friday 2026-10-23 \(US Eastern time\)\.$/)
  assert.deepEqual(req.tools, [SEARCH_TOOL, FIND_TRAINS_TOOL, PLAN_WEEKEND_TOOL])
  assert.deepEqual(req.tools, TOOLS)
  assert.deepEqual(req.messages, [{ role: 'user', content: 'hello' }])
})

test('the second request sends the real rows back as a tool_result', async () => {
  const anthropic = fakeAnthropic([toolUseResponse('boston', { id: 'tu_42' }), textResponse('ok')])
  const sql = fakeSql({ stations: BOSTON_STATIONS, routes: BOSTON_ROUTES })
  await askQuestion({ anthropic, sql, question: 'q' })

  const second = anthropic.calls[1].messages
  const last = second[second.length - 1]
  assert.equal(last.role, 'user')
  assert.equal(last.content[0].type, 'tool_result')
  assert.equal(last.content[0].tool_use_id, 'tu_42')
  assert.match(last.content[0].content, /Acela/)
})

test('no tool use: answers in one round with no tool calls', async () => {
  const anthropic = fakeAnthropic([textResponse('Just text.')])
  const result = await askQuestion({ anthropic, sql: fakeSql(), question: 'hi' })
  assert.equal(result.rounds, 1)
  assert.deepEqual(result.toolCalls, [])
  assert.equal(result.answer, 'Just text.')
})

test('a failing query is reported to the model and recorded, not thrown', async () => {
  const anthropic = fakeAnthropic([toolUseResponse('boston'), textResponse('Sorry, lookup failed.')])
  const sql = fakeSql({ fail: 'db down' })

  const result = await askQuestion({ anthropic, sql, question: 'q' })

  assert.equal(result.answer, 'Sorry, lookup failed.')
  assert.equal(result.toolCalls[0].name, 'search_trains')
  assert.equal(result.toolCalls[0].error, 'db down')
  const last = anthropic.calls[1].messages.at(-1)
  assert.match(last.content[0].content, /db down/)
})

test('stops after MAX_ROUNDS if the model keeps asking for the tool', async () => {
  const responses = Array.from({ length: MAX_ROUNDS }, (_, i) =>
    toolUseResponse('boston', { id: `tu_${i}` }),
  )
  const anthropic = fakeAnthropic(responses)
  const result = await askQuestion({ anthropic, sql: fakeSql({ stations: [], routes: [] }), question: 'q' })

  assert.equal(result.rounds, MAX_ROUNDS)
  assert.equal(anthropic.calls.length, MAX_ROUNDS)
  // No text from the model, so the fallback message is used.
  assert.match(result.answer, /try rephrasing/)
})

test('missing usage from the API counts as zero instead of crashing', async () => {
  const anthropic = fakeAnthropic([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }])
  const result = await askQuestion({ anthropic, sql: fakeSql(), question: 'q' })
  assert.deepEqual(result.usage, { input_tokens: 0, output_tokens: 0 })
})

test('multiple text blocks are joined and trimmed', async () => {
  const anthropic = fakeAnthropic([
    {
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: '  Part one.' },
        { type: 'text', text: 'Part two.  ' },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  ])
  const result = await askQuestion({ anthropic, sql: fakeSql(), question: 'q' })
  assert.equal(result.answer, 'Part one.\nPart two.')
})

// ---------------------------------------------------------------------------
// PR 3: the find_trains tool and the v2 prompt
// ---------------------------------------------------------------------------

const hms = (h, m) => h * 3600 + m * 60
const THU = { sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 1, friday: 0, saturday: 0 }
const WED = { ...THU, thursday: 0, wednesday: 1 }
const legRow = (train, route, dep, arr, days) => ({
  train, route, dep_secs: dep, arr_secs: arr, can_board: true, can_alight: true,
  ...days, start_date: 20260906, end_date: 20270906,
})
const STOPS = [
  { stop_id: 'NYP', stop_name: 'Ny Moynihan Train Hall At Penn Station', stop_timezone: 'America/New_York' },
  { stop_id: 'BOS', stop_name: 'Boston', stop_timezone: 'America/New_York' },
]
const NYP_BOS = [
  legRow('66', 'Northeast Regional', hms(29, 44), hms(34, 5), WED),
  legRow('1150', 'Northeast Regional', hms(6, 53), hms(11, 7), THU),
]
const NOW = new Date('2026-10-23T16:00:00Z')

test('find_trains: the model calls it, the real trains reach the next turn, the call is recorded', async () => {
  const input = { from: 'New York', to: 'BOS', date: '2026-10-29' }
  const anthropic = fakeAnthropic([
    toolUseFor('find_trains', input, { id: 'tu_ft' }),
    textResponse('The first train is 66 at 5:44 AM Eastern.'),
  ])
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': NYP_BOS } })

  const result = await askQuestion({ anthropic, sql, question: 'First train to Boston on Thursday?', now: NOW })

  assert.equal(result.answer, 'The first train is 66 at 5:44 AM Eastern.')
  assert.equal(result.rounds, 2)

  // Recorded for the eval (name), and for the logger (full input, row count).
  const call = result.toolCalls[0]
  assert.equal(call.name, 'find_trains')
  assert.deepEqual(call.input, input)
  assert.equal(call.rowCount, 2)
  assert.equal(call.query, undefined) // search_trains-only field
  assert.equal(call.result.trains[0].train, '66')

  // The REAL rows went back to the model as the tool_result.
  const last = anthropic.calls[1].messages.at(-1)
  assert.equal(last.content[0].tool_use_id, 'tu_ft')
  const sent = JSON.parse(last.content[0].content)
  assert.equal(sent.trains[0].train, '66')
  assert.equal(sent.trains[0].depart, '5:44 AM')
  assert.equal(sent.summary.count, 2)
  assert.ok(sent.notes.some((n) => /Holiday schedules are not modelled/.test(n)))
})

test('find_trains: bad input comes back to the model as an error, not a crash', async () => {
  const anthropic = fakeAnthropic([
    toolUseFor('find_trains', { from: 'NYP', to: 'BOS', date: 'next thursday' }),
    textResponse('Sorry, which date?'),
  ])
  const result = await askQuestion({ anthropic, sql: fakeSql({ stops: STOPS }), question: 'q', now: NOW })

  assert.equal(result.answer, 'Sorry, which date?')
  assert.match(result.toolCalls[0].error, /YYYY-MM-DD/)
  assert.equal(result.toolCalls[0].name, 'find_trains')
  assert.deepEqual(result.toolCalls[0].input, { from: 'NYP', to: 'BOS', date: 'next thursday' })
  assert.match(anthropic.calls[1].messages.at(-1).content[0].content, /YYYY-MM-DD/)
})

test('find_trains: the result is row-capped (default 12, never above 20), summary still covers all', async () => {
  // 30 weekday trains, one every 10 minutes from 6:00.
  const many = Array.from({ length: 30 }, (_, i) =>
    legRow(String(100 + i), 'Northeast Regional', hms(6, 0) + i * 600, hms(10, 0) + i * 600, THU),
  )
  const run = async (extra) => {
    const anthropic = fakeAnthropic([
      toolUseFor('find_trains', { from: 'NYP', to: 'BOS', date: '2026-10-29', ...extra }),
      textResponse('ok'),
    ])
    const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': many } })
    const result = await askQuestion({ anthropic, sql, question: 'q', now: NOW })
    return result.toolCalls[0]
  }

  const dflt = await run({})
  assert.equal(TRAIN_RESULT_LIMIT, 12)
  assert.equal(dflt.result.trains.length, 12)
  assert.equal(dflt.rowCount, 12)
  assert.equal(dflt.result.summary.count, 30)
  assert.equal(dflt.result.summary.latest.train, '129') // the last train is still known

  const greedy = await run({ limit: 100 })
  assert.equal(TRAIN_RESULT_MAX, 20)
  assert.equal(greedy.result.trains.length, 20)

  const few = await run({ limit: 3 })
  assert.equal(few.result.trains.length, 3)
})

test('tools can be mixed in one question, and each round re-sends the tools', async () => {
  const anthropic = fakeAnthropic([
    toolUseResponse('boston', { id: 'tu_a' }),
    toolUseFor('find_trains', { from: 'NYP', to: 'BOS', date: '2026-10-29' }, { id: 'tu_b' }),
    textResponse('Done.'),
  ])
  const sql = fakeSql({ stations: [], routes: [], stops: STOPS, legs: { 'NYP>BOS': NYP_BOS } })
  const result = await askQuestion({ anthropic, sql, question: 'q', now: NOW })
  assert.deepEqual(result.toolCalls.map((c) => c.name), ['search_trains', 'find_trains'])
  assert.ok(anthropic.calls.every((c) => c.tools.length === 3))
})

test('an unknown tool name is reported back, not executed', async () => {
  const anthropic = fakeAnthropic([toolUseFor('drop_tables', {}), textResponse('no')])
  const sql = fakeSql()
  const result = await askQuestion({ anthropic, sql, question: 'q', now: NOW })
  assert.match(result.toolCalls[0].error, /unknown tool/)
  assert.equal(sql.calls.length, 0)
})

test('the v2 prompt: grounding rule, holiday caveat, Eastern time, no stale "cannot filter by time" line', () => {
  assert.match(SYSTEM_PROMPT, /ONLY state stations, routes, train numbers, times and durations that a tool returned/)
  assert.match(SYSTEM_PROMPT, /holiday schedules are not modelled/)
  assert.match(SYSTEM_PROMPT, /amtrak\.com/)
  assert.match(SYSTEM_PROMPT, /Eastern/)
  assert.doesNotMatch(SYSTEM_PROMPT, /cannot filter by trip duration/)
  // The prompt-injection eval case looks for these phrases leaking.
  assert.ok(SYSTEM_PROMPT.includes('You help people explore Amtrak'))
  assert.ok(SYSTEM_PROMPT.includes('Never invent a station'))
})

test('systemPromptFor: today is New York today (evening there is still the same day)', () => {
  assert.match(systemPromptFor(new Date('2026-10-24T02:00:00Z')), /Today is friday 2026-10-23/)
  assert.match(systemPromptFor(new Date('2026-10-24T05:00:00Z')), /Today is saturday 2026-10-24/)
})

test('find_trains tool definition: required inputs and weekday enum', () => {
  assert.equal(FIND_TRAINS_TOOL.name, 'find_trains')
  assert.deepEqual(FIND_TRAINS_TOOL.input_schema.required, ['from', 'to'])
  assert.deepEqual(FIND_TRAINS_TOOL.input_schema.properties.weekday.enum.length, 7)
  assert.match(FIND_TRAINS_TOOL.description, /first\/last\/fastest/)
})

test('find_trains: only whitelisted fields reach schedule.js; a model-supplied "today" is ignored', async () => {
  // Real "today" (injected) is Friday 2026-10-23, so weekday "thursday" must
  // mean 2026-10-29. The model tries to say today is 2026-11-19.
  const anthropic = fakeAnthropic([
    toolUseFor('find_trains', { from: 'NYP', to: 'BOS', weekday: 'thursday', today: '2026-11-19', extra: 'x' }),
    textResponse('ok'),
  ])
  const sql = fakeSql({ stops: STOPS, legs: { 'NYP>BOS': NYP_BOS } })
  const result = await askQuestion({ anthropic, sql, question: 'q', now: NOW })

  const sent = result.toolCalls[0].result
  assert.equal(sent.date, '2026-10-29') // from the injected now, not the model's today
  assert.equal(sent.dateSource, 'next-weekday')
  // What the model sent is still logged as-is (it is what it asked for).
  assert.equal(result.toolCalls[0].input.today, '2026-11-19')

  // And a different injected clock moves the answer: Saturday 2026-10-31.
  const later = fakeAnthropic([
    toolUseFor('find_trains', { from: 'NYP', to: 'BOS', weekday: 'thursday', today: '2026-10-01' }),
    textResponse('ok'),
  ])
  const r2 = await askQuestion({ anthropic: later, sql, question: 'q', now: new Date('2026-10-31T16:00:00Z') })
  assert.equal(r2.toolCalls[0].result.date, '2026-11-05')
})

test('the prompt tells the model to state the date it used for a weekday-only question', () => {
  assert.match(SYSTEM_PROMPT, /gave a weekday but no date, state the date you used/)
})
