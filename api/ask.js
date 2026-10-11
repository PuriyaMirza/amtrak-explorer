import Anthropic from '@anthropic-ai/sdk'
import { neon } from '@neondatabase/serverless'
import { searchTrains } from '../search.js'

const MODEL = 'claude-sonnet-5-5'
const RESULT_LIMIT = 10
const MAX_ROUNDS = 4

const SEARCH_TOOL = {
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

const SYSTEM_PROMPT =
  'You help people explore Amtrak stations and routes. ' +
  'You can ONLY describe stations and routes returned by the search_trains tool. ' +
  'Never invent a station, route, schedule, duration, or price. ' +
  'If the tool returns nothing relevant, say so plainly. ' +
  'You cannot filter by trip duration, departure time, or scenery — ' +
  'say so if asked, rather than guessing. Keep answers to a few sentences. '
  + 'Reply in plain text only — no markdown, no asterisks, no bullet points.'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' })
  }

  const question = req.body?.question
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing "question" in request body' })
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const sql = neon(process.env.DATABASE_URL)

    const messages = [{ role: 'user', content: question }]
    const toolCalls = []

    // Claude can ask for the tool more than once per question (e.g. a
    // two-place question like "New York to Boston" often needs a follow-up
    // search after seeing the first results). Loop until it stops asking
    // for the tool, up to MAX_ROUNDS so a confused model can't run forever.
    let response
    for (let round = 0; round < MAX_ROUNDS; round++) {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [SEARCH_TOOL],
        messages,
      })

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
          toolCalls.push({ query: toolUse.input.query, result })
        } catch (err) {
          result = { error: err.message }
          toolCalls.push({ query: toolUse.input.query, error: err.message })
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

    return res.status(200).json({
      answer: answer || "I wasn't able to put together an answer — try rephrasing the question.",
      toolCalls,
    })
  } catch (err) {
    console.error('ask handler failed:', err)
    return res.status(500).json({ error: err.message })
  }
}
