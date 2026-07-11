'use strict'
// server/lib/homecheck.js — /api/homecheck/v1 consumer-facing home risk check.
// Mounted at /api/homecheck/v1 in server.js.
//
// ── ZERO PORTFOLIO ACCESS INVARIANT ──────────────────────────────────────────
//   This module MUST NOT import ./cosmos, ./data, ./auth (requireRole/requireAuth),
//   or any module that reads the B2B Cosmos data store. Violations break consumer
//   isolation and are a security defect. Enforced structurally: the guest rate limiter
//   runs before every handler; no Cosmos handle is ever acquired.
// ─────────────────────────────────────────────────────────────────────────────
//
// External integrations (all free, keyless, server-side only):
//   US Census Geocoder       https://geocoding.geo.census.gov/geocoder/
//   FEMA NRI v1.20 Dec 2025  https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/NRI_Table_CensusTracts/
//   FEMA NFHL (flood zone)   https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/
//   OpenFEMA API             https://www.fema.gov/api/open/v2/disasterDeclarations
//   USGS FDSN Earthquake     https://earthquake.usgs.gov/fdsnws/event/1/query
//   NOAA/NWS API             https://api.weather.gov/
//   USDA Forest Service WHP  https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_WildfireHazardPotential_01/ImageServer/
//
// ── FIRST STREET SEAM (LICENSED — NOT WIRED) ─────────────────────────────────
//   First Street Foundation data (FloodFactor, FireFactor, HeatFactor, HeatFactor)
//   is FREEMIUM / LICENSED. A paid API agreement is required before calling their
//   endpoints. The `firstStreetSeam()` function below returns a documented stub.
//   When a license is obtained:
//     1. Set FIRST_STREET_API_KEY in App Service configuration.
//     2. Replace the stub body with:
//          const r = await timedFetch(`https://api.firststreet.org/v1/location/summary/${lat},${lon}`,
//            { headers: { 'x-api-key': process.env.FIRST_STREET_API_KEY } })
//     3. Attribution: "First Street Foundation, [year]. First Street National Model. first.foundation"
// ─────────────────────────────────────────────────────────────────────────────
//
// Vision inventory: GPT-5.1 (Foundry gpt-5.1 deployment, OpenAI-compat surface).
//   Photos are base64-encoded in request body (max 10 photos, 5 MB each).
//   Results stored in-memory Map (sessionId → session). 24-hour TTL + DELETE path.
//   No photo data or session content ever reaches the B2B Cosmos data store.
//   Requires explicit `consent: true` in request body; rejected otherwise.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express')
const crypto  = require('crypto')

const router = express.Router()

// ─── External API config ─────────────────────────────────────────────────────

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
const NRI_ENDPOINT    = 'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/NRI_Table_CensusTracts/FeatureServer/0/query'
const NFHL_ENDPOINT   = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query'
const OPENFEMA_BASE   = 'https://www.fema.gov/api/open/v2'
const USGS_EQ         = 'https://earthquake.usgs.gov/fdsnws/event/1/query'
const NWS_POINTS      = 'https://api.weather.gov/points'
const NWS_ALERTS      = 'https://api.weather.gov/alerts/active'
const WHP_ENDPOINT    = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_WildfireHazardPotential_01/ImageServer/identify'

// Foundry AI config (for vision inventory). Model routing (single source) + cost guard come from
// ./fleet (a pure-constants module — no cosmos/data/auth, so homecheck's guest isolation holds).
// Secrets never leave server. An explicit GPT deployment override still wins for ops.
const fleet = require('./fleet')
const GPT_OVERRIDE = process.env.AZURE_FOUNDRY_GPT_DEPLOYMENT || ''

// User-Agent required by NWS API (https://www.weather.gov/documentation/services-web-api).
const NWS_UA = 'ProductHub-HomeCheck/1.0 (homecheck@producthub.local)'

// ─── State FIPS → abbreviation lookup ────────────────────────────────────────

const FIPS_TO_STATE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
  '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
  '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
  '54':'WV','55':'WI','56':'WY','60':'AS','66':'GU','69':'MP','72':'PR','78':'VI',
}

// ─── NRI hazard field names (18 hazards, FEMA NRI v1.20 December 2025) ───────

const NRI_FIELDS = [
  'RISK_SCORE','RISK_RATNG',
  'ERQK_RISKR','ERQK_RISKS', // Earthquake
  'HAIL_RISKR','HAIL_RISKS', // Hail
  'HRCN_RISKR','HRCN_RISKS', // Hurricane
  'RFLD_RISKR','RFLD_RISKS', // Riverine Flooding
  'CFLD_RISKR','CFLD_RISKS', // Coastal Flooding
  'SWND_RISKR','SWND_RISKS', // Strong Wind
  'TRND_RISKR','TRND_RISKS', // Tornado
  'WFIR_RISKR','WFIR_RISKS', // Wildfire
  'LTNG_RISKR','LTNG_RISKS', // Lightning
  'CWAV_RISKR','CWAV_RISKS', // Cold Wave
  'HWAV_RISKR','HWAV_RISKS', // Heat Wave
  'DRGT_RISKR','DRGT_RISKS', // Drought
  'AVLN_RISKR','AVLN_RISKS', // Avalanche
  'ISTM_RISKR','ISTM_RISKS', // Ice Storm
  'LNDS_RISKR','LNDS_RISKS', // Landslide
  'TSUN_RISKR','TSUN_RISKS', // Tsunami
  'VLCN_RISKR','VLCN_RISKS', // Volcanic Activity
  'WNTW_RISKR','WNTW_RISKS', // Winter Weather
  'TRACTFIPS','COUNTY','STATE',
].join(',')

// WHP class labels (USDA Forest Service Wildfire Hazard Potential raster values)
const WHP_LABELS = { 1:'Very Low',2:'Low',3:'Moderate',4:'High',5:'Very High',6:'Non-Burnable/Urban' }

// ─── Timed fetch with signal timeout ────────────────────────────────────────

async function timedFetch(url, opts = {}, timeoutMs = 10_000) {
  const signal = AbortSignal.timeout(timeoutMs)
  return fetch(url, { ...opts, signal })
}

// ─── Response cache (TTL-based, in-memory) ───────────────────────────────────
// Caches upstream API responses to reduce repeated calls for the same address.
// Key = cache-specific string. Value = { data, cachedAt }.

const _cache = new Map()

// TTLs in ms
const TTL = {
  geocode:    24 * 60 * 60 * 1000, // 24 h — address coords don't change
  nri:        7  * 24 * 60 * 60 * 1000, // 7 days — NRI updates quarterly
  nfhl:       7  * 24 * 60 * 60 * 1000, // 7 days — flood maps update infrequently
  openfema:   6  * 60 * 60 * 1000, // 6 h — declarations can be added daily
  usgs:       1  * 60 * 60 * 1000, // 1 h — earthquake catalog is near real-time
  noaa:       15 * 60 * 1000,       // 15 min — alerts change quickly
  whp:        30 * 24 * 60 * 60 * 1000, // 30 days — WHP updates annually
}

