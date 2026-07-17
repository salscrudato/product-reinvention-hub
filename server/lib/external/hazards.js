'use strict'
// external/hazards.js — parameterized clients for the free, keyless federal hazard APIs.
// For PORTFOLIO-side features (underwriting context, form risk reports, claims analysis).
//
// NOTE: server/lib/homecheck.js keeps its own INLINE copies of these calls on purpose —
// its zero-portfolio-access isolation invariant forbids sharing modules with the B2B
// surface. Do not refactor homecheck to import this file; keep the two paths separate.
//
// All sources probe-verified in production via homecheck (2026-07): Census, FEMA NRI,
// FEMA NFHL, OpenFEMA, USGS, NWS. NFIP claims added here (same OpenFEMA host).

async function getJson(url, label) {
  // 10s cap so a stalled federal endpoint can't hang the underwriting/claims request (F16).
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ProductReinventionHub (ops@prodhub.local)' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) { const e = new Error(`${label}_${res.status}`); e.status = res.status; throw e }
  return res.json()
}

/** US Census geocoder: free-text address → coordinates + census tract GEOID.
 *  Returns null when Census finds no match (then try external/azureMaps.geocode). */
async function censusGeocode(address) {
  const params = new URLSearchParams({ address, benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json' })
  const j = await getJson(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?${params}`, 'census')
  const m = j.result?.addressMatches?.[0]
  if (!m) return null
  const tract = m.geographies?.['Census Tracts']?.[0]
  return { lat: m.coordinates.y, lon: m.coordinates.x, formatted: m.matchedAddress, tractGeoid: tract?.GEOID || null }
}

/** FEMA National Risk Index for a census tract (GEOID from censusGeocode).
 *  Returns the tract's composite + per-peril risk ratings, or null if unknown tract. */
async function nriByTract(tractGeoid) {
  const params = new URLSearchParams({ where: `TRACTFIPS='${String(tractGeoid).replace(/'/g, '')}'`, outFields: 'RISK_SCORE,RISK_RATNG,EAL_RATNG,SOVI_RATNG,RESL_RATNG,WFIR_RATNG,RFLD_RATNG,HRCN_RATNG,TRND_RATNG,ERQK_RATNG', f: 'json' })
  const j = await getJson(`https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/NRI_Table_CensusTracts/FeatureServer/0/query?${params}`, 'nri')
  const a = j.features?.[0]?.attributes
  if (!a) return null
  return {
    riskScore: a.RISK_SCORE, riskRating: a.RISK_RATNG, expectedAnnualLossRating: a.EAL_RATNG,
    socialVulnerability: a.SOVI_RATNG, communityResilience: a.RESL_RATNG,
    perils: { wildfire: a.WFIR_RATNG, riverineFlood: a.RFLD_RATNG, hurricane: a.HRCN_RATNG, tornado: a.TRND_RATNG, earthquake: a.ERQK_RATNG },
  }
}

/** FEMA NFHL flood zone at a point. Returns { zone, subtype } or null (unmapped area). */
async function floodZone(lat, lon) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY', returnGeometry: 'false', f: 'json',
  })
  const j = await getJson(`https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?${params}`, 'nfhl')
  const a = j.features?.[0]?.attributes
  return a ? { zone: a.FLD_ZONE, subtype: a.ZONE_SUBTY || null } : null
}

/** OpenFEMA disaster declarations for a state (optionally county-filtered). */
async function disasterDeclarations({ state, county, limit = 20 } = {}) {
  const filters = [`state eq '${String(state).replace(/'/g, '')}'`]
  if (county) filters.push(`designatedArea eq '${String(county).replace(/'/g, '')}'`)
  const params = new URLSearchParams({ $filter: filters.join(' and '), $orderby: 'declarationDate desc', $top: String(limit) })
  const j = await getJson(`https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?${params}`, 'openfema')
  return (j.DisasterDeclarationsSummaries || []).map(d => ({
    disasterNumber: d.disasterNumber, declarationDate: d.declarationDate, incidentType: d.incidentType,
    title: d.declarationTitle, area: d.designatedArea,
  }))
}

/** OpenFEMA NFIP flood claims — real flood LOSS data by state/county (paid-loss amounts). */
async function nfipClaims({ state, countyCode, limit = 50 } = {}) {
  const filters = [`state eq '${String(state).replace(/'/g, '')}'`]
  if (countyCode) filters.push(`countyCode eq '${String(countyCode).replace(/'/g, '')}'`)
  const params = new URLSearchParams({ $filter: filters.join(' and '), $orderby: 'dateOfLoss desc', $top: String(limit) })
  const j = await getJson(`https://www.fema.gov/api/open/v2/FimaNfipClaims?${params}`, 'nfip')
  return (j.FimaNfipClaims || []).map(c => ({
    dateOfLoss: c.dateOfLoss, state: c.state, countyCode: c.countyCode, floodZone: c.floodZoneCurrent || c.ratedFloodZone,
    buildingPaidUsd: c.amountPaidOnBuildingClaim, contentsPaidUsd: c.amountPaidOnContentsClaim,
  }))
}

/** USGS earthquakes within radiusKm of a point since `sinceYears` ago. */
async function quakes({ lat, lon, radiusKm = 100, sinceYears = 20, minMagnitude = 4 } = {}) {
  const start = new Date(Date.now() - sinceYears * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const params = new URLSearchParams({
    format: 'geojson', latitude: String(lat), longitude: String(lon), maxradiuskm: String(radiusKm),
    starttime: start, minmagnitude: String(minMagnitude), orderby: 'magnitude',
  })
  const j = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`, 'usgs')
  return (j.features || []).map(f => ({ magnitude: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString() }))
}

/** Active NWS weather alerts at a point. */
async function nwsAlerts(lat, lon) {
  const j = await getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, 'nws')
  return (j.features || []).map(f => ({ event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline }))
}

module.exports = { censusGeocode, nriByTract, floodZone, disasterDeclarations, nfipClaims, quakes, nwsAlerts }
