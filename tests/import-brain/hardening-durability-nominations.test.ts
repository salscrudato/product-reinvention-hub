/**
 * hardening-durability-nominations.test.ts — COMMIT 4 locks.
 *
 *  (1) RESUME trusted the run id alone. A run id is a client-minted string, not a
 *      statement about the input: resuming after swapping the file replayed
 *      stage-1..3 artifacts — classifications, header locks, column maps — built
 *      from the OLD grids against the NEW ones, and nothing detected it. Every
 *      checkpoint is now stamped with a content hash of the upload, and a resume
 *      whose artifacts do not all match is REFUSED.
 *  (2) A REDEPLOY killed a ~$70 / ~110-minute run with no warning. The tracer now
 *      answers "what is in flight?" synchronously, /api/health carries it, and a
 *      shutdown signal stops new imports and names anything the restart destroys.
 *  (3) SWEEPER NOMINATIONS were kept out of the write by a CLIENT-SIDE filter —
 *      a UI convention, not an invariant. Enforced at the persist boundary now:
 *      a nomination without an explicit confirmation flag is refused.
 *  (4) The stage-7 identity join picked the FIRST name match by queue position.
 *      Duplicate sub-coverage names are real in these books, and one wrong
 *      adoption propagates through refIdRemap into parentIds, terms, rules and
 *      step sources. Ambiguity is refused and flagged instead.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

process.env.AUTH_JWT_SECRET ??= 'test-secret-durability-nominations-min-32ch'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='

/* eslint-disable @typescript-eslint/no-require-imports */
const { contentHashOfDocuments, checkpointsMatchSource, mintRunId } = require('../../server/lib/ai/unified-import.js')
const drain = require('../../server/lib/ai/drain.js')
const runTrace = require('../../server/lib/ai/run-trace.js')
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')

// ─── (1) the content-hash resume guard ─────────────────────────────────────────

const doc = (name: string, body: string) => ({ name, base64: Buffer.from(body).toString('base64') })