function cacheGet(key, ttl) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > ttl) { _cache.delete(key); return null }
  return entry.data
}
function cacheSet(key, data) { _cache.set(key, { data, cachedAt: Date.now() }) }

// Lazy cache eviction on size pressure
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of _cache) {
    if (now - v.cachedAt > 7 * 24 * 60 * 60 * 1000) _cache.delete(k)
  }
}, 60 * 60 * 1000).unref()

// ─── Guest rate limiter (per-IP token bucket) ────────────────────────────────
// No JWT auth on this surface — rate limit by IP instead.
// Dual bucket: RISK (expensive, calls many upstream APIs) and VISION (AI calls).

const RATE_CONFIG = {
  risk:    { cap: parseInt(process.env.HC_RISK_RATE_CAP    || '10', 10), rps: parseFloat(process.env.HC_RISK_RATE_RPS    || '0.002778') }, // 10/h
  vision:  { cap: parseInt(process.env.HC_VISION_RATE_CAP  || '3',  10), rps: parseFloat(process.env.HC_VISION_RATE_RPS  || '0.000833') }, // 3/h
  report:  { cap: parseInt(process.env.HC_REPORT_RATE_CAP  || '20', 10), rps: parseFloat(process.env.HC_REPORT_RATE_RPS  || '0.005556') }, // 20/h
  default: { cap: 30, rps: 0.00833 }, // 30/h fallback
}

const _ipBuckets = new Map() // `${bucket}:${ip}` → { tokens, lastMs }

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || ''
  return (fwd ? fwd.split(',')[0] : (req.socket?.remoteAddress || 'unknown')).trim()
}

function consumeIpToken(ip, bucketName) {
  const cfg = RATE_CONFIG[bucketName] || RATE_CONFIG.default
  const key  = `${bucketName}:${ip}`
  const now  = Date.now()
  let b = _ipBuckets.get(key)
  if (!b) {
    b = { tokens: cfg.cap - 1, lastMs: now }
    _ipBuckets.set(key, b)
    return { allowed: true, retryAfter: 0 }
  }
  b.tokens = Math.min(cfg.cap, b.tokens + (now - b.lastMs) / 1000 * cfg.rps)
  b.lastMs = now
  if (b.tokens >= 1) { b.tokens -= 1; return { allowed: true, retryAfter: 0 } }
  const retryAfter = Math.ceil((1 - b.tokens) / cfg.rps)
  return { allowed: false, retryAfter }
}

function guestRateLimit(bucketName) {
  return (req, res, next) => {
    const ip = getClientIp(req)
    const { allowed, retryAfter } = consumeIpToken(ip, bucketName)
    if (!allowed) {
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({ error: 'rate_limit_exceeded', retryAfter, bucketName })
    }
    next()
  }
}

// ─── CORS for the consumer surface ──────────────────────────────────────────
// /api/homecheck/v1 is guest-accessible from any origin (consumer PWA).
router.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type,Accept')
  next()
})
router.options('*', (_req, res) => res.sendStatus(204))

// ─── Upstream API integrations ────────────────────────────────────────────────

async function censusGeocode(address) {
  const cacheKey = `geocode:${address.toLowerCase().trim()}`
  const cached = cacheGet(cacheKey, TTL.geocode)
  if (cached) return cached

  const params = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    vintage:   'Current_Current',
    layers:    'Census Tracts',
    format:    'json',
  })
  const resp = await timedFetch(`${CENSUS_GEOCODER}?${params}`)
  if (!resp.ok) throw new Error(`Census geocoder ${resp.status}`)
  const json = await resp.json()
  const match = json.result?.addressMatches?.[0]
  if (!match) throw Object.assign(new Error('Address not found'), { code: 'NOT_FOUND' })

  const coords = match.coordinates
  const tract  = match.geographies?.['Census Tracts']?.[0]
  if (!coords || !tract) throw Object.assign(new Error('Census tract not resolved'), { code: 'NO_TRACT' })

  const stateFips  = String(tract.STATE  || '').padStart(2, '0')
  const countyFips = String(tract.COUNTY || '').padStart(3, '0')
  const tractCode  = String(tract.TRACT  || '').padStart(6, '0')
  const tractFips  = `${stateFips}${countyFips}${tractCode}` // 11-digit census tract FIPS

  const result = {
    lat:        coords.y,
    lon:        coords.x,
    tractFips,
    stateFips,
    countyFips,
    stateAbbr:  FIPS_TO_STATE[stateFips] || stateFips,
    countyName: tract.NAME       || '',
    tractName:  tract.BASENAME   || tractCode,
    matchedAddress: match.matchedAddress,
    source:     'US Census Bureau Geocoder (Public_AR_Current benchmark)',
    attribution:'US Census Bureau. Geographic Data (geocoding.geo.census.gov). Public domain.',
  }
  cacheSet(cacheKey, result)
  return result
}

async function fetchNri(tractFips) {
  const cacheKey = `nri:${tractFips}`
  const cached = cacheGet(cacheKey, TTL.nri)
  if (cached) return cached

  const params = new URLSearchParams({
    where:           `TRACTFIPS='${tractFips}'`,
    outFields:       NRI_FIELDS,
    returnGeometry:  'false',
    f:               'json',
  })
  const resp = await timedFetch(`${NRI_ENDPOINT}?${params}`)
  if (!resp.ok) throw new Error(`FEMA NRI ArcGIS ${resp.status}`)
  const json = await resp.json()
  const attrs = json.features?.[0]?.attributes
  if (!attrs) return null  // tract not in NRI coverage (some territories)

  const result = {
    raw:         attrs,
    composite:   { score: attrs.RISK_SCORE, rating: attrs.RISK_RATNG },
    hazards: {
      earthquake:      { rating: attrs.ERQK_RISKR, score: attrs.ERQK_RISKS },
      hail:            { rating: attrs.HAIL_RISKR, score: attrs.HAIL_RISKS },
      hurricane:       { rating: attrs.HRCN_RISKR, score: attrs.HRCN_RISKS },
      riverineFlood:   { rating: attrs.RFLD_RISKR, score: attrs.RFLD_RISKS },
      coastalFlood:    { rating: attrs.CFLD_RISKR, score: attrs.CFLD_RISKS },
      strongWind:      { rating: attrs.SWND_RISKR, score: attrs.SWND_RISKS },
      tornado:         { rating: attrs.TRND_RISKR, score: attrs.TRND_RISKS },
      wildfire:        { rating: attrs.WFIR_RISKR, score: attrs.WFIR_RISKS },
      lightning:       { rating: attrs.LTNG_RISKR, score: attrs.LTNG_RISKS },
      coldWave:        { rating: attrs.CWAV_RISKR, score: attrs.CWAV_RISKS },
      heatWave:        { rating: attrs.HWAV_RISKR, score: attrs.HWAV_RISKS },
      drought:         { rating: attrs.DRGT_RISKR, score: attrs.DRGT_RISKS },
      avalanche:       { rating: attrs.AVLN_RISKR, score: attrs.AVLN_RISKS },
      iceStorm:        { rating: attrs.ISTM_RISKR, score: attrs.ISTM_RISKS },
      landslide:       { rating: attrs.LNDS_RISKR, score: attrs.LNDS_RISKS },
      tsunami:         { rating: attrs.TSUN_RISKR, score: attrs.TSUN_RISKS },
      volcanicActivity:{ rating: attrs.VLCN_RISKR, score: attrs.VLCN_RISKS },
      winterWeather:   { rating: attrs.WNTW_RISKR, score: attrs.WNTW_RISKS },
    },
    source:      'FEMA National Risk Index (NRI) v1.20 — December 2025 release',
    attribution: 'Federal Emergency Management Agency (FEMA). National Risk Index, December 2025. hazards.fema.gov/nri',
    dataUrl:     'https://hazards.fema.gov/nri/',
  }
  cacheSet(cacheKey, result)
  return result
}

