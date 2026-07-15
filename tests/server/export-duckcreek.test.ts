// X5 — /api/export/duckcreek server behavior: role gating, the audited export-run
// record, and the XE-08 page.dictionary flip — ON SUCCESS ONLY, NEVER on a
// blocked export (ledger XE-08; CONTRACTS: literal flag key `page.dictionary`,
// tenant override via setTenantConfig into the Cosmos tenant doc).
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import request from 'supertest'
import { buildExportBundle } from '../../shared/src/export/duckcreek/bundle'
import { paExportInput } from '../../shared/src/export/duckcreek/paFixture'

process.env.AUTH_JWT_SECRET ??= 'test-secret-export-duckcreek-tests-min32ch'
process.env.COSMOS_ENDPOINT ??= 'https://dummy.documents.azure.com:443/'
process.env.COSMOS_KEY ??= 'dGVzdGtleQ=='

const _require = createRequire(import.meta.url)
const { app } = _require('../../server/server') as { app: import('express').Express }
const { sign } = _require('../../server/lib/auth') as { sign: (p: Record<string, unknown>) => string }
const exportModule = _require('../../server/lib/export-duckcreek') as {
  _internals: {
    assembleExportInput: (readers: Record<string, unknown>, tid: string, productId: string, opts: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    runDuckCreekExport: (deps: Record<string, unknown>, tid: string, actor: Record<string, unknown>, input: unknown) => Promise<{ status: number; body: Record<string, unknown> }>
    flipDictionaryFlag: (tid: string, actor: Record<string, unknown>, pc?: Record<string, unknown>) => Promise<boolean>
  }
}

const tok = (role: string, tenantId = 'testco') =>
  sign({ sub: `t-${role.toLowerCase()}`, email: `${role.toLowerCase()}@test`, name: role, role, tenantId })

const ACTOR = { uid: 't-editor', name: 'EDITOR' }

function successDeps() {
  const mutateInternal = vi.fn().mockResolvedValue(undefined)
  const flipDictionaryFlag = vi.fn().mockResolvedValue(true)
  return {
    deps: {
      buildExportBundle,
      toXlsxBase64: vi.fn().mockResolvedValue('UEsDBA=='),
      mutateInternal,
      flipDictionaryFlag,
    },
    mutateInternal,
    flipDictionaryFlag,
  }
}

describe('X5 role gating (server-enforced, VIEWER read-only invariant)', () => {
  it('VIEWER cannot trigger an export — 403 need product:write', async () => {
    const res = await request(app)
      .post('/api/export/duckcreek')
      .set('Authorization', `Bearer ${tok('VIEWER')}`)
      .send({ productId: 'PA.PROD.001' })
    expect(res.status).toBe(403)
    expect(res.body.need).toBe('product:write')
  })

  it('unauthenticated requests are rejected 401', async () => {
    const res = await request(app).post('/api/export/duckcreek').send({ productId: 'PA.PROD.001' })
    expect(res.status).toBe(401)
  })

  it('EDITOR passes the gates and reaches the handler (400 on missing productId — before any I/O)', async () => {
    const res = await request(app)
      .post('/api/export/duckcreek')
      .set('Authorization', `Bearer ${tok('EDITOR')}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('productId required')
  })
})

describe('X5 the page.dictionary flip — on SUCCESS only, NEVER on a blocked export', () => {
  it('a successful export writes the audited run record AND flips the flag exactly once', async () => {
    const { deps, mutateInternal, flipDictionaryFlag } = successDeps()
    const result = await exportModule._internals.runDuckCreekExport(deps, 'testco', ACTOR, paExportInput())
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.dictionaryRevealed).toBe(true)

    // The run record rides the standard envelope with the P4 provenance shape.
    expect(mutateInternal).toHaveBeenCalledTimes(1)
    const [tid, payload, actor, source] = mutateInternal.mock.calls[0]!
    expect(tid).toBe('testco')
    expect(payload.op).toBe('create')
    expect(String(payload.path)).toMatch(/^exports\/dc-/)
    expect(payload.entityType).toBe('exportRun')
    expect(payload.data.provenance).toMatchObject({ authoredBy: 'human', confidence: 1 })
    expect(payload.data.provenance.citations).toContain('PA.PROD.001')
    expect(actor).toEqual(ACTOR)
    expect(source).toBe('/api/export/duckcreek')

    expect(flipDictionaryFlag).toHaveBeenCalledTimes(1)
    expect(flipDictionaryFlag).toHaveBeenCalledWith('testco', ACTOR)
  })

  it('a BLOCKED export (MISSING required field) never writes a record and NEVER flips the flag', async () => {
    const { deps, mutateInternal, flipDictionaryFlag } = successDeps()
    const input = paExportInput()
    input.product = { ...input.product, lob: { refId: 'GL.LOB.001', name: 'General Liability' } }
    const result = await exportModule._internals.runDuckCreekExport(deps, 'testco', ACTOR, input)
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(false)
    expect(result.body.blocked).toBe(true)
    expect(result.body.error).toBe('export_blocked_missing_fields')
    expect((result.body.gapReport as { missing: unknown[] }).missing).toHaveLength(1)
    expect(result.body.artifacts).toBeUndefined()
    expect(mutateInternal).not.toHaveBeenCalled()
    expect(flipDictionaryFlag).not.toHaveBeenCalled()
  })

  it('a flip failure never masks a successful export (honest partial success)', async () => {
    const { deps, mutateInternal } = successDeps()
    deps.flipDictionaryFlag = vi.fn().mockRejectedValue(new Error('cosmos down'))
    const result = await exportModule._internals.runDuckCreekExport(deps, 'testco', ACTOR, paExportInput())
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.dictionaryRevealed).toBe(false)
    expect(mutateInternal).toHaveBeenCalledTimes(1)
  })

  it('flipDictionaryFlag writes the CONTRACTS-frozen tenant override — and skips when already revealed', async () => {
    // First success: effective flag not yet true → setTenantConfig with the
    // literal key, plane "tenant" (Cosmos tenant doc data.config.flags).
    const setTenantConfig = vi.fn().mockResolvedValue({})
    const pcOff = { getEffectiveFlags: vi.fn().mockResolvedValue({ 'page.dictionary': false }), setTenantConfig }
    await expect(exportModule._internals.flipDictionaryFlag('testco', ACTOR, pcOff)).resolves.toBe(true)
    expect(setTenantConfig).toHaveBeenCalledWith('testco', { flags: { 'page.dictionary': true } }, 'tenant', ACTOR)

    // Later successes: already true → idempotent no-op, no second write.
    const pcOn = { getEffectiveFlags: vi.fn().mockResolvedValue({ 'page.dictionary': true }), setTenantConfig: vi.fn() }
    await expect(exportModule._internals.flipDictionaryFlag('testco', ACTOR, pcOn)).resolves.toBe(false)
    expect(pcOn.setTenantConfig).not.toHaveBeenCalled()
  })
})

describe('X5 input assembly (injected readers — mirrors the Cosmos helpers)', () => {
  it('assembles product + subcollections + referenced tables only, forms filtered by productRefIds', async () => {
    const seed = paExportInput()
    const readers = {
      readEntity: vi.fn(async (_tid: string, path: string) => {
        if (path === 'products/PA.PROD.001') return seed.product
        const rt = path.match(/^rtTables\/(.+)$/)
        if (rt) return seed.rtTables[rt[1]!] ?? null
        const ld = path.match(/^ldTables\/(.+)$/)
        if (ld) return seed.ldTables[ld[1]!] ?? null
        return null
      }),
      readColl: vi.fn(async (_tid: string, _pid: string, coll: string) => {
        if (coll === 'coverages') return seed.coverages
        if (coll === 'rules') return seed.rules
        if (coll === 'formRules') return seed.formRules
        if (coll === 'ratingPrograms') return [seed.ratingProgram]
        return []
      }),
      readFormsForProduct: vi.fn(async () => seed.forms),
    }
    const input = await exportModule._internals.assembleExportInput(
      readers, 'testco', 'PA.PROD.001', { tenantName: 'testco', now: new Date('2026-07-15T12:00:00Z') },
    )
    expect(input).not.toBeNull()
    expect(Object.keys(input!.rtTables as Record<string, unknown>)).toEqual(Object.keys(seed.rtTables))
    expect(Object.keys(input!.ldTables as Record<string, unknown>)).toEqual(Object.keys(seed.ldTables))
    expect((input!.ratingInputSpec as unknown[]).length).toBe(16)
    // The assembled input drives the SAME bundle the offline harness proves.
    const bundle = buildExportBundle(input as never)
    expect(bundle.blocked).toBe(false)
    expect(bundle.lint?.ok).toBe(true)
  })

  it('returns null (→ 404) for a product that does not exist', async () => {
    const readers = {
      readEntity: vi.fn().mockResolvedValue(null),
      readColl: vi.fn().mockResolvedValue([]),
      readFormsForProduct: vi.fn().mockResolvedValue([]),
    }
    const input = await exportModule._internals.assembleExportInput(
      readers, 'testco', 'NOPE.PROD.001', { tenantName: 'testco', now: new Date() },
    )
    expect(input).toBeNull()
  })
})