describe('(1) a resume is refused when the file changed', () => {
  it('the hash follows CONTENT and NAME, and ignores upload order', () => {
    const a = contentHashOfDocuments([doc('core.xlsx', 'AAAA')])
    expect(contentHashOfDocuments([doc('core.xlsx', 'AAAA')])).toBe(a)   // stable
    expect(contentHashOfDocuments([doc('core.xlsx', 'BBBB')])).not.toBe(a)  // swapped content
    expect(contentHashOfDocuments([doc('eplus.xlsx', 'AAAA')])).not.toBe(a) // swapped name
    const two = contentHashOfDocuments([doc('a.xlsx', 'A'), doc('b.xlsx', 'B')])
    expect(contentHashOfDocuments([doc('b.xlsx', 'B'), doc('a.xlsx', 'A')])).toBe(two)
    expect(contentHashOfDocuments([])).toBeNull()
  })

  it('THE SWAPPED FILE: matching checkpoints replay, mismatched ones are refused', () => {
    const original = contentHashOfDocuments([doc('core.xlsx', 'the original workbook bytes')])
    const swapped  = contentHashOfDocuments([doc('core.xlsx', 'a DIFFERENT workbook, same name')])
    const checkpoints = [
      { classifiedSheets: [], sourceHash: original },
      { headerLocks: [], sourceHash: original },
      { columnMaps: [], sourceHash: original },
    ]
    expect(checkpointsMatchSource(checkpoints, original).ok).toBe(true)

    const refused = checkpointsMatchSource(checkpoints, swapped)
    expect(refused.ok).toBe(false)
    expect(refused.reason).toContain('built from different bytes')
    expect(refused.reason).toContain('the file changed since that run')
  })

  it('ONE stale checkpoint out of many refuses the whole resume', () => {
    const h = contentHashOfDocuments([doc('a.xlsx', 'x')])
    const other = contentHashOfDocuments([doc('a.xlsx', 'y')])
    const mixed = [{ sourceHash: h }, { sourceHash: h }, { sourceHash: other }]
    expect(checkpointsMatchSource(mixed, h).ok).toBe(false)
  })

  it('an UNSTAMPED checkpoint is refused — unprovable is not the same as matching', () => {
    const h = contentHashOfDocuments([doc('a.xlsx', 'x')])
    const v = checkpointsMatchSource([{ classifiedSheets: [] }], h)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('predate the content-hash guard')
    // …and an upload with no hash at all can never justify a replay.
    expect(checkpointsMatchSource([{ sourceHash: h }], null).ok).toBe(false)
    // No checkpoints is not a mismatch — there is simply nothing to replay.
    expect(checkpointsMatchSource([], null).ok).toBe(true)
  })

  it('a server-minted run id is always blob-path safe', () => {
    const ids = new Set(Array.from({ length: 50 }, () => mintRunId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^run-[a-z0-9]+-[a-f0-9]{12}$/)
  })
})

// ─── (2) the deploy drain guard ────────────────────────────────────────────────

describe('(2) a redeploy no longer destroys an import in silence', () => {
  beforeEach(() => { runTrace.__clearForTests(); drain.__resetForTests() })

  it('the tracer answers "what is in flight?" synchronously (usable from SIGTERM)', () => {
    expect(drain.drainStatus().activeImports).toBe(0)
    const t = runTrace.createRunTrace({ runId: 'run-in-flight-1', tenantId: 'acme' })
    t.observe({ t: 'json', key: 'brain:input', value: { sourceName: 'core.xlsx' } })
    t.observe({ t: 'json', key: 'brain:spend', value: { spendUsd: 41.5, calls: 900 } })

    const s = drain.drainStatus()
    expect(s.activeImports).toBe(1)
    expect(s.atRiskSpendUsd).toBe(41.5)          // what the restart would throw away
    expect(s.draining).toBe(false)
    expect(drain.activeImports()[0]).toMatchObject({ runId: 'run-in-flight-1', tenantId: 'acme', sourceName: 'core.xlsx' })

    t.observe({ t: 'json', key: 'bundle', value: { plan: {} } })
    t.observe({ t: 'done' })
    expect(drain.drainStatus().activeImports).toBe(0)   // a finished run is not at risk
  })

  it('draining waits for an in-flight run, then reports it clean', async () => {
    const t = runTrace.createRunTrace({ runId: 'run-finishes-1', tenantId: 'acme' })
    const logs: string[] = []
    let ticks = 0
    const sleep = async () => { if (++ticks === 2) { t.observe({ t: 'json', key: 'bundle', value: {} }); t.observe({ t: 'done' }) } }
    const r = await drain.beginDrain({ graceMs: 10_000, pollMs: 1, log: (m: string) => logs.push(m), sleep })
    expect(r).toMatchObject({ drained: true, remaining: 0 })
    expect(drain.isDraining()).toBe(true)              // new imports refused from the signal on
    expect(logs.join('\n')).toContain('refusing new imports')
  })

  it('an ABANDONED run is named loudly — a destroyed run is never a silent one', async () => {
    const t = runTrace.createRunTrace({ runId: 'run-doomed-1', tenantId: 'acme' })
    t.observe({ t: 'json', key: 'brain:input', value: { sourceName: 'Product Specifications _Core.xlsx' } })
    t.observe({ t: 'json', key: 'brain:spend', value: { spendUsd: 68.2, calls: 1400 } })
    const logs: string[] = []
    const r = await drain.beginDrain({ graceMs: 3, pollMs: 1, log: (m: string) => logs.push(m), sleep: async () => {} })
    expect(r.drained).toBe(false)
    expect(r.remaining).toBe(1)
    const shout = logs.join('\n')
    expect(shout).toContain('STILL RUNNING')
    expect(shout).toContain('run-doomed-1')
    expect(shout).toContain('Product Specifications _Core.xlsx')
    expect(shout).toContain('$68.2')
  })

  it('/api/health carries the drain signal (counts only — safe unauthenticated)', () => {
    const s = drain.drainStatus()
    expect(Object.keys(s).sort()).toEqual(['activeImports', 'atRiskSpendUsd', 'drainStartedAt', 'draining', 'oldestImportMs'])
  })
})

// ─── (3) the nomination persist boundary ───────────────────────────────────────

describe('(3) a sweeper nomination cannot be written without saying so', () => {
  const { app } = require('../../server/server.js') as { app: import('express').Express }
  const { sign } = require('../../server/lib/auth.js') as { sign: (p: Record<string, unknown>) => string }
  const editor = sign({ sub: 'nom', email: 'n@t', name: 'Nom Tester', role: 'EDITOR', tenantId: 'testco' })
  const token = () => editor

  const nomination = {
    op: 'create', path: 'products/P1/coverages/sweeper-FW-C7', entityType: 'coverage', productId: 'P1',
    actor: { uid: 'nom-test', name: 'Nom Tester' },
    data: { name: 'Maybe A Coverage', citation: 'FW!C7', sweeperFact: true, needsReview: true, confidence: 0.5 },
  }

  it('/mutate 422s a nomination with no confirmation flag', async () => {
    const r = await request(app).post('/api/db/mutate')
      .set('Authorization', `Bearer ${token()}`)
      .send({ payload: nomination })
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('nomination_unconfirmed')
    expect(r.body.detail).toContain('confirmNomination')
  })

  it('/mutateBatch 422s too — one nomination refuses the batch', async () => {
    const r = await request(app).post('/api/db/mutateBatch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ payloads: [{ ...nomination, data: { ...nomination.data, sweeperFact: false } }, nomination] })
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('nomination_unconfirmed')
  })

  it('an ordinary extracted entity is untouched by the guard', async () => {
    const r = await request(app).post('/api/db/mutate')
      .set('Authorization', `Bearer ${token()}`)
      .send({ payload: { ...nomination, data: { name: 'A Real Coverage', citation: 'FW!C7' } } })
    expect(r.status).not.toBe(422)     // fails later on infra (no Cosmos here), never on this gate
  })

  it('WITH the confirmation flag the guard steps aside (an explicit reviewer act)', async () => {
    const r = await request(app).post('/api/db/mutate')
      .set('Authorization', `Bearer ${token()}`)
      .send({ payload: { ...nomination, confirmNomination: true } })
    expect(r.status).not.toBe(422)
  })
})

// ─── (3b) nominations render in their own section ──────────────────────────────

describe('(3b) the plan marks nominations so they leave the coverage group', () => {
  it('stage 7 tags the review item; extracted entities are unmarked', () => {
    const entity = {
      kind: 'coverage', sourceSheet: 'FW', sourceRowIndex: 2, occurrence: 0, overallConfidence: 0.9,
      reviewFlag: false, needsRefIdSynthesis: false,
      fields: [
        { fieldName: 'refId', value: 'GL.COV.001', confidence: 0.9, citation: { sheet: 'FW', cell: 'A2', verbatim: 'GL.COV.001' } },
        { fieldName: 'name', value: 'Premises', confidence: 0.9, citation: { sheet: 'FW', cell: 'B2', verbatim: 'Premises' } },
      ],
    }
    const bundle = buildImportPlan({
      entities: [entity],
      sweeper: { facts: [{ sheet: 'FW', ref: 'FW!C7', entityKind: 'coverage', name: 'Maybe A Coverage', verbatim: 'Maybe A Coverage' }] },
    }, {})
    const items = bundle.review.coverages.items as { label: string; nomination?: boolean; sheet?: string }[]
    const nom = items.find(i => i.label === 'Maybe A Coverage')
    const real = items.find(i => i.label === 'Premises')
    expect(nom!.nomination).toBe(true)
    expect(nom!.sheet).toBe('FW')
    expect(real!.nomination).toBeUndefined()
  })
})

// ─── (4) the ambiguous identity join ───────────────────────────────────────────

describe('(4) an ambiguous name match refuses to graft identity', () => {
  const brainCoverage = (name: string, row: number) => ({
    kind: 'coverage', sourceSheet: 'FW', sourceRowIndex: row, occurrence: 0, overallConfidence: 0.9,
    reviewFlag: false, needsRefIdSynthesis: false,
    fields: [{ fieldName: 'name', value: name, confidence: 0.9, citation: { sheet: 'FW', cell: `B${row}`, verbatim: name } }],
  })
  const isoPlan = (names: string[]) => ({
    coverages: names.map((name, i) => ({
      refId: `GL.COV.${String(i + 1).padStart(3, '0')}`, docId: `GL-COV-${String(i + 1).padStart(3, '0')}`,
      label: name, data: { name, refId: `GL.COV.${String(i + 1).padStart(3, '0')}` },
    })),
    forms: [], rules: [], formRules: [], ldTables: [], rtTables: [], ratingSteps: [],
  })

  it('two extracted entities sharing a name → NO adoption, one flagged warning', () => {
    const bundle = buildImportPlan(
      { entities: [brainCoverage('Blanket Additional Insured', 2), brainCoverage('Blanket Additional Insured', 3)] },
      { isoPlan: isoPlan(['Blanket Additional Insured']) },
    )
    const warn = (bundle.importWarnings as { kind: string; detail: string }[]).find(w => w.kind === 'ambiguous-identity')
    expect(warn).toBeTruthy()
    expect(warn!.detail).toContain('matches 2 extracted coverage entities by name')
    expect(warn!.detail).toContain('identity was NOT adopted')
    // Neither brain entity stole the mapper's refId by queue position…
    const adopted = (bundle.plan.coverages as { refId: string | null; data: Record<string, unknown> }[])
      .filter(c => c.refId === 'GL.COV.001')
    expect(adopted).toHaveLength(1)
    expect(adopted[0].data.consensus).not.toBe('iso-join')     // the mapper-only append, not a graft
    // …and nothing was dropped: both extracted entities survive, review-flagged.
    const kept = (bundle.plan.coverages as { label: string; data: Record<string, unknown> }[])
      .filter(c => c.label === 'Blanket Additional Insured')
    expect(kept.length).toBe(3)                                 // 2 extracted + 1 mapper-only
    expect(kept.filter(c => c.data.needsReview === true).length).toBe(2)
  })

  it('an UNAMBIGUOUS single match still adopts identity (the join is not disabled)', () => {
    const bundle = buildImportPlan(
      { entities: [brainCoverage('Premises Liability', 2), brainCoverage('Products Liability', 3)] },
      { isoPlan: isoPlan(['Premises Liability']) },
    )
    expect((bundle.importWarnings as { kind: string }[]).some(w => w.kind === 'ambiguous-identity')).toBe(false)
    const joined = (bundle.plan.coverages as { label: string; refId: string | null; data: Record<string, unknown> }[])
      .find(c => c.label === 'Premises Liability')
    expect(joined!.refId).toBe('GL.COV.001')
    expect(joined!.data.consensus).toBe('iso-join')
  })
})
