'use strict'
// external/azureMaps.js — Azure Maps geocoding (account maps-prodhub-dev, provisioned
// 2026-07-15). The reliability fallback for free-text addresses the keyless US Census
// geocoder misses (~20–30%): try Census first, then this. Key: AZURE_MAPS_KEY env
// (server-side only — az maps account keys list -n maps-prodhub-dev -g rg-prodhub-dev).

const BASE = 'https://atlas.microsoft.com/search/address/json'

const isConfigured = () => Boolean(process.env.AZURE_MAPS_KEY)

/** Geocode a free-text address. Returns the best match or null (no results / low score).
 *  Throws { status: 503 } when AZURE_MAPS_KEY is unset — callers degrade, never crash.
 *  @param {string} address
 *  @param {object} [opts]
 *  @param {number} [opts.minScore=0.5] - reject fuzzy matches below this confidence
 *  @returns {Promise<{ lat, lon, formatted, score, countrySubdivision, postalCode } | null>} */
async function geocode(address, opts = {}) {
  if (!isConfigured()) { const e = new Error('azure_maps_not_configured'); e.status = 503; throw e }
  const params = new URLSearchParams({
    'api-version': '1.0',
    'subscription-key': process.env.AZURE_MAPS_KEY,
    query: address,
    limit: '1',
    countrySet: 'US',
  })
  const res = await fetch(`${BASE}?${params}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) { const e = new Error(`azure_maps_${res.status}`); e.status = res.status; throw e }
  const top = (await res.json()).results?.[0]
  if (!top || top.score < (opts.minScore ?? 0.5)) return null
  return {
    lat: top.position.lat,
    lon: top.position.lon,
    formatted: top.address?.freeformAddress || address,
    score: top.score,
    countrySubdivision: top.address?.countrySubdivision || null,
    postalCode: top.address?.postalCode || null,
  }
}

module.exports = { isConfigured, geocode }
