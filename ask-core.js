// The ask loop, extracted from api/ask.js so that three different callers
// share ONE implementation:
//
//   - api/ask.js   (the live endpoint)
//   - eval/run.js  (the eval runner, "local mode": no HTTP, no SSO)
//   - test/        (unit tests, with fake clients and no network)
//
// Like search.js, this module takes its clients as parameters instead of
// importing them (dependency injection). That is what lets a test hand it a
// fake Anthropic client and a fake `sql` function.
import { searchTrains } from './search.js'
import { findDirectTrains, todayInNewYork, WEEKDAYS } from './schedule.js'

// Pinned on purpose: the app and the evals must use the same model, otherwise
// an eval pass rate says nothing about what users actually get.
export const MODEL = 'claude-sonnet-5-5'

// Bump this whenever SYSTEM_PROMPT or the tools change in a way that could
// move the eval pass rate. It is written into eval/RESULTS.md next to every
// run, so a change in pass rate can be tied to a change in the prompt.
export const PROMPT_VERSION = 'v2'

export const RESULT_LIMIT = 10
// Most trains one find_trains result may carry back to the model. A busy pair
// like New York - Boston has 30+ trains a day; every row is tokens we pay for
// twice (this round and every later round). The result's `summary` still
// covers ALL trains (earliest, latest, fastest), so "last train" and
// "fastest" stay correct when the list is cut short.
export const TRAIN_RESULT_LIMIT = 12
export const TRAIN_RESULT_MAX = 20
export const MAX_ROUNDS = 4

export const SEARCH_TOOL = {
  name: 'search_trains',
  description:
    'Search for Amtrak stations and routes by name. Matches partial, ' +
    'case-insensitive text against station names (e.g. "Chicago Union Station") ' +
    'and route names (e.g. "Acela", "Lake Shore Limited"). Each matched station ' +
    'includes a "routes" list of every route that actually serves it, and each ' +
    'matched route includes a "stops" list of every station it actually serves. ' +
    'Use this whenever the user mentions a specific city, station, or ' +
    'train/route name, including questions like "what trains go through X" or ' +
    '"what stations does Y serve".',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The station or route name (or part of one) to search for, ' +
          'e.g. "chicago", "acela", "lake shore".',
      },
    },
    required: ['query'],
  },
}

export const FIND_TRAINS_TOOL = {
  name: 'find_trains',
  description:
    'Look up DIRECT Amtrak trains (one train, no connections) between two stations, ' +
    'with real departure and arrival times, durations, and train numbers, for one ' +
    'specific day. Use it for any question about times, schedules, how long a trip ' +
    'takes, the first/last/fastest train, what runs on a given weekday or date, or ' +
    'whether a particular train can be used between two stations. Give a date ' +
    '(YYYY-MM-DD) when the person names or implies one; otherwise give a weekday ' +
    '(meaning the next such day) or neither (meaning today). Days are physical days: ' +
    'a train that leaves in the early hours of Thursday counts as a Thursday train. ' +
    'The result has "trains" (sorted by departure, possibly cut short), a "summary" ' +
    'covering ALL trains (earliest, latest, fastest, count), "unavailable" (trains ' +
    'that stop at both places but cannot be boarded/exited there), and "notes" that ' +
    'you must respect. Stations may be ids (NYP, BOS, PHL, WAS, CHI, LAX) or names; ' +
    'if a name is ambiguous the result lists candidates, so retry with a stop_id. ' +
    'arriveDayOffset 1 means the train arrives the next day.',
  input_schema: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Departure station: a stop_id like "NYP" or a name like "New York", "Philadelphia".',
      },
      to: {
        type: 'string',
        description: 'Arrival station: a stop_id like "BOS" or a name.',
      },
      date: {
        type: 'string',
        description:
          'The day the traveler departs, YYYY-MM-DD. Work out relative dates ' +
          '("next Thursday", "this Saturday") from today\'s date in the system prompt.',
      },
      weekday: {
        type: 'string',
        enum: WEEKDAYS,
        description: 'Use only when the person gives a weekday but no date: means the next such day.',
      },
      departAfter: {
        type: 'string',
        description: 'Only trains leaving at or after this 24-hour time, e.g. "18:00".',
      },
      departBefore: {
        type: 'string',
        description: 'Only trains leaving at or before this 24-hour time, e.g. "09:30".',
      },
      route: {
        type: 'string',
        description: 'Only trains whose route name contains this text, e.g. "Acela", "Cardinal", "Lake Shore".',
      },
      limit: {
        type: 'integer',
        description: `How many trains to list (default ${TRAIN_RESULT_LIMIT}, max ${TRAIN_RESULT_MAX}).`,
      },
    },
    required: ['from', 'to'],
  },
}

export const TOOLS = [SEARCH_TOOL, FIND_TRAINS_TOOL]

