'use strict'
// tenant-profile.js — the tenant-carrier profile READ seam (BR-03 / NEWS_TENANT_SPEC §1).
// One doc per tenant at path `tenantProfile/main` (standard audited envelope write from the
// client; this module never writes). Consumers: the news scout's profile-first scope
// (refresh-news.js buildScope) and the daily brief's enrichment (daily-brief.js). The
// normalizer is the shape gate: junk fields normalize away, an empty carrierName means NO
// profile — which contractually selects the byte-parity fallback scope.

/** Pure shape gate. Returns null unless a non-empty carrierName survives cleaning.
 *  Every string is SANITIZED for prompt embedding here, once, for all consumers:
 *  double quotes + ASCII control characters (CR/LF/TAB included) become spaces,
 *  whitespace collapses, hard length caps apply — a hostile or bloated doc can
 *  never inflate or steer a model prompt. */
const LIST_CAP = 12
function _normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null
  const str = (v, max) => {
    if (typeof v !== 'string') return ''
    let out = ''
    for (const ch of v) out += (ch.charCodeAt(0) < 32 || ch === '"') ? ' ' : ch
    return out.replace(/\s+/g, ' ').trim().slice(0, max)
  }
  const arr = (v, max) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, LIST_CAP) : [])
  const carrierName = str(raw.carrierName, 120)
  if (!carrierName) return null
  const market = ['personal', 'commercial', 'both'].includes(raw.market) ? raw.market : null
  return {
    carrierName,
    aliases:     arr(raw.aliases, 80),
    lobs:        arr(raw.lobs, 24),
    market,
    states:      arr(raw.states, 8).map((s) => s.toUpperCase()),
    watchTopics: arr(raw.watchTopics, 60),
    competitors: arr(raw.competitors, 80),
  }
}

/** Load + normalize the tenant profile; absent/unreadable/thin-to-nothing → null. */
async function loadTenantProfile(tid) {
  try {
    const { docs } = require('./cosmos').resolveTenantStore(tid)
    const sql =
      "SELECT TOP 1 c.data FROM c WHERE c.kind='entity' AND c.coll='tenantProfile' AND c.tenantId=@tid AND c.path=@p"
    const { resources } = await docs.items.query(
      { query: sql, parameters: [{ name: '@tid', value: tid }, { name: '@p', value: 'tenantProfile/main' }] },
      { maxItemCount: 1 },
    ).fetchAll()
    return _normalizeProfile(resources[0]?.data)
  } catch {
    return null
  }
}

module.exports = { loadTenantProfile, _normalizeProfile }
