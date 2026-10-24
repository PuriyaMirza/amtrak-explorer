// Logging for the ask box: one `events` row (event_type = 'ask') per question.
//
// Why this is its own module and not part of askQuestion(): askQuestion stays
// pure (no database writes), so the eval runner can call it 40 times without
// filling the usage log with fake traffic. Only the live endpoint (api/ask.js)
// calls logAsk.
//
// Ask rows are written by the server only. api/log.js does not accept
// event_type 'ask' from the browser, so nobody can forge one.
import { insertEvent } from './event-store.js'

// The table requires device_id and session_id (NOT NULL). The browser sends
// them, but a caller that doesn't (curl, the remote eval runner) still gets
// logged, under this placeholder, rather than failing the insert.
export const UNKNOWN_ID = 'unknown'

// Logging must never make an answer noticeably slower. If the insert hasn't
// finished in this long, we stop waiting for it and send the answer anyway.
export const LOG_TIMEOUT_MS = 2000

// Turns the pieces of one ask into the `metadata` JSON stored on the row.
//
//   result  what askQuestion() returned; undefined if it threw
//   error   the message of the error it threw; undefined on success
//
// Tool calls are stored as { name, input, row_count } or { name, input, error }.
// `input` is the full argument object the model sent (search_trains: { query };
// find_trains: { from, to, date, ... }). We keep only the count of rows, never
// the rows themselves: they're large and the answer already summarises them.
// askQuestion records `input` and `rowCount` per call, so this stays generic:
// adding a tool doesn't mean touching the logger.
export function buildAskMetadata({ result, error, latencyMs }) {
  const metadata = { latency_ms: latencyMs }
  if (result) {
    metadata.answer = result.answer
    metadata.tool_calls = result.toolCalls.map((c) => {
      const call = { name: c.name, input: c.input ?? { query: c.query } }
      if (c.error) call.error = c.error
      else call.row_count = c.rowCount ?? 0
      return call
    })
    metadata.rounds = result.rounds
    metadata.input_tokens = result.usage?.input_tokens ?? 0
    metadata.output_tokens = result.usage?.output_tokens ?? 0
    metadata.model = result.model
    metadata.prompt_version = result.promptVersion
    // The stop_id actually used (after validation), not what the browser sent.
    if (result.homeStation) metadata.home_station = result.homeStation
  }
  if (error) metadata.error = error
  return metadata
}

// Writes the ask row. Never throws and never waits longer than timeoutMs:
// a failure is printed to the server log and otherwise ignored.
export async function logAsk(
  sql,
  { question, deviceId, sessionId, result, error, latencyMs },
  { timeoutMs = LOG_TIMEOUT_MS } = {},
) {
  let timer
  try {
    const insert = insertEvent(sql, {
      event_type: 'ask',
      device_id: deviceId || UNKNOWN_ID,
      session_id: sessionId || UNKNOWN_ID,
      query_text: question,
      metadata: buildAskMetadata({ result, error, latencyMs }),
    })
    // Race the insert against a timer. If the timer wins we give up waiting;
    // the insert may still finish in the background, so swallow its failure too.
    insert.catch(() => {})
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
    })
    await Promise.race([insert, timeout])
  } catch (err) {
    console.error('ask log failed:', err)
  } finally {
    clearTimeout(timer)
  }
}
