/**
 * hardening-p0-7-schema.test.ts — regression lock for ledger F16 (P0-7).
 *
 * Runtime schema validation on model-output parses: malformed output produces
 * STRUCTURED TELEMETRY (a 'malformed-model-output' review item) plus exactly ONE
 * targeted retry — never a silent null vote. Shape guards drop (and count)
 * malformed entities/fields/mapping items instead of letting NaN/undefined flow.
 *
 * Fails on the pre-fix sha (2b1f893): parseWithRetry/sanitizeEntities did not
 * exist; parseExtraction passed arbitrary entity shapes through; parseMappings
 * emitted colIndex NaN entries.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseWithRetry, sanitizeEntities } = require('../../server/lib/import-brain/constants.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseExtraction } = require('../../server/lib/import-brain/stage4-extract.js')

describe('P0-7: runtime schema validation on stage parses (ledger F16)', () => {
  it('malformed output → telemetry + one targeted retry that recovers', async () => {
    const review: unknown[] = []
    let calls = 0
    const parsed = await parseWithRetry({
      call: async () => { calls++; return { raw: calls === 1 ? 'not json at all' : '{"entities":[{"sourceRowIndex":0,"fields":[{"fieldName":"refId","value":"GL.COV.001"}]}]}' } },
      parse: parseExtraction, review, stage: 'stage4', sheetName: 'FW', what: 'BULK extraction rows 0-19',
    })
    expect(calls).toBe(2)
    expect(parsed?.entities).toHaveLength(1)
    expect(review.some((r: unknown) => (r as { kind: string }).kind === 'malformed-model-output')).toBe(true)
  })

  it('persistent malformed output → two telemetry entries, null result (visible, not silent)', async () => {
    const review: unknown[] = []
    let calls = 0
    const parsed = await parseWithRetry({
      call: async () => { calls++; return { raw: '{"wrong":"shape"}' } },
      parse: parseExtraction, review, stage: 'stage4', sheetName: 'FW', what: 'BULK extraction rows 0-19',
    })
    expect(calls).toBe(2) // exactly one retry
    expect(parsed).toBe(null)
    expect(review.filter((r: unknown) => (r as { kind: string }).kind === 'malformed-model-output')).toHaveLength(2)
  })

  it('transport failures (empty raw) are NOT retried here (ai-call already retried)', async () => {
    let calls = 0
    const parsed = await parseWithRetry({
      call: async () => { calls++; return { raw: '' } },
      parse: parseExtraction, review: [], stage: 'stage4', sheetName: 'FW', what: 'x',
    })
    expect(calls).toBe(1)
    expect(parsed).toBe(null)
  })

  it('sanitizeEntities drops malformed entities and fields, counting them', () => {
    const { entities, dropped } = sanitizeEntities([
      { sourceRowIndex: 0, fields: [{ fieldName: 'refId', value: 'GL.COV.001' }] },
      { sourceRowIndex: 'not-a-number', fields: [] },                       // dropped entity
      { sourceRowIndex: 2, fields: [{ fieldName: 123, value: 'x' }, { fieldName: 'name', value: 'ok' }] }, // dropped field
      null,                                                                  // dropped entity
    ])
    expect(entities).toHaveLength(2)
    expect(entities[1].fields).toHaveLength(1)
    expect(dropped).toBe(3)
  })

  it('parseExtraction surfaces the dropped count and rejects wholly-malformed payloads', () => {
    const ok = parseExtraction('{"entities":[{"sourceRowIndex":1,"fields":[{"fieldName":"name","value":"A"}]},{"sourceRowIndex":"bad"}]}')
    expect(ok?.entities).toHaveLength(1)
    expect(ok?.dropped).toBe(1)
    // Every entity malformed → parse failure (earns the caller's telemetry+retry).
    expect(parseExtraction('{"entities":[{"sourceRowIndex":"bad"}]}')).toBe(null)
    expect(parseExtraction('{"entities":"nope"}')).toBe(null)
  })
})
