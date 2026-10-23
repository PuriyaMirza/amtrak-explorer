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

// Pinned on purpose: the app and the evals must use the same model, otherwise
// an eval pass rate says nothing about what users actually get.
export const MODEL = 'claude-sonnet-5-5'

// Bump this whenever SYSTEM_PROMPT or the tools change in a way that could
// move the eval pass rate. It is written into eval/RESULTS.md next to every
// run, so a change in pass rate can be tied to a change in the prompt.
export const PROMPT_VERSION = 'v1'

export const RESULT_LIMIT = 10
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

export const SYSTEM_PROMPT =
  'You help people explore Amtrak stations and routes. ' +
  'You can ONLY describe stations and routes returned by the search_trains tool. ' +
  'Never invent a station, route, schedule, duration, or price. ' +
  'If the tool returns nothing relevant, say so plainly. ' +
  'You cannot filter by trip duration, departure time, or scenery — ' +
  'say so if asked, rather than guessing. Keep answers to a few sentences. '
  + 'Reply in plain text only — no markdown, no asterisks, no bullet points.'

const FALLBACK_ANSWER =
  "I wasn't able to put together an answer — try rephrasing the question."

// Runs one question through the model, running real queries for any tool
// calls, and returns everything a caller (endpoint, eval, logger) could want.
//
//   anthropic  an Anthropic SDK client (or a fake with the same
//              `messages.create` shape)
//   sql        a Neon `sql` tagged-template function (or a fake)
//   question   the user's question, already validated by the caller
export async function askQuestion({ anthropic, sql, question }) {
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
      system: SYSTEM_PROMPT,
      tools: [SEARCH_TOOL],
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
      let result
      try {
        const data = await searchTrains(sql, {
          query: toolUse.input.query,
          limit: RESULT_LIMIT,
        })
        result = {
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
        // `name` is which tool ran. Only one tool exists today, but the eval
        // check `toolCalled` needs it once there are several.
        toolCalls.push({ name: toolUse.name, query: toolUse.input.query, result })
      } catch (err) {
        result = { error: err.message }
        toolCalls.push({ name: toolUse.name, query: toolUse.input.query, error: err.message })
      }

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
