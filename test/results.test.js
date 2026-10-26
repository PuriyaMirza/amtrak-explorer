import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatResultsRow, appendResultsRow, RESULTS_HEADER } from '../eval/results.js'

const outcome = (id, category, pass) => ({ caseDef: { id, category }, pass, results: [] })

const base = {
  date: new Date('2026-10-23T20:15:42Z'),
  mode: 'local',
  model: 'claude-sonnet-5-5',
  promptVersion: 'v1',
  // Pinned, not SCORER_VERSION: these tests check the row FORMAT, so they must
  // not break every time the scorer is bumped.
  scorerVersion: 2,
  outcomes: [
    outcome('a', 'easy', true),
    outcome('b', 'easy', true),
    outcome('c', 'adversarial', false),
    outcome('d', 'schedule', false),
  ],
  taxonomy: { 'wrong-tool': 1, 'wrong-refusal': 1 },
}

test('formatResultsRow: every column in order', () => {
  assert.equal(
    formatResultsRow(base),
    '| 2026-10-23T20:15Z | local | claude-sonnet-5-5 | v1 (scorer 2) | 2/4 (50%) | ' +
      'easy 2/2, adversarial 0/1, schedule 0/1 | wrong-tool 1, wrong-refusal 1 | c, d |',
  )
})

test('formatResultsRow: records the scorer version next to the prompt version', () => {
  assert.match(formatResultsRow(base), /\| v1 \(scorer 2\) \|/)
  assert.match(formatResultsRow({ ...base, scorerVersion: 7 }), /\| v1 \(scorer 7\) \|/)
})

test('RESULTS_HEADER has a Scorer changes note naming the motivating cases', () => {
  assert.match(RESULTS_HEADER, /Scorer changes/)
  assert.match(RESULTS_HEADER, /anchorage-refusal/)
  assert.match(RESULTS_HEADER, /weekend-generic-philadelphia/)
})

test('formatResultsRow: a perfect run has "-" for failure types and failed cases', () => {
  const row = formatResultsRow({
    ...base,
    outcomes: [outcome('a', 'easy', true)],
    taxonomy: {},
  })
  assert.equal(
    row,
    '| 2026-10-23T20:15Z | local | claude-sonnet-5-5 | v1 (scorer 2) | 1/1 (100%) | easy 1/1 | - | - |',
  )
})

test('formatResultsRow: the row has as many cells as the header has columns', () => {
  const headerCols = RESULTS_HEADER.trim().split('\n').at(-2).split('|').length
  const rowCols = formatResultsRow(base).split('|').length
  assert.equal(rowCols, headerCols)
})

test('formatResultsRow: pipes and newlines in values cannot break the table', () => {
  const row = formatResultsRow({ ...base, model: 'a|b', promptVersion: 'v\n2' })
  assert.equal(row.split('|').length, formatResultsRow(base).split('|').length)
  assert.equal(row.includes('\n'), false)
})

test('formatResultsRow: handles an empty run without dividing by zero', () => {
  const row = formatResultsRow({ ...base, outcomes: [], taxonomy: {} })
  assert.match(row, /0\/0 \(0%\)/)
})

test('RESULTS_HEADER explains the columns and names every failure type', () => {
  assert.match(RESULTS_HEADER, /\| Date \(UTC\) \| Mode \| Model \| Prompt \| Pass \|/)
  for (const type of ['missing-entity', 'wrong-time', 'hallucinated-entity', 'missed-refusal',
    'wrong-refusal', 'no-grounding', 'wrong-tool', 'request-error']) {
    assert.ok(RESULTS_HEADER.includes(`\`${type}\``), `header is missing ${type}`)
  }
})

test('appendResultsRow: creates the file with the header, then appends rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'results-test-'))
  try {
    const path = join(dir, 'RESULTS.md')
    appendResultsRow(path, '| row one |')
    appendResultsRow(path, '| row two |')
    const text = readFileSync(path, 'utf8')
    assert.ok(text.startsWith(RESULTS_HEADER))
    assert.ok(text.endsWith('| row one |\n| row two |\n'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('appendResultsRow: repairs a file that lost its trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'results-test-'))
  try {
    const path = join(dir, 'RESULTS.md')
    writeFileSync(path, 'header\n| old |')
    appendResultsRow(path, '| new |')
    assert.equal(readFileSync(path, 'utf8'), 'header\n| old |\n| new |\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
