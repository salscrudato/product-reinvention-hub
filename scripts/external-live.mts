// scripts/external-live.mts — live probes for the external data-source inventory
// (server/lib/external/). Companion to tests/server/external.test.ts (mocked): this
// hits the REAL upstreams to prove the endpoints are still alive and shaped as coded.
//
// Keyless sources always run. Keyed sources run only when their env is present:
//   AZURE_FOUNDRY_ENDPOINT + AZURE_FOUNDRY_KEY  → foundry specialty surfaces
//   AZURE_MAPS_KEY                              → geocode fallback
//   NEWSDATA_API_KEY                            → news
//
// Usage: pnpm exec tsx scripts/external-live.mts
// Exit 0 = all attempted probes green; 1 = any failure. Skips are not failures.

import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const external = _require('../server/lib/external') as any

type Check = { name: string; pass: boolean; skip?: boolean; detail: string }
const results: Check[] = []

async function probe(name: string, enabled: boolean, fn: () => Promise<string>) {
  if (!enabled) { results.push({ name, pass: true, skip: true, detail: 'env not set — skipped' }); return }
  try { results.push({ name, pass: true, detail: await fn() }) }
  catch (e) { results.push({ name, pass: false, detail: String((e as Error).message).slice(0, 160) }) }
}

const hasFoundry = Boolean(process.env.AZURE_FOUNDRY_ENDPOINT && process.env.AZURE_FOUNDRY_KEY)

// ── keyless ──────────────────────────────────────────────────────────────────
await probe('vpic.decodeVin', true, async () => {
  const v = await external.vpic.decodeVin('2HGFC2F69LH500001')
  if (v.make !== 'HONDA') throw new Error(`unexpected make: ${v.make}`)
  return `${v.modelYear} ${v.make} ${v.model}`
})

await probe('edgar.lossRatio(PGR)', true, async () => {
  const r = await external.edgar.lossRatio('PGR')
  if (!r || !(r.lossRatioPct > 20 && r.lossRatioPct < 120)) throw new Error(`implausible: ${r?.lossRatioPct}`)
  return `${r.company} FY→${r.fiscalYearEnd}: ${r.lossRatioPct}%`
})

await probe('txFilings.latestFilings(State Farm)', true, async () => {
  const rows = await external.txFilings.latestFilings({ company: 'State Farm', limit: 3 })
  if (!rows.length || !rows[0].serffId) throw new Error('no rows / missing serffId')
  return `${rows.length} rows; latest ${rows[0].serffId} (${rows[0].line})`
})

await probe('hazards.censusGeocode', true, async () => {
  const g = await external.hazards.censusGeocode('1600 Congress Ave, Austin, TX 78701')
  if (!g?.tractGeoid) throw new Error('no tract match')
  return `tract ${g.tractGeoid} @ ${g.lat.toFixed(3)},${g.lon.toFixed(3)}`
})

await probe('hazards.nwsAlerts', true, async () => {
  const a = await external.hazards.nwsAlerts(30.27, -97.74)
  return `${a.length} active alerts (Austin TX)`
})

await probe('hazards.nfipClaims(TX)', true, async () => {
  const c = await external.hazards.nfipClaims({ state: 'TX', limit: 5 })
  if (!c.length) throw new Error('no claims returned')
  return `${c.length} claims; latest loss ${c[0].dateOfLoss}`
})

// ── keyed ────────────────────────────────────────────────────────────────────
await probe('azureMaps.geocode', Boolean(process.env.AZURE_MAPS_KEY), async () => {
  const g = await external.azureMaps.geocode('1600 Congress Ave, Austin TX')
  if (!g) throw new Error('no confident match')
  return `${g.formatted} (score ${g.score})`
})

await probe('newsdata.latest', Boolean(process.env.NEWSDATA_API_KEY), async () => {
  const n = await external.newsdata.latest({ q: 'insurance', size: 3 })
  return `${n.length} articles; first: ${n[0]?.title?.slice(0, 50)}`
})

await probe('foundry.rerank', hasFoundry, async () => {
  const r = await external.foundry.rerank('water damage coverage',
    ['Coverage C personal property', 'Water damage exclusion applies to flood'], { topN: 1 })
  return `top: "${r[0].document}" (${r[0].score.toFixed(2)})`
})

await probe('foundry.deepReason', hasFoundry, async () => {
  const r = await external.foundry.deepReason('Reply with the single word OK.', { maxOutputTokens: 200 })
  return `text: ${r.text.slice(0, 40) || '(reasoning consumed budget — raw ok)'}`
})

await probe('foundry.documentOcr', hasFoundry, async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const r = await external.foundry.documentOcr({ imageDataUrl: png })
  return `${r.pages.length} page(s) OCRed`
})

await probe('foundry.embedQuality', hasFoundry, async () => {
  const v = await external.foundry.embedQuality(['ping'])
  return `dim ${v[0].length}`
})

await probe('foundry.verifyJudge(xai)', hasFoundry, async () => {
  const r = await external.foundry.verifyJudge('xai', [{ role: 'user', content: 'Reply OK' }], { maxTokens: 8 })
  return `text: ${r.text.slice(0, 20)}`
})

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0
for (const c of results) {
  const mark = c.skip ? '⏭' : c.pass ? '✅' : '❌'
  if (!c.pass) failed++
  console.log(`${mark} ${c.name.padEnd(36)} ${c.detail}`)
}
console.log(`\n${results.filter(r => r.pass && !r.skip).length} passed, ${results.filter(r => r.skip).length} skipped, ${failed} failed`)
process.exit(failed ? 1 : 0)
