'use strict'
// external/edgar.js — SEC EDGAR XBRL client: public insurance-carrier financials.
// Free, keyless; SEC requires a descriptive User-Agent (EDGAR_USER_AGENT overrides).
// Public carriers only (PGR, ALL, TRV, CB, HIG, …) — mutuals (e.g. State Farm) and
// statutory Schedule P detail live in paid NAIC data, not EDGAR.
//
// Probe-verified 2026-07-15: PGR FY2025 loss ratio 66.1% computed from live facts.

const UA = () => process.env.EDGAR_USER_AGENT || 'ProductReinventionHub research (contact: ops@prodhub.local)'

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA(), Accept: 'application/json' } })
  if (!res.ok) { const e = new Error(`edgar_${res.status}: ${url}`); e.status = res.status; throw e }
  return res.json()
}

let tickerCache = null // { TICKER: { cik, name } } — SEC file is ~1MB; cache per process

/** Resolve a ticker symbol to { cik, name } (10-digit zero-padded CIK). Null if unknown. */
async function lookupCik(ticker) {
  if (!tickerCache) {
    const raw = await getJson('https://www.sec.gov/files/company_tickers.json')
    tickerCache = {}
    for (const row of Object.values(raw)) {
      tickerCache[String(row.ticker).toUpperCase()] = { cik: String(row.cik_str).padStart(10, '0'), name: row.title }
    }
  }
  return tickerCache[String(ticker).toUpperCase()] || null
}

/** Full XBRL company facts for a CIK (accepts unpadded). Large payload (~MBs). */
async function companyFacts(cik) {
  const padded = String(cik).replace(/\D/g, '').padStart(10, '0')
  return getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`)
}

// Tag preference order: P&C-specific first, then the generic insurance tags.
const PREMIUM_TAGS = ['PremiumsEarnedNetPropertyAndCasualty', 'PremiumsEarnedNet']
const LOSS_TAGS    = ['IncurredClaimsPropertyCasualtyAndLiability', 'PolicyholderBenefitsAndClaimsIncurredNet']

function latestAnnual(gaap, tags) {
  for (const tag of tags) {
    const usd = gaap[tag]?.units?.USD
    if (!usd?.length) continue
    const annual = usd.filter(x => x.form === '10-K' && x.fp === 'FY')
    const pick = (annual.length ? annual : usd).sort((a, b) => String(b.end).localeCompare(String(a.end)))[0]
    if (pick) return { tag, end: pick.end, val: pick.val }
  }
  return null
}

/** Latest-annual loss ratio for a public carrier, by ticker or CIK.
 *  @param {string} tickerOrCik - e.g. 'PGR' or '80661'
 *  @returns {Promise<{ company, fiscalYearEnd, premiumsEarnedUsd, lossesIncurredUsd,
 *                      lossRatioPct, premiumTag, lossTag } | null>} null = tags unavailable */
async function lossRatio(tickerOrCik) {
  const byTicker = /[a-z]/i.test(tickerOrCik) ? await lookupCik(tickerOrCik) : null
  const cik = byTicker ? byTicker.cik : tickerOrCik
  const facts = await companyFacts(cik)
  const gaap = facts.facts?.['us-gaap'] || {}
  const prem = latestAnnual(gaap, PREMIUM_TAGS)
  const loss = latestAnnual(gaap, LOSS_TAGS)
  if (!prem || !loss) return null
  return {
    company: facts.entityName,
    fiscalYearEnd: prem.end,
    premiumsEarnedUsd: prem.val,
    lossesIncurredUsd: loss.val,
    lossRatioPct: Math.round((1000 * loss.val) / prem.val) / 10,
    premiumTag: prem.tag,
    lossTag: loss.tag,
  }
}

module.exports = { lookupCik, companyFacts, lossRatio }
