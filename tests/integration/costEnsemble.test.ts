// costEnsemble integration test — drives the REAL cost-ensemble server modules against a live
// Firestore emulator (not mocks): the semantic cache (Part A), anchor invalidation (Part B), and
// the cost caps + circuit breaker (Part C). It uses the provider-agnostic LOCAL embedding (no
// Voyage) and an INJECTED deterministic verifier (no live Anthropic), so the whole three-gate
// lifecycle + eviction + budget ladder + breaker are proven end-to-end, offline, in the gate.
//
// Run via: pnpm test:integration  (firebase emulators:exec boots Firestore + Storage first; the
// Admin SDK auto-connects through FIRESTORE_EMULATOR_HOST). Rich console traces make the run
// observable — the machinery working against real Firestore, step by step.
import { describe, it, beforeAll, afterEach, expect } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { localQueryEmbedding } from '@pf/shared'
import { semanticCacheGet, semanticCachePut, invalidateSemanticCacheByAnchors } from '../../functions/src/semanticCache'
import type { VerifyFn } from '../../functions/src/semanticCache'
import { guardSpend, bumpSpend } from '../../functions/src/costGuard'

beforeAll(() => { if (!getApps().length) initializeApp({ projectId: 'productreinvention' }) })

const db = getFirestore()
const emb = (q: string) => localQueryEmbedding(q)
// A live catalogue where PH.COV.001 + HO 04 95 resolve (upper-cased refId / normalized form).
const known = { refIds: new Set(['PH.COV.001']), formNumbers: new Set(['HO0495']) }
const YES: VerifyFn = async () => true
const NO:  VerifyFn = async () => false
const L = (...a: unknown[]) => console.log('   ·', ...a)

async function wipe(coll: string) {
  const snap = await db.collection(coll).get()
  const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); await b.commit()
}
afterEach(async () => { await wipe('semanticCache'); await wipe('costCounters') })

const Q = 'What endorsement adds water back-up coverage on the Personal Home product?'
const A = 'The Water Back-Up and Sump Discharge endorsement [HO 04 95] adds it, attaching to [PH.COV.001].'

describe('Part A — semantic response cache (real Firestore emulator, local mode)', () => {
  it('MISS on an empty cache → store → HIT for the same question (verifier YES)', async () => {
    const miss = await semanticCacheGet({ query: Q, queryVector: emb(Q), known, mode: 'local', verify: YES })
    L('first ask →', miss.reason); expect(miss.hit).toBeNull()

    await semanticCachePut({ query: Q, queryVector: emb(Q), answer: A, anchors: ['PH.COV.001', 'HO0495'], mode: 'local', model: 'claude-sonnet-5' })
    const hit = await semanticCacheGet({ query: Q, queryVector: emb(Q), known, mode: 'local', verify: YES })
    L('repeat ask → ', hit.reason, '· similarity', hit.similarity.toFixed(3))
    expect(hit.reason).toBe('hit')
    expect(hit.hit?.answer).toBe(A)
  })

  it('never serves a confidently-wrong answer: the cheap verifier can veto a high-similarity match', async () => {
    await semanticCachePut({ query: Q, queryVector: emb(Q), answer: A, anchors: ['PH.COV.001'], mode: 'local', model: 'claude-sonnet-5' })
    // Same wording (similarity passes the 0.93 floor) but the verifier says the answer doesn't fit.
    const r = await semanticCacheGet({ query: Q, queryVector: emb(Q), known, mode: 'local', verify: NO })
    L('verifier says NO →', r.reason)
    expect(r.hit).toBeNull()
    expect(r.reason).toBe('verifier-declined')
  })

  it('an unrelated question stays below the conservative similarity threshold', async () => {
    await semanticCachePut({ query: Q, queryVector: emb(Q), answer: A, anchors: ['PH.COV.001'], mode: 'local', model: 'claude-sonnet-5' })
    const other = 'Trace the Personal Auto collision premium by territory and symbol.'
    const r = await semanticCacheGet({ query: other, queryVector: emb(other), known, mode: 'local', verify: YES })
    L('unrelated ask →', r.reason, '· similarity', r.similarity.toFixed(3))
    expect(r.hit).toBeNull()
    expect(['below-threshold', 'no-candidate']).toContain(r.reason)
  })

  it('FRESHNESS: a stale-cited answer is never served and is evicted (deleted refId)', async () => {
    // Cache an answer that cited PH.COV.999, then treat that refId as no longer resolving.
    await semanticCachePut({ query: Q, queryVector: emb(Q), answer: A, anchors: ['PH.COV.999'], mode: 'local', model: 'claude-sonnet-5' })
    const r = await semanticCacheGet({ query: Q, queryVector: emb(Q), known, mode: 'local', verify: YES })
    L('stale-cited ask →', r.reason, '· evicted:', r.staleEvicted)
    expect(r.hit).toBeNull()
    expect(r.staleEvicted).toBe(true)
    expect((await db.collection('semanticCache').get()).size).toBe(0)   // proactively evicted
  })
})

describe('Part B — invalidation by cited anchor (real Firestore emulator)', () => {
  it('editing an entity evicts every cached answer that cited it (even while its refId resolves)', async () => {
    await semanticCachePut({ query: Q, queryVector: emb(Q), answer: A, anchors: ['PH.COV.001'], mode: 'local', model: 'claude-sonnet-5' })
    expect((await db.collection('semanticCache').get()).size).toBe(1)

    const removed = await invalidateSemanticCacheByAnchors(['PH.COV.001'])
    L('edited PH.COV.001 → evicted', removed, 'cached answer(s)')
    expect(removed).toBe(1)

    const r = await semanticCacheGet({ query: Q, queryVector: emb(Q), known, mode: 'local', verify: YES })
    L('re-ask after edit →', r.reason)
    expect(r.reason).toBe('no-candidate')   // the cached answer is gone; a fresh answer is computed
  })
})

describe('Part C — cost caps + circuit breaker (real Firestore emulator)', () => {
  it('DENIES a call once the global daily ceiling is reached (no spend without bound)', async () => {
    await bumpSpend({ feature: 'chat', sessionKey: 'other', usd: 30, ok: true, providerCalled: false })  // > $25 ceiling
    const g = await guardSpend({ feature: 'chat', sessionKey: 'fresh-session' })
    L('global spend $30 →', g.action, `(${g.decision.scope})`)
    expect(g.action).toBe('deny')
    expect(g.decision.scope).toBe('global')
  })

  it('DEGRADES (soft) when the per-session cap is reached', async () => {
    await bumpSpend({ feature: 'chat', sessionKey: 'heavy', usd: 2.5, ok: true, providerCalled: false })  // > $2 session cap
    const g = await guardSpend({ feature: 'chat', sessionKey: 'heavy' })
    L('session spend $2.50 →', g.action, `(${g.decision.scope})`)
    expect(g.action).toBe('degrade')
    expect(g.decision.scope).toBe('session')
  })

  it('the circuit breaker OPENS after a run of provider faults (trips a breaker, not the budget)', async () => {
    for (let i = 0; i < 4; i++) await bumpSpend({ feature: 'chat', sessionKey: 'b', usd: 0.001, ok: false, providerCalled: true })
    const g = await guardSpend({ feature: 'chat', sessionKey: 'b' })
    L('after 4 provider faults → breakerOpen:', g.breakerOpen, '· action', g.action)
    expect(g.breakerOpen).toBe(true)
    expect(g.action).toBe('degrade')   // degrade cleanly, don't hammer the stalled provider
  })
})