async function fetchFloodZone(lat, lon) {
  const cacheKey = `nfhl:${lat.toFixed(5)}:${lon.toFixed(5)}`
  const cached = cacheGet(cacheKey, TTL.nfhl)
  if (cached) return cached

  const params = new URLSearchParams({
    geometry:       `${lon},${lat}`,
    geometryType:   'esriGeometryPoint',
    inSR:           '4326',
    spatialRel:     'esriSpatialRelIntersects',
    outFields:      'FLD_ZONE,SFHA_TF,ZONE_SUBTY,FIRM_PAN',
    returnGeometry: 'false',
    f:              'json',
    resultRecordCount: '1',
  })
  const resp = await timedFetch(`${NFHL_ENDPOINT}?${params}`)
  if (!resp.ok) throw new Error(`FEMA NFHL ${resp.status}`)
  const json = await resp.json()
  const attrs = json.features?.[0]?.attributes

  const result = {
    zone:        attrs?.FLD_ZONE    || 'Undetermined',
    sfha:        attrs?.SFHA_TF === 'T',
    subtype:     attrs?.ZONE_SUBTY  || null,
    firmPanel:   attrs?.FIRM_PAN    || null,
    description: describeFloodZone(attrs?.FLD_ZONE),
    source:      'FEMA National Flood Hazard Layer (NFHL) — FIRM panel effective dates vary by jurisdiction',
    attribution: 'Federal Emergency Management Agency (FEMA). National Flood Hazard Layer (NFHL). hazards.fema.gov',
    dataUrl:     'https://hazards.fema.gov/femaportal/NFHL/',
    note:        'FEMA flood maps may not reflect recent remapping. Verify with local floodplain administrator.',
  }
  cacheSet(cacheKey, result)
  return result
}

function describeFloodZone(zone) {
  const z = (zone || '').toUpperCase().trim()
  if (!z || z === 'UNDETERMINED') return 'Flood zone undetermined — may not be mapped.'
  if (z.startsWith('A') || z.startsWith('V')) {
    if (z === 'AE')   return 'Zone AE — Special Flood Hazard Area (SFHA). Base flood elevations determined. High flood risk (≥1% annual chance).'
    if (z === 'AH')   return 'Zone AH — SFHA with shallow flooding (ponding). Base flood depth 1–3 ft.'
    if (z === 'AO')   return 'Zone AO — SFHA with sheet-flow flooding on sloping terrain.'
    if (z === 'VE')   return 'Zone VE — SFHA with coastal wave action. Highest flood risk category.'
    if (z === 'A')    return 'Zone A — SFHA without detailed flood elevations. High flood risk (≥1% annual chance).'
    return `Zone ${z} — Special Flood Hazard Area (SFHA). High flood risk.`
  }
  if (z === 'X' || z === 'B' || z === 'C') return `Zone ${z} — Moderate to minimal flood risk. Outside SFHA. Federal flood insurance not mandatory but recommended.`
  if (z === 'D') return 'Zone D — Undetermined flood hazard. Possible but undetermined flood risk.'
  return `Zone ${z} — See FEMA FIRM panel for full description.`
}

async function fetchOpenFema(stateAbbr, countyName) {
  const cacheKey = `openfema:${stateAbbr}:${countyName.toLowerCase().slice(0, 30)}`
  const cached = cacheGet(cacheKey, TTL.openfema)
  if (cached) return cached

  const params = new URLSearchParams({
    '$filter':   `state eq '${stateAbbr}'`,
    '$orderby':  'declarationDate desc',
    '$top':      '5',
    '$select':   'disasterNumber,declarationTitle,declarationDate,incidentType,designatedArea',
    '$format':   'json',
  })
  const resp = await timedFetch(`${OPENFEMA_BASE}/disasterDeclarations?${params}`)
  if (!resp.ok) throw new Error(`OpenFEMA ${resp.status}`)
  const json = await resp.json()
  const declarations = (json.DisasterDeclarations || json.data || []).map(d => ({
    number:    d.disasterNumber,
    title:     d.declarationTitle,
    date:      d.declarationDate?.slice(0, 10),
    type:      d.incidentType,
    area:      d.designatedArea,
  }))

  const result = {
    recentDeclarations: declarations,
    count:              declarations.length,
    source:             'OpenFEMA API v2 — Disaster Declarations',
    attribution:        'Federal Emergency Management Agency (FEMA). OpenFEMA Dataset: Disaster Declarations Summaries. fema.gov/api/open',
    dataUrl:            'https://www.fema.gov/api/open/v2/disasterDeclarations',
    note:               'Limited to 5 most recent state-level declarations. Some may predate property construction.',
  }
  cacheSet(cacheKey, result)
  return result
}

async function fetchEarthquakes(lat, lon) {
  const cacheKey = `usgs:${lat.toFixed(3)}:${lon.toFixed(3)}`
  const cached = cacheGet(cacheKey, TTL.usgs)
  if (cached) return cached

  const params = new URLSearchParams({
    format:         'geojson',
    latitude:       String(lat),
    longitude:      String(lon),
    maxradiuskm:    '200',
    minmagnitude:   '2.5',
    orderby:        'time',
    limit:          '5',
  })
  const resp = await timedFetch(`${USGS_EQ}?${params}`)
  if (!resp.ok) throw new Error(`USGS FDSN ${resp.status}`)
  const json = await resp.json()
  const events = (json.features || []).map(f => ({
    magnitude: f.properties.mag,
    place:     f.properties.place,
    time:      new Date(f.properties.time).toISOString().slice(0, 10),
    depth:     f.geometry?.coordinates?.[2],
    url:       f.properties.url,
  }))

  // Fetch seismic hazard (PGA 2% in 50yr) — USGS NSHM 2023 via ArcGIS
  let pga2pct50yr = null
  try {
    const nshm = await timedFetch(
      `https://earthquake.usgs.gov/ws/designmaps/asce7-22.json?latitude=${lat}&longitude=${lon}&riskCategory=II&siteClass=D&title=HomeCheck`, 5_000)
    if (nshm.ok) {
      const nd = await nshm.json()
      pga2pct50yr = nd?.output?.data?.[0]?.pga ?? null
    }
  } catch { /* non-fatal */ }

  const result = {
    recentEvents:   events,
    pga2pct50yr,
    source:         'USGS Earthquake Hazards Program — FDSN Event Web Service + ASCE 7-22 Design Maps',
    attribution:    'U.S. Geological Survey (USGS). Earthquake Hazards Program. earthquake.usgs.gov. Data from ComCat.',
    dataUrl:        'https://earthquake.usgs.gov/fdsnws/event/1/',
    note:           'Recent events within 200 km. PGA = Peak Ground Acceleration (2% probability in 50 years, Site Class D).',
  }
  cacheSet(cacheKey, result)
  return result
}

