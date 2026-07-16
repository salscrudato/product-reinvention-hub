// external.test.ts — the external data-source inventory (server/lib/external/).
// All upstream HTTP is mocked; these tests pin URL construction, parameter encoding,
// injection escaping, normalization shapes, and unconfigured-degradation behavior.
// Live-endpoint verification lives in scripts/external-live.mts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'

// fleet.js reads Foundry env at require time — set before loading the modules.
process.env.AZURE_FOUNDRY_ENDPOINT ??= 'https://foundry.test.example'
process.env.AZURE_FOUNDRY_KEY ??= 'test-foundry-key'

const _require = createRequire(import.meta.url)
const external = _require('../../server/lib/external') as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> & {
  azureMaps: { isConfigured: () => boolean; geocode: (a: string, o?: object) => Promise<unknown> }
}

type MockCall = { url: string; init?: { headers?: Record<string, string>; body?: string } }
const calls: MockCall[] = []

function mockFetch(status: number, payload: unknown) {
  const fn = vi.fn(async (url: string, init?: MockCall['init']) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => { calls.length = 0 })
afterEach(() => { vi.unstubAllGlobals() })

// URLSearchParams encodes spaces as '+', which decodeURIComponent leaves alone.
const decodedUrl = (i = 0) => decodeURIComponent(calls[i].url).replace(/\+/g, ' ')

describe('external/foundry — specialty AI surfaces', () => {
  it('deepReason uses the /responses API (gpt-*-pro rejects chat/completions) and joins output_text', async () => {
    mockFetch(200, {
      output: [{ content: [{ type: 'output_text', text: 'part one ' }, { type: 'output_text', text: 'part two' }] }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const r = await external.foundry.deepReason('question') as { text: string }
    expect(calls[0].url).toBe('https://foundry.test.example/openai/v1/responses')
    expect(JSON.parse(calls[0].init!.body!).model).toBe('gpt-5.4-pro')
    expect(r.text).toBe('part one part two')
  })

  it('rerank posts to the provider-scoped Cohere route and maps results back onto documents', async () => {
    mockFetch(200, { results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }] })
    const docs = ['alpha', 'beta']
    const r = await external.foundry.rerank('q', docs) as Array<{ index: number; score: number; document: string }>
    expect(calls[0].url).toBe('https://foundry.test.example/providers/cohere/v2/rerank')
    expect(r[0]).toEqual({ index: 1, score: 0.9, document: 'beta' })
  })

  it('documentOcr posts to the Mistral OCR route and returns per-page markdown', async () => {
    mockFetch(200, { pages: [{ index: 0, markdown: '<table>x</table>' }] })
    const r = await external.foundry.documentOcr({ imageDataUrl: 'data:image/png;base64,AA==' }) as { pages: Array<{ markdown: string }> }
    expect(calls[0].url).toBe('https://foundry.test.example/providers/mistral/azure/ocr')
    expect(r.pages[0].markdown).toContain('<table>')
  })

  it('verifyJudge routes lineages to the right cross-vendor deployments', async () => {
    mockFetch(200, { choices: [{ message: { content: 'verdict' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    await external.foundry.verifyJudge('deepseek', [{ role: 'user', content: 'x' }])
    expect(JSON.parse(calls[0].init!.body!).model).toBe('DeepSeek-V4-Pro')
    await external.foundry.verifyJudge('xai', [{ role: 'user', content: 'x' }])
    expect(JSON.parse(calls[1].init!.body!).model).toBe('grok-4.3')
  })
})

describe('external/edgar — carrier financials', () => {
  it('computes the latest-annual loss ratio from XBRL facts and sends the required User-Agent', async () => {
    mockFetch(200, {
      entityName: 'TEST CARRIER',
      facts: { 'us-gaap': {
        PremiumsEarnedNet: { units: { USD: [
          { form: '10-K', fp: 'FY', end: '2024-12-31', val: 50_000 },
          { form: '10-K', fp: 'FY', end: '2025-12-31', val: 100_000 },
        ] } },
        PolicyholderBenefitsAndClaimsIncurredNet: { units: { USD: [
          { form: '10-K', fp: 'FY', end: '2025-12-31', val: 66_100 },
        ] } },
      } },
    })
    const r = await external.edgar.lossRatio('80661') as { lossRatioPct: number; fiscalYearEnd: string }
    expect(calls[0].url).toBe('https://data.sec.gov/api/xbrl/companyfacts/CIK0000080661.json')
    expect(calls[0].init!.headers!['User-Agent']).toBeTruthy()
    expect(r.fiscalYearEnd).toBe('2025-12-31')  // picked the latest FY, not the first
    expect(r.lossRatioPct).toBe(66.1)
  })

  it('returns null when the insurance tags are absent (non-carrier filer)', async () => {
    mockFetch(200, { entityName: 'NOT AN INSURER', facts: { 'us-gaap': {} } })
    expect(await external.edgar.lossRatio('123')).toBeNull()
  })
})

describe('external/txFilings — TX DOI SERFF filing metadata', () => {
  it('escapes SoQL single quotes in company filters (injection safety) and normalizes rows', async () => {
    mockFetch(200, [{
      company_name: "O'BRIEN MUTUAL", serff_id: 'OBRI-1', received_date: '2026-01-02T00:00:00.000',
      product_name: 'HO-1', state_type_of_insurance: 'Homeowners', percent_change: '  12.5%', status: 'Closed',
    }])
    const rows = await external.txFilings.latestFilings({ company: "O'Brien" }) as Array<{ percentChange: number; serffId: string }>
    const url = decodedUrl()
    expect(url).toContain('ittv-5xew.json')                       // default PC dataset
    expect(url).toContain("like '%O''BRIEN%'")                    // doubled quote, uppercased
    expect(rows[0].serffId).toBe('OBRI-1')
    expect(rows[0].percentChange).toBe(12.5)                       // '  12.5%' → number
  })

  it('rateChanges filters zero-change filings out', async () => {
    mockFetch(200, [
      { company_name: 'A', serff_id: 'A-1', percent_change: '   0.0%' },
      { company_name: 'B', serff_id: 'B-1', percent_change: '  -7.2%' },
    ])
    const rows = await external.txFilings.rateChanges() as Array<{ serffId: string }>
    expect(rows.map(r => r.serffId)).toEqual(['B-1'])
  })
})

describe('external/vpic — VIN decode', () => {
  it('normalizes the vPIC flat row to rating-relevant attributes', async () => {
    mockFetch(200, { Results: [{ Make: 'HONDA', Model: 'Civic', ModelYear: '2020', BodyClass: 'Sedan', Doors: '4', DisplacementL: '2.0', EngineCylinders: '4', ErrorCode: '0' }] })
    const r = await external.vpic.decodeVin('2HGFC2F69LH500001') as { make: string; engine: { displacementL: string } }
    expect(calls[0].url).toContain('/DecodeVinValues/2HGFC2F69LH500001')
    expect(r.make).toBe('HONDA')
    expect(r.engine.displacementL).toBe('2.0')
  })
})

describe('external/azureMaps + newsdata — keyed sources degrade honestly', () => {
  it('azureMaps.geocode throws status 503 when AZURE_MAPS_KEY is unset', async () => {
    delete process.env.AZURE_MAPS_KEY
    expect(external.azureMaps.isConfigured()).toBe(false)
    await expect(external.azureMaps.geocode('x')).rejects.toMatchObject({ status: 503 })
  })

  it('azureMaps.geocode returns null below minScore instead of a junk match', async () => {
    process.env.AZURE_MAPS_KEY = 'test-maps-key'
    mockFetch(200, { results: [{ position: { lat: 1, lon: 2 }, score: 0.3, address: {} }] })
    expect(await external.azureMaps.geocode('vague address')).toBeNull()
    delete process.env.AZURE_MAPS_KEY
  })

  it('newsdata.latest throws status 503 when NEWSDATA_API_KEY is unset', async () => {
    delete process.env.NEWSDATA_API_KEY
    await expect(external.newsdata.latest()).rejects.toMatchObject({ status: 503 })
  })
})

describe('external/hazards — federal stack', () => {
  it('floodZone returns null for unmapped areas (no features)', async () => {
    mockFetch(200, { features: [] })
    expect(await external.hazards.floodZone(30.27, -97.74)).toBeNull()
  })

  it('nfipClaims builds an OData filter and normalizes paid-loss fields', async () => {
    mockFetch(200, { FimaNfipClaims: [{ dateOfLoss: '2025-01-01', state: 'TX', amountPaidOnBuildingClaim: 12345 }] })
    const rows = await external.hazards.nfipClaims({ state: 'TX' }) as Array<{ buildingPaidUsd: number }>
    expect(decodedUrl()).toContain("state eq 'TX'")
    expect(rows[0].buildingPaidUsd).toBe(12345)
  })
})
