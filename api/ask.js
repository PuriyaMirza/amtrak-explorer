import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { searchTrains } from '../search.js'

const SUPABASE_URL = 'https://qfbruzslfbfpaylwbbtq.supabase.co'
const SUPABASE_KEY = 'sb_publishable_X8190zU7ojvk5T2dPe6eWQ_rKyceVH4'

const MODEL = 'claude-sonnet-5-5'
const RESULT_LIMIT = 10

const SEARCH_TOOL = {
  name: 'search_trains',
  description:
    'Search for Amtrak stations and routes by name. Matches partial, ' +
    'case-insensitive text against station names (e.g. "Chicago Union Station") ' +
    'and route names (e.g. "Acela", "Lake Shore Limited"). Use this whenever the ' +
    'user mentions a specific city, station, or train/route name.',
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
  'say so if asked, rather than guessing. Keep answers to a few sentences.'

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    const messages = [{ role: 'user', content: question }]
    const toolCalls = []

    // Round 1: ask Claude. It either answers, or asks to call the tool.
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [SEARCH_TOOL],
      messages,
    })

    // Round 2: if it asked for the tool, WE run the real query, then hand
    // the real rows back so it can only describe what actually exists.
    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((c) => c.type === 'tool_use')
      messages.push({ role: 'assistant', content: response.content })

      const toolResults = []
      for (const toolUse of toolUses) {
        let result
        try {
          const data = await searchTrains(supabase, {
            query: toolUse.input.query,
            limit: RESULT_LIMIT,
          })
          const routeNames = [...new Set(data.routes.map((r) => r.route_long_name))]
          result = {
            stations: data.stations.map((s) => ({
              id: s.stop_id,
              name: s.stop_name,
              timezone: s.stop_timezone,
            })),
            routes: routeNames,
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

      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [SEARCH_TOOL],
        messages,
      })
    }

    const answer = response.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim()

    return res.status(200).json({ answer, toolCalls })
  } catch (err) {
    console.error('ask handler failed:', err)
    return res.status(500).json({ error: err.message })
  }
}