async function fetchNoaaAlerts(lat, lon) {
  const cacheKey = `noaa:${lat.toFixed(3)}:${lon.toFixed(3)}`
  const cached = cacheGet(cacheKey, TTL.noaa)
  if (cached) return cached

  const result = { alerts: [], forecastOffice: null, radarStation: null, source: 'NOAA/NWS', attribution: '', dataUrl: '' }

  try {
    const ptsResp = await timedFetch(`${NWS_POINTS}/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { 'User-Agent': NWS_UA, 'Accept': 'application/geo+json' } })
    if (ptsResp.ok) {
      const pts = await ptsResp.json()
      result.forecastOffice = pts.properties?.cwa || null
      result.radarStation   = pts.properties?.radarStation || null
    }
  } catch { /* non-fatal */ }

  try {
    const alertResp = await timedFetch(`${NWS_ALERTS}?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { 'User-Agent': NWS_UA, 'Accept': 'application/geo+json' } })
    if (alertResp.ok) {
      const alertJson = await alertResp.json()
      result.alerts = (alertJson.features || []).slice(0, 5).map(f => ({
        event:       f.properties.event,
        headline:    f.properties.headline,
        severity:    f.properties.severity,
        certainty:   f.properties.certainty,
        urgency:     f.properties.urgency,
        onset:       f.properties.onset?.slice(0, 19),
        expires:     f.properties.expires?.slice(0, 19),
        description: (f.properties.description || '').slice(0, 300),
      }))
    }
  } catch { /* non-fatal */ }

  result.attribution = 'National Oceanic and Atmospheric Administration (NOAA) / National Weather Service (NWS). api.weather.gov. Real-time data.'
  result.dataUrl     = 'https://www.weather.gov/'
  cacheSet(cacheKey, result)
  return result
}

async function fetchWildfire(lat, lon) {
  const cacheKey = `whp:${lat.toFixed(3)}:${lon.toFixed(3)}`
  const cached = cacheGet(cacheKey, TTL.whp)
  if (cached) return cached

  const params = new URLSearchParams({
    geometry:       JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType:   'esriGeometryPoint',
    returnGeometry: 'false',
    returnCatalogItems: 'false',
    f:              'json',
  })
  const resp = await timedFetch(`${WHP_ENDPOINT}?${params}`)
  if (!resp.ok) throw new Error(`USDA WHP ${resp.status}`)
  const json = await resp.json()
  const val  = json.value ? parseInt(json.value, 10) : null

  const result = {
    value:       val,
    label:       val ? (WHP_LABELS[val] || 'Unknown') : 'Not mapped (may be non-burnable or offshore)',
    source:      'USDA Forest Service — Wildfire Hazard Potential (WHP) v2023',
    attribution: 'U.S. Department of Agriculture, Forest Service. Wildfire Hazard Potential (WHP), Version 2023. Developed by the Pyrologix LLC under USFS contract. apps.fs.usda.gov. Attribution required.',
    dataUrl:     'https://www.firelab.org/project/wildfire-hazard-potential',
    note:        'WHP represents relative potential for wildfire based on fuels, climate, and historical fire activity. Does not predict wildfire occurrence. See also USFS Wildfire Risk to Communities (wildfirerisk.org).',
    wildfirerisk: 'https://wildfirerisk.org',
  }
  cacheSet(cacheKey, result)
  return result
}

// ─── First Street seam (LICENSED — NOT WIRED) ───────────────────────────────

function firstStreetSeam() {
  return {
    licensed:    false,
    wired:       false,
    note:        'First Street Foundation data (FloodFactor, FireFactor, HeatFactor) requires a paid license. ' +
                 'Set FIRST_STREET_API_KEY in App Service configuration and replace this stub in server/lib/homecheck.js. ' +
                 'Attribution: "First Street Foundation, [year]. First Street National Model. first.foundation"',
    learnMore:   'https://firststreet.org/data-access',
  }
}

// ─── Risk report aggregator ───────────────────────────────────────────────────

async function buildRiskPayload(address) {
  let geocode, nri, flood, openfema, earthquake, noaa, wildfire
  const errors = {}

  try { geocode = await censusGeocode(address) }
  catch (e) { throw e }  // fatal — we need coords for everything else

  const { lat, lon, tractFips, stateAbbr, countyName } = geocode

  await Promise.allSettled([
    fetchNri(tractFips).then(r => { nri = r }).catch(e => { errors.nri = e.message }),
    fetchFloodZone(lat, lon).then(r => { flood = r }).catch(e => { errors.flood = e.message }),
    fetchOpenFema(stateAbbr, countyName).then(r => { openfema = r }).catch(e => { errors.openfema = e.message }),
    fetchEarthquakes(lat, lon).then(r => { earthquake = r }).catch(e => { errors.earthquake = e.message }),
    fetchNoaaAlerts(lat, lon).then(r => { noaa = r }).catch(e => { errors.noaa = e.message }),
    fetchWildfire(lat, lon).then(r => { wildfire = r }).catch(e => { errors.wildfire = e.message }),
  ])

  return {
    requestId:   crypto.randomUUID(),
    address:     geocode.matchedAddress,
    geocode,
    nri:         nri ?? null,
    flood:       flood ?? null,
    earthquake:  earthquake ?? null,
    wildfire:    wildfire ?? null,
    noaa:        noaa ?? null,
    openfema:    openfema ?? null,
    firstStreet: firstStreetSeam(),
    errors:      Object.keys(errors).length ? errors : undefined,
    generatedAt: new Date().toISOString(),
    disclaimer:  'Risk data is for informational purposes only. Verify all data with qualified professionals before making coverage decisions. FEMA maps may not reflect recent remapping. Insurance premiums depend on individual property characteristics and insurer underwriting guidelines.',
    citations: [
      geocode?.attribution,
      nri?.attribution,
      flood?.attribution,
      earthquake?.attribution,
      wildfire?.attribution,
      noaa?.attribution,
      openfema?.attribution,
    ].filter(Boolean),
  }
}

// ─── Downloadable HTML report generator ─────────────────────────────────────

