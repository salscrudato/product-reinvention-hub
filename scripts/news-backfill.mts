// news-backfill.mts — run the REAL news curation once per day for the past N days
// (default 5) against a live host. Idempotent: items dedup server-side by
// sha1(url), so re-running never duplicates. Never fabricates: the server stores
// only web-search-verified articles and fails honestly if web search is
// unavailable upstream.
//
// Usage:
//   PF_BASE_URL=https://app-prodhub-dev.azurewebsites.net PF_JWT=<token> \
//     pnpm tsx scripts/news-backfill.mts [--days 5]
//
// PF_JWT must belong to the target tenant (tenant-scoped writes). Use an
// isolated tenant for testing — never testco.

const BASE = process.env.PF_BASE_URL || 'http://localhost:8080'
const JWT = process.env.PF_JWT
if (!JWT) {
  console.error('PF_JWT is required (a signed-in user token for the target tenant).')
  process.exit(1)
}

const daysArg = process.argv.indexOf('--days')
const DAYS = Math.min(Math.max(daysArg > -1 ? parseInt(process.argv[daysArg + 1] ?? '5', 10) || 5 : 5, 1), 7)

const isoDay = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

let totalStored = 0
let failed = 0
for (let i = 0; i < DAYS; i++) {
  const day = isoDay(i)
  process.stdout.write(`[news-backfill] curating ${day} … `)
  try {
    const res = await fetch(`${BASE}/api/ai/refreshNews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` },
      body: JSON.stringify({ day }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      failed++
      console.log(`FAILED ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
      if (res.status === 501) {
        console.error('web_search unavailable on this endpoint — backfill cannot produce real news. Stopping.')
        process.exit(2)
      }
      continue
    }
    totalStored += body.stored ?? 0
    console.log(`found ${body.found} · verified ${body.verified} · stored ${body.stored}`)
  } catch (err) {
    failed++
    console.log(`ERROR: ${(err as Error).message}`)
  }
}

console.log(`[news-backfill] done — ${totalStored} items stored across ${DAYS} day(s), ${failed} day(s) failed.`)
process.exit(failed === DAYS ? 1 : 0)
