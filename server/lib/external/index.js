'use strict'
// external/index.js — the external data-source inventory, one namespace per source.
// Usage: const external = require('./external')  →  external.edgar.lossRatio('PGR')
// See ./README.md for the full per-function reference (params, returns, env, probes).

module.exports = {
  /** Foundry specialty AI surfaces: deepReason, verifyJudge, embedQuality, rerank, documentOcr */
  foundry: require('./foundry'),
  /** SEC EDGAR XBRL — public carrier financials: lookupCik, companyFacts, lossRatio */
  edgar: require('./edgar'),
  /** TX DOI SERFF filing metadata (Socrata): latestFilings, rateChanges */
  txFilings: require('./txFilings'),
  /** NHTSA vPIC VIN decode: decodeVin */
  vpic: require('./vpic'),
  /** Azure Maps geocoding fallback: geocode (needs AZURE_MAPS_KEY) */
  azureMaps: require('./azureMaps'),
  /** Federal hazard stack: censusGeocode, nriByTract, floodZone, disasterDeclarations, nfipClaims, quakes, nwsAlerts */
  hazards: require('./hazards'),
  /** NewsData.io industry news: latest (needs NEWSDATA_API_KEY) */
  newsdata: require('./newsdata'),
}