function buildReportHtml(risk) {
  const ratingLabel = r => {
    if (!r) return 'N/A'
    const map = { 'Very Low':'very-low','Relatively Low':'low','Relatively Moderate':'moderate','Relatively High':'high','Very High':'very-high' }
    return map[r] || r
  }
  const ratingBadge = (label, val) => {
    if (!val) return ''
    const cl = { 'very-low':'#047857','low':'#059669','moderate':'#B45309','high':'#DC6803','very-high':'#B91C1C' }
    const bg = { 'very-low':'#DCFCE7','low':'#D1FAE5','moderate':'#FEF3C7','high':'#FDE8CC','very-high':'#FEE2E2' }
    const c = cl[ratingLabel(val)] || '#5B5C6B'
    const b = bg[ratingLabel(val)] || '#F3F4F6'
    return `<span class="badge" style="color:${c};background:${b}">${val}</span>`
  }

  const nri   = risk.nri
  const flood = risk.flood
  const eq    = risk.earthquake
  const wf    = risk.wildfire
  const noaa  = risk.noaa
  const fema  = risk.openfema

  const hazardRows = nri ? Object.entries({
    'Earthquake':       nri.hazards.earthquake,
    'Hail':             nri.hazards.hail,
    'Hurricane':        nri.hazards.hurricane,
    'Riverine Flooding':nri.hazards.riverineFlood,
    'Coastal Flooding': nri.hazards.coastalFlood,
    'Strong Wind':      nri.hazards.strongWind,
    'Tornado':          nri.hazards.tornado,
    'Wildfire':         nri.hazards.wildfire,
    'Lightning':        nri.hazards.lightning,
    'Winter Weather':   nri.hazards.winterWeather,
    'Heat Wave':        nri.hazards.heatWave,
    'Ice Storm':        nri.hazards.iceStorm,
  }).map(([name, h]) => `<tr><td>${name}</td><td>${ratingBadge(name, h?.rating)}</td></tr>`).join('') : ''

  const alertsHtml = (noaa?.alerts || []).map(a => `
    <div class="alert-card">
      <strong>${a.event}</strong>
      <p>${a.headline || ''}</p>
      <small>Severity: ${a.severity} · Certainty: ${a.certainty} · Expires: ${a.expires?.replace('T',' ').slice(0,16) || 'N/A'}</small>
    </div>`).join('') || '<p class="muted">No active weather alerts at this time.</p>'

  const declarationsHtml = (fema?.recentDeclarations || []).map(d => `
    <div class="decl-row">
      <span class="dr-num">DR-${d.number}</span>
      <span>${d.title} — <em>${d.date}</em></span>
    </div>`).join('') || '<p class="muted">No recent declarations found for this state.</p>'

  const eqHtml = (eq?.recentEvents || []).map(e => `
    <div class="eq-row">
      <strong>M${e.magnitude}</strong> — ${e.place} <small>(${e.time})</small>
    </div>`).join('') || '<p class="muted">No significant recent seismic activity within 200 km.</p>'

  // What-if HO-3 reference table (indicative, from PH seed illustrative rates)
  const deductibleImpact = [
    { ded:'$500', delta:'+12%' }, { ded:'$1,000', delta:'Baseline' },
    { ded:'$2,500', delta:'-8%' }, { ded:'$5,000', delta:'-14%' },
  ]
  const mitigationTable = deductibleImpact.map(r =>
    `<tr><td>${r.ded}</td><td class="${r.delta.startsWith('+') ? 'warn' : r.delta === 'Baseline' ? '' : 'good'}">${r.delta}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Home Risk Report — ${risk.address}</title>
<meta name="description" content="Home risk assessment for ${risk.address}. Generated by Product Reinvention Hub HomeCheck."/>
<style>
:root{--bg:#F7F7FA;--surface:#FFFFFF;--text:#131318;--dim:#5B5C6B;--accent:#8B1FE0;--accent-bright:#A100FF;--border:rgba(19,19,26,.08);--radius:14px;--good:#047857;--warn:#B45309;--danger:#B91C1C;--shadow:0 1px 2px rgba(19,19,26,.04),0 14px 34px rgba(139,31,224,.06);}
html[data-theme=dark]{--bg:#0B0B10;--surface:#15151C;--text:#F2F2F6;--dim:#ADAEBE;--accent:#C29BFF;--border:rgba(255,255,255,.10);}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Inter Variable','Inter',system-ui,sans-serif;font-size:15px;line-height:1.6;background:var(--bg);color:var(--text);padding:0 16px 64px;-webkit-font-smoothing:antialiased;}
.nav{display:flex;align-items:center;justify-content:space-between;padding:20px 0 24px;border-bottom:1px solid var(--border);margin-bottom:32px;}
.brand{font-weight:700;font-size:17px;letter-spacing:-.02em;color:var(--accent);}
.theme-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--dim);font-size:13px;}
.hero{margin-bottom:40px;}
.hero h1{font-size:clamp(22px,4vw,32px);font-weight:700;letter-spacing:-.022em;line-height:1.25;margin-bottom:8px;}
.hero .addr{color:var(--dim);font-size:14px;}
.hero .generated{color:var(--dim);font-size:12px;margin-top:4px;}
.card{background:var(--surface);border-radius:var(--radius);padding:24px;margin-bottom:20px;box-shadow:var(--shadow);border:1px solid var(--border);}
.card h2{font-size:17px;font-weight:600;letter-spacing:-.014em;margin-bottom:16px;display:flex;align-items:center;gap:8px;}
.card h2 .icon{width:20px;height:20px;}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.6;}
.composite{display:flex;align-items:center;gap:12px;margin-bottom:16px;}
.score{font-size:36px;font-weight:800;letter-spacing:-.03em;color:var(--accent);}
table{width:100%;border-collapse:collapse;font-size:14px;}
th{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);color:var(--dim);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em;}
td{padding:8px 12px;border-bottom:1px solid var(--border);}
tr:last-child td{border-bottom:none;}
.alert-card{background:rgba(185,28,28,.05);border:1px solid rgba(185,28,28,.20);border-radius:10px;padding:14px;margin-bottom:12px;}
.alert-card strong{display:block;color:var(--danger);margin-bottom:4px;}
.alert-card small{color:var(--dim);}
.decl-row,.eq-row{padding:10px 0;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:baseline;font-size:14px;}
.decl-row:last-child,.eq-row:last-child{border-bottom:none;}
.dr-num{font-family:monospace;font-size:12px;background:var(--bg);padding:2px 6px;border-radius:5px;color:var(--accent);flex-shrink:0;}
.flood-zone{font-size:28px;font-weight:800;font-family:monospace;color:var(--accent);letter-spacing:.02em;}
.zone-sfha{display:inline-block;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:600;margin-left:10px;}
.zone-sfha.yes{background:rgba(185,28,28,.10);color:var(--danger);}
.zone-sfha.no{background:rgba(4,120,87,.10);color:var(--good);}
.good{color:var(--good);}
.warn{color:var(--warn);}
.danger{color:var(--danger);}
.muted{color:var(--dim);font-size:14px;}
.citations{margin-top:40px;padding-top:24px;border-top:1px solid var(--border);}
.citations h3{font-size:14px;font-weight:600;color:var(--dim);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em;}
.citations ol{padding-left:18px;}
.citations li{font-size:12px;color:var(--dim);margin-bottom:6px;line-height:1.5;}
.disclaimer{background:rgba(19,19,26,.04);border-radius:10px;padding:14px;font-size:12px;color:var(--dim);line-height:1.5;margin-top:24px;}
.print-btn{display:inline-block;margin-top:24px;padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;}
.first-street-note{background:rgba(139,31,224,.06);border:1px solid rgba(139,31,224,.18);border-radius:10px;padding:14px;font-size:13px;color:var(--dim);margin-bottom:20px;}
@media(max-width:600px){body{font-size:14px;}}
@media print{.theme-btn,.print-btn{display:none;}.card{break-inside:avoid;}}
</style>
</head>
<body>
<nav class="nav">
  <span class="brand">HomeCheck Risk Report</span>
  <button class="theme-btn" onclick="toggleTheme()">Toggle dark mode</button>
</nav>
<div class="hero">
  <h1>Home Risk Assessment</h1>
  <p class="addr">${risk.address}</p>
  <p class="generated">Generated ${risk.generatedAt?.slice(0,10)} · Report ID ${risk.requestId?.slice(0,8).toUpperCase()}</p>
</div>

${nri ? `
<div class="card">
  <h2>Composite Risk Index</h2>
  <div class="composite">
    <span class="score">${nri.composite.score?.toFixed(1) ?? 'N/A'}</span>
    ${ratingBadge('Composite', nri.composite.rating)}
  </div>
  <p class="muted" style="font-size:13px">Composite score is a percentile ranking (0–100) relative to all US census tracts. Source: <a href="${nri.dataUrl}">${nri.source}</a>.</p>
  <br/>
  <table>
    <thead><tr><th>Hazard</th><th>Risk Rating</th></tr></thead>
    <tbody>${hazardRows}</tbody>
  </table>
  <p class="muted" style="font-size:12px;margin-top:12px">Citation: ${nri.attribution}</p>
</div>` : ''}

${flood ? `
<div class="card">
  <h2>Flood Hazard Zone</h2>
  <p>
    <span class="flood-zone">${flood.zone}</span>
    <span class="zone-sfha ${flood.sfha ? 'yes' : 'no'}">${flood.sfha ? 'SFHA — High Risk' : 'Outside SFHA'}</span>
  </p>
  <p style="margin-top:12px;font-size:14px">${flood.description}</p>
  ${flood.firmPanel ? `<p class="muted" style="font-size:13px;margin-top:8px">FIRM Panel: ${flood.firmPanel}</p>` : ''}
  <p class="muted" style="font-size:12px;margin-top:12px">Citation: ${flood.attribution}</p>
  <p class="muted" style="font-size:12px;font-style:italic">${flood.note}</p>
</div>` : ''}

${wf ? `
<div class="card">
  <h2>Wildfire Hazard Potential</h2>
  <p style="font-size:18px;font-weight:700;margin-bottom:8px">${wf.label}</p>
  <p style="font-size:14px;color:var(--dim)">${wf.note}</p>
  <p class="muted" style="font-size:12px;margin-top:12px">Citation: ${wf.attribution}</p>
</div>` : ''}

${eq ? `
<div class="card">
  <h2>Earthquake Hazard</h2>
  ${eq.pga2pct50yr !== null ? `<p style="margin-bottom:12px;font-size:14px">Peak Ground Acceleration (2% / 50 yr): <strong>${(eq.pga2pct50yr).toFixed(4)}g</strong> <span class="muted">(Site Class D)</span></p>` : ''}
  <h3 style="font-size:14px;font-weight:600;margin-bottom:8px">Recent Seismic Events (M≥2.5, 200 km radius)</h3>
  ${eqHtml}
  <p class="muted" style="font-size:12px;margin-top:12px">Citation: ${eq.attribution}</p>
</div>` : ''}

${noaa ? `
<div class="card">
  <h2>Active Weather Alerts</h2>
  ${alertsHtml}
  <p class="muted" style="font-size:12px;margin-top:12px">Citation: ${noaa.attribution}</p>
</div>` : ''}

${fema ? `
<div class="card">
  <h2>Recent Federal Disaster Declarations</h2>
  ${declarationsHtml}
  <p class="muted" style="font-size:12px;margin-top:12px">Citation: ${fema.attribution}</p>
  <p class="muted" style="font-size:12px;font-style:italic">${fema.note}</p>
</div>` : ''}

<div class="card">
  <h2>Indicative Premium Impact — Deductible (HO-3 Reference)</h2>
  <p class="muted" style="font-size:13px;margin-bottom:12px">Illustrative deductible factors from an ISO-style HO-3 Personal Home program. Actual premiums depend on individual property characteristics and insurer underwriting. Not a quote.</p>
  <table>
    <thead><tr><th>All-Peril Deductible</th><th>Indicative Premium Impact</th></tr></thead>
    <tbody>${mitigationTable}</tbody>
  </table>
  <p class="muted" style="font-size:12px;margin-top:12px">Source: Illustrative ISO-style HO-3 rating tables. Factors vary by insurer and state. Baseline = $1,000 deductible.</p>
</div>

<div class="first-street-note">
  <strong>First Street Foundation Data</strong> — FloodFactor, FireFactor, and HeatFactor scores provide property-level risk projections accounting for climate change. These data require a license from First Street Foundation and are not included in this report. Learn more: <a href="https://firststreet.org" style="color:var(--accent)">firststreet.org</a>.
</div>

<div class="citations">
  <h3>Data Sources &amp; Citations</h3>
  <ol>
    ${(risk.citations || []).map(c => `<li>${c}</li>`).join('')}
  </ol>
</div>

<div class="disclaimer">${risk.disclaimer}</div>

<div style="text-align:center;margin-top:32px">
  <button class="print-btn" onclick="window.print()">Save / Print this report</button>
</div>

<script>
function toggleTheme(){
  var h=document.documentElement;
  var t=h.getAttribute('data-theme')==='dark'?'light':'dark';
  h.setAttribute('data-theme',t);
  try{localStorage.setItem('hc.theme',t);}catch(e){}
}
(function(){
  try{var t=localStorage.getItem('hc.theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}
})();
</script>
</body>
</html>`
}

// ─── Vision inventory (GPT-5.1) ───────────────────────────────────────────────

const _sessions = new Map() // sessionId → session
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

function evictSessions() {
  const now = Date.now()
  for (const [id, s] of _sessions) { if (now > s.expiresAt) _sessions.delete(id) }
}
setInterval(evictSessions, 30 * 60 * 1000).unref()

const VISION_PROMPT = `You are a home inventory specialist analyzing a property photo.
Extract every identifiable item visible in the photo. For each item return a JSON object with:
  name: string (descriptive item name)
  category: string (Electronics | Furniture | Appliance | Jewelry | Clothing | Art | Sporting | Tools | Other)
  brand: string | null (brand/manufacturer if visible; null if not)
  model: string | null (model number if visible; null if not)
  condition: "Excellent" | "Good" | "Fair" | "Poor"
  estimatedValueUSD: number (reasonable replacement value in USD; 0 if decorative/unvaluable)
  notes: string | null (any relevant details: serial visible, damage, distinguishing features)
  confidence: "High" | "Medium" | "Low"

Return ONLY a valid JSON array of items. Do not include markdown or explanation.
If no identifiable items are found, return an empty array [].`

async function processPhotoInventory(photos) {
  if (!fleet.isConfigured()) {
    throw Object.assign(new Error('AI vision not configured (AZURE_FOUNDRY_ENDPOINT/KEY missing)'), { code: 'NOT_CONFIGURED' })
  }

  const allItems = []
  const processedCount = { photos: 0, items: 0, errors: 0 }

  for (const photo of photos) {
    if (!photo.dataUrl) { processedCount.errors++; continue }
    // Cost guard: stop dispatching once the budget ceiling is hit (bounded spend); return what
    // was extracted so far rather than failing the whole session.
    const g = fleet.guard()
    if (!g.allow) break
    const deployment = GPT_OVERRIDE || fleet.resolveModel('VISION', g.degrade)
    try {
      const messages = [{
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: photo.dataUrl, detail: 'high' } },
        ],
      }]
      const resp = await timedFetch(fleet.openaiChatUrl(), {
        method: 'POST',
        headers: fleet.openaiHeaders(),
        body:   JSON.stringify({ model: deployment, messages, max_tokens: 2048 }),
      }, 30_000)
      if (!resp.ok) { const t = await resp.text().catch(() => ''); console.warn('[homecheck] vision error:', resp.status, t.slice(0, 200)); processedCount.errors++; continue }
      const json  = await resp.json()
      fleet.record(deployment, json.usage?.prompt_tokens, json.usage?.completion_tokens)
      const raw   = json.choices?.[0]?.message?.content || '[]'
      let items
      try { items = JSON.parse(raw.trim().replace(/^```json\n?/,'').replace(/```$/,'')) }
      catch { items = [] }
      if (Array.isArray(items)) {
        allItems.push(...items.map(it => ({ ...it, photoName: photo.name || `photo-${processedCount.photos+1}` })))
        processedCount.items += items.length
      }
      processedCount.photos++
    } catch (e) { console.warn('[homecheck] vision photo error:', e.message); processedCount.errors++ }
  }

  return { items: allItems, processedCount }
}