// The instructions that never change. The date is added per request, see
// systemPromptFor() below. (Two phrases here, "You help people explore Amtrak"
// and "Never invent a station", are also what the prompt-injection eval case
// looks for in an answer; if you reword them, update eval/cases.js.)
export const SYSTEM_PROMPT =
  'You help people explore Amtrak stations, routes and schedules. ' +
  'You have two tools: search_trains (stations and routes by name) and ' +
  'find_trains (direct trains between two stations, with times and durations). ' +
  'You can ONLY state stations, routes, train numbers, times and durations that a tool returned. ' +
  'Never invent a station, route, schedule, duration, or price. ' +
  'If a tool returns nothing relevant, say so plainly. ' +
  'You have no fares, live delay information, seat availability or scenery data, and you cannot book ' +
  'tickets; say so if asked, rather than guessing. ' +
  'find_trains covers direct trains only, not connections. ' +
  'Times from find_trains are US Eastern time at every station, as the schedule data gives them, ' +
  'so say "Eastern time" when you quote times, and mention it especially for stations in other time zones. ' +
  'If a train arrives the next day (arriveDayOffset 1), say so. ' +
  'Whenever you give a schedule answer (times, durations, first or last train, a weekday or date), ' +
  'add one short sentence that holiday schedules are not modelled and the person should confirm on amtrak.com. ' +
  'If a station name is ambiguous, say which stations matched and which one you used or ask. ' +
  'Keep answers to a few sentences. ' +
  'Reply in plain text only — no markdown, no asterisks, no bullet points.'

// SYSTEM_PROMPT plus today's date. The model has no clock, and "next
// Thursday" or "this Saturday" can't be turned into a date without one. It is
// computed per request (not at import time, which on a warm serverless
// instance could be days old) and in New York time, matching the schedule data.
export function systemPromptFor(now = new Date()) {
  const iso = todayInNewYork(now)
  const weekday = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]
  return `${SYSTEM_PROMPT} Today is ${weekday} ${iso} (US Eastern time).`
}

const FALLBACK_ANSWER =
  "I wasn't able to put together an answer — try rephrasing the question."

// Runs one tool call for real and returns what to show the model, plus how
// many rows that was. Throws on bad input or a database error; the caller
// reports the message back to the model so it can correct itself. The model
// never writes SQL: every query is a fixed one in search.js / schedule.js and
// the model only supplies values for its parameters.
async function runTool(name, input, sql) {
  if (name === 'search_trains') {
    const data = await searchTrains(sql, { query: input.query, limit: RESULT_LIMIT })
    const result = {
      stations: data.stations.map((s) => ({
        id: s.stop_id,
        name: s.stop_name,
        timezone: s.stop_timezone,
        routes: s.routes,
      })),
      routes: data.routes.map((r) => ({
        name: r.route_long_name,
        stops: r.stops,
      })),
    }
    return { result, rowCount: result.stations.length + result.routes.length }
  }

  if (name === 'find_trains') {
    // Row cap: default 12, never more than 20, whatever the model asks for.
    const asked = input.limit == null ? TRAIN_RESULT_LIMIT : Number(input.limit)
    const limit = Number.isFinite(asked) ? Math.min(asked, TRAIN_RESULT_MAX) : asked
    const result = await findDirectTrains(sql, { ...input, limit })
    return { result, rowCount: result.trains.length }
  }

  throw new Error(`unknown tool: ${name}`)
}

// Runs one question through the model, running real queries for any tool
// calls, and returns everything a caller (endpoint, eval, logger) could want.
//
//   anthropic  an Anthropic SDK client (or a fake with the same
//              `messages.create` shape)
//   sql        a Neon `sql` tagged-template function (or a fake)
//   question   the user's question, already validated by the caller
//   now        the current time; only tests pass this (it fixes "today")
export async function askQuestion({ anthropic, sql, question, now = new Date() }) {
  const messages = [{ role: 'user', content: question }]
  const toolCalls = []
  const usage = { input_tokens: 0, output_tokens: 0 }

  // Claude can ask for the tool more than once per question (e.g. a
  // two-place question like "New York to Boston" often needs a follow-up
  // search after seeing the first results). Loop until it stops asking
  // for the tool, up to MAX_ROUNDS so a confused model can't run forever.
  let response
  let rounds = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPromptFor(now),
      tools: TOOLS,
      messages,
    })
    rounds++
    // Token counts are summed across rounds: every round re-sends the whole
    // conversation, so the total is what the question actually cost.
    usage.input_tokens += response.usage?.input_tokens ?? 0
    usage.output_tokens += response.usage?.output_tokens ?? 0

    if (response.stop_reason !== 'tool_use') break

    // WE run the real query, then hand the real rows back so Claude can
    // only describe what actually exists.
    const toolUses = response.content.filter((c) => c.type === 'tool_use')
    messages.push({ role: 'assistant', content: response.content })

    const toolResults = []
    for (const toolUse of toolUses) {
      // `input` is exactly what the model asked for (the ask logger stores
      // it); `query` is kept for search_trains only because the eval check
      // toolQueriesInclude reads it.
      const input = toolUse.input ?? {}
      const record = { name: toolUse.name, input }
      if (toolUse.name === 'search_trains') record.query = input.query
      let result
      try {
        const run = await runTool(toolUse.name, input, sql)
        result = run.result
        record.result = result
        // How many rows the model was shown; logged instead of the rows.
        record.rowCount = run.rowCount
      } catch (err) {
        result = { error: err.message }
        record.error = err.message
      }
      toolCalls.push(record)

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  const answer = response.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim()

  return {
    answer: answer || FALLBACK_ANSWER,
    toolCalls,
    rounds,
    usage,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
  }
}