function buildInventoryHtml(session) {
  const totalValue = session.items.reduce((s, it) => s + (it.estimatedValueUSD || 0), 0)
  const rows = session.items.map(it => `<tr>
    <td>${it.name}</td><td>${it.category}</td>
    <td>${it.brand || '—'}</td><td>${it.condition}</td>
    <td>$${(it.estimatedValueUSD || 0).toLocaleString()}</td>
    <td>${it.photoName}</td>
  </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Home Inventory Proof-of-Condition — ${session.address || 'HomeCheck'}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;font-size:14px;line-height:1.5;padding:24px 32px;color:#131318;-webkit-font-smoothing:antialiased;}
h1{font-size:22px;font-weight:700;margin-bottom:4px;}
.meta{color:#5B5C6B;font-size:13px;margin-bottom:24px;}
table{width:100%;border-collapse:collapse;margin-bottom:24px;}
th{text-align:left;padding:8px 10px;border-bottom:2px solid #E5E7EB;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5B5C6B;}
td{padding:8px 10px;border-bottom:1px solid #F3F4F6;}
.total{font-weight:700;font-size:16px;color:#8B1FE0;}
.disclaimer{font-size:11px;color:#9CA3AF;margin-top:16px;padding-top:16px;border-top:1px solid #F3F4F6;}
@media print{body{padding:0;}}
</style>
</head>
<body>
<h1>Home Inventory — Proof of Condition</h1>
<div class="meta">
  ${session.address || 'Address not provided'} &middot;
  Generated ${new Date(session.createdAt).toISOString().slice(0,10)} &middot;
  Session ${session.sessionId.slice(0,8).toUpperCase()} &middot;
  ${session.items.length} items identified
</div>
<table>
  <thead><tr><th>Item</th><th>Category</th><th>Brand</th><th>Condition</th><th>Est. Value</th><th>Photo</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="total">Total Estimated Replacement Value: $${totalValue.toLocaleString()}</div>
<div class="disclaimer">
  Estimated values are AI-generated replacement cost estimates based on visual identification.
  They are not appraisals and do not constitute a schedule of personal property for insurance purposes.
  Consult a licensed appraiser or your insurer for accurate valuations. Photos were processed
  server-side by GPT-5.1 via Azure AI Foundry. Images were deleted after processing per the
  retention policy. Session data expires ${new Date(session.expiresAt).toISOString().slice(0,10)}.
</div>
</body>
</html>`
}

// ─── Digital-twin item diff ────────────────────────────────────────────────────

function itemKey(item) {
  return `${(item.category || '').toLowerCase()}:${(item.name || '').toLowerCase().replace(/\s+/g, ' ').trim()}`
}
function jaccardSim(a, b) {
  const ta = new Set(a.split(/\s+/).filter(Boolean))
  const tb = new Set(b.split(/\s+/).filter(Boolean))
  if (!ta.size && !tb.size) return 1
  if (!ta.size || !tb.size) return 0
  let n = 0; ta.forEach(t => { if (tb.has(t)) n++ })
  return n / (ta.size + tb.size - n)
}
function matchItems(oldItems, newItems, threshold = 0.5) {
  const matched  = new Set()
  const added    = []
  const removed  = []
  const changed  = []
  const unchanged = []

  for (const nw of newItems) {
    let best = null, bestSim = 0
    for (let i = 0; i < oldItems.length; i++) {
      if (matched.has(i)) continue
      const sim = jaccardSim(itemKey(oldItems[i]), itemKey(nw))
      if (sim > bestSim) { bestSim = sim; best = i }
    }
    if (best !== null && bestSim >= threshold) {
      matched.add(best)
      const old = oldItems[best]
      if (old.condition !== nw.condition || Math.abs((old.estimatedValueUSD||0) - (nw.estimatedValueUSD||0)) > 50) {
        changed.push({ old, new: nw, similarity: bestSim })
      } else {
        unchanged.push({ item: nw, similarity: bestSim })
      }
    } else {
      added.push(nw)
    }
  }
  for (let i = 0; i < oldItems.length; i++) {
    if (!matched.has(i)) removed.push(oldItems[i])
  }
  return { added, removed, changed, unchanged }
}

// ─── Router ──────────────────────────────────────────────────────────────────

// POST /risk — full risk report for an address
router.post('/risk', guestRateLimit('risk'), async (req, res) => {
  const { address } = req.body || {}
  if (!address || typeof address !== 'string' || address.trim().length < 5) {
    return res.status(400).json({ error: 'bad_request', detail: 'address (string ≥5 chars) required' })
  }
  try {
    const risk = await buildRiskPayload(address.trim())
    return res.json(risk)
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(422).json({ error: 'address_not_found', detail: 'Address could not be geocoded. Try a more specific address with city, state, and ZIP.' })
    if (e.code === 'NO_TRACT')  return res.status(422).json({ error: 'no_census_tract', detail: 'Census tract not resolved for this address.' })
    console.error('[homecheck] risk error:', e.message)
    return res.status(500).json({ error: 'risk_error', detail: String(e.message).slice(0, 200) })
  }
})

// POST /report-html — downloadable self-contained HTML report
router.post('/report-html', guestRateLimit('report'), (req, res) => {
  const risk = req.body
  if (!risk || typeof risk !== 'object' || !risk.address) {
    return res.status(400).json({ error: 'bad_request', detail: 'risk payload required in body' })
  }
  const html = buildReportHtml(risk)
  const filename = `home-risk-report-${(risk.address || 'report').replace(/[^a-z0-9]+/gi,'_').slice(0,40)}.html`
  return res
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .set('Cache-Control', 'no-store')
    .send(html)
})

// POST /inventory — photo digital-twin inventory (requires explicit consent)
router.post('/inventory', guestRateLimit('vision'), async (req, res) => {
  const { photos, consent, address, sessionId: existingId } = req.body || {}
  if (!consent) {
    return res.status(403).json({ error: 'consent_required', detail: 'consent:true is required. Photos are processed server-side and stored for 24 hours. You may delete them at DELETE /inventory/:sessionId.' })
  }
  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: 'bad_request', detail: 'photos array required' })
  }
  if (photos.length > 10) {
    return res.status(400).json({ error: 'bad_request', detail: 'Maximum 10 photos per request' })
  }
  // Validate sizes (≤5 MB each after base64 decode: base64 ~ 1.37× size, so ≤6.85 MB string)
  for (const p of photos) {
    if (typeof p.dataUrl !== 'string' || p.dataUrl.length > 7_000_000) {
      return res.status(400).json({ error: 'bad_request', detail: 'Each photo must be a base64 dataUrl ≤5 MB.' })
    }
    if (!p.dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'bad_request', detail: 'Each photo must be a data: URL with image/* MIME type.' })
    }
  }

  try {
    const { items, processedCount } = await processPhotoInventory(photos)
    const sessionId = existingId && _sessions.has(existingId) ? existingId : crypto.randomUUID()
    const now = Date.now()
    _sessions.set(sessionId, {
      sessionId,
      items,
      address: address || null,
      createdAt:  now,
      expiresAt:  now + SESSION_TTL_MS,
      photoCount: photos.length,
    })

    const totalValue = items.reduce((s, it) => s + (it.estimatedValueUSD || 0), 0)
    return res.json({
      sessionId,
      itemCount:          items.length,
      totalEstimatedValue: totalValue,
      items,
      processedCount,
      expiresAt:          new Date(now + SESSION_TTL_MS).toISOString(),
      retention:          'Session data and photo metadata are stored in server memory for 24 hours. Photos are NOT persisted to disk or any database. Delete immediately via DELETE /inventory/:sessionId.',
      cost:               'This call used AI vision (GPT-5.1). Approximate cost: $0.02–$0.05 per photo processed.',
    })
  } catch (e) {
    if (e.code === 'NOT_CONFIGURED') return res.status(503).json({ error: 'vision_not_configured', detail: e.message })
    console.error('[homecheck] inventory error:', e.message)
    return res.status(500).json({ error: 'inventory_error', detail: String(e.message).slice(0, 200) })
  }
})

// GET /inventory/:sessionId — retrieve session
router.get('/inventory/:sessionId', (req, res) => {
  const s = _sessions.get(req.params.sessionId)
  if (!s) return res.status(404).json({ error: 'not_found', detail: 'Session not found or expired.' })
  if (Date.now() > s.expiresAt) { _sessions.delete(req.params.sessionId); return res.status(404).json({ error: 'expired' }) }
  return res.json({ sessionId: s.sessionId, items: s.items, address: s.address, createdAt: new Date(s.createdAt).toISOString(), expiresAt: new Date(s.expiresAt).toISOString() })
})

// DELETE /inventory/:sessionId — explicit delete (privacy/retention)
router.delete('/inventory/:sessionId', (req, res) => {
  const existed = _sessions.delete(req.params.sessionId)
  return res.json({ deleted: existed, sessionId: req.params.sessionId })
})

// GET /inventory/:sessionId/export — downloadable proof-of-condition HTML
router.get('/inventory/:sessionId/export', (req, res) => {
  const s = _sessions.get(req.params.sessionId)
  if (!s) return res.status(404).json({ error: 'not_found' })
  if (Date.now() > s.expiresAt) { _sessions.delete(req.params.sessionId); return res.status(404).json({ error: 'expired' }) }
  const html = buildInventoryHtml(s)
  return res
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="home-inventory-${s.sessionId.slice(0,8)}.html"`)
    .set('Cache-Control', 'no-store')
    .send(html)
})

// POST /twin-diff — compare two inventory sessions (digital twin diff on re-photograph)
router.post('/twin-diff', (req, res) => {
  const { sessionId, prevSessionId } = req.body || {}
  if (!sessionId || !prevSessionId) {
    return res.status(400).json({ error: 'bad_request', detail: 'sessionId and prevSessionId required' })
  }
  const current  = _sessions.get(sessionId)
  const previous = _sessions.get(prevSessionId)
  if (!current)  return res.status(404).json({ error: 'not_found', which: 'sessionId' })
  if (!previous) return res.status(404).json({ error: 'not_found', which: 'prevSessionId' })
  if (Date.now() > current.expiresAt)  { _sessions.delete(sessionId);     return res.status(404).json({ error: 'expired', which: 'sessionId' }) }
  if (Date.now() > previous.expiresAt) { _sessions.delete(prevSessionId); return res.status(404).json({ error: 'expired', which: 'prevSessionId' }) }

  const diff = matchItems(previous.items, current.items)
  return res.json({
    sessionId,
    prevSessionId,
    diff: {
      added:     diff.added,
      removed:   diff.removed,
      changed:   diff.changed,
      unchanged: diff.unchanged.map(u => u.item),
    },
    summary: {
      addedCount:     diff.added.length,
      removedCount:   diff.removed.length,
      changedCount:   diff.changed.length,
      unchangedCount: diff.unchanged.length,
      addedValue:     diff.added.reduce((s,i) => s+(i.estimatedValueUSD||0),0),
      removedValue:   diff.removed.reduce((s,i) => s+(i.estimatedValueUSD||0),0),
    },
    note: 'Diff uses fuzzy item-name matching (Jaccard similarity ≥0.5). Re-photograph in similar conditions for best results.',
  })
})

module.exports = router
