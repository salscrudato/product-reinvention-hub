'use strict'
// external/txFilings.js — Texas DOI rate filings (Socrata open data): the scriptable
// answer to "pull a company's latest SERFF filings". SERFF itself has NO public API —
// TDI republishes filing metadata (with SERFF tracking IDs) on data.texas.gov, updated
// daily. Rows pair with serff.js, which GENERATES Texas bundles; this module RETRIEVES.
//
// Keyless (anonymous = throttled); set SOCRATA_APP_TOKEN to lift the rate limit (free).
// Probe-verified 2026-07-15 (State Farm rows with serff_id, % change, status).

const DATASETS = {
  /** All P&C lines: commercial + personal. */
  PC: 'ittv-5xew',
  /** Homeowners + personal auto only (narrower, same shape). */
  HOME_AUTO: 'iubg-btfs',
}

const BASE = 'https://data.texas.gov/resource'

function headers() {
  const h = { Accept: 'application/json' }
  if (process.env.SOCRATA_APP_TOKEN) h['X-App-Token'] = process.env.SOCRATA_APP_TOKEN
  return h
}

// SoQL string literal: single quotes escape by doubling.
const soqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

function normalize(row) {
  return {
    companyName: row.company_name,
    serffId: row.serff_id,
    receivedDate: row.received_date,
    productName: row.product_name,
    line: row.state_type_of_insurance,
    subLine: row.state_subtype_of_insurance,
    percentChange: typeof row.percent_change === 'string' ? Number(row.percent_change.replace(/[%\s]/g, '')) : row.percent_change,
    effectiveNewBusiness: row.effective_date_new_business,
    effectiveRenewal: row.effective_date_renewal,
    status: row.status,
    closedType: row.closed_type,
  }
}

/** Latest Texas rate filings, optionally filtered by company and/or line of insurance.
 *  @param {object}  [opts]
 *  @param {string}  [opts.company]  - substring match on company name (case-insensitive)
 *  @param {string}  [opts.line]     - exact state_type_of_insurance (e.g. 'Homeowners')
 *  @param {number}  [opts.limit=25]
 *  @param {'PC'|'HOME_AUTO'} [opts.dataset='PC']
 *  @returns {Promise<Array>} normalized rows, newest received_date first */
async function latestFilings(opts = {}) {
  const dataset = DATASETS[opts.dataset || 'PC']
  const where = []
  if (opts.company) where.push(`UPPER(company_name) like ${soqlQuote('%' + String(opts.company).toUpperCase() + '%')}`)
  if (opts.line) where.push(`state_type_of_insurance = ${soqlQuote(opts.line)}`)
  const params = new URLSearchParams({ $limit: String(opts.limit ?? 25), $order: 'received_date DESC' })
  if (where.length) params.set('$where', where.join(' AND '))
  const res = await fetch(`${BASE}/${dataset}.json?${params}`, { headers: headers(), signal: AbortSignal.timeout(10_000) })
  if (!res.ok) { const e = new Error(`tx_filings_${res.status}`); e.status = res.status; throw e }
  return (await res.json()).map(normalize)
}

/** Only filings that carry a non-zero rate change — competitor rate-move monitoring.
 *  Same options as latestFilings (fetches a wider window, then filters). */
async function rateChanges(opts = {}) {
  const rows = await latestFilings({ ...opts, limit: Math.max(100, opts.limit ?? 100) })
  return rows.filter(r => Number.isFinite(r.percentChange) && r.percentChange !== 0)
    .slice(0, opts.limit ?? 25)
}

module.exports = { DATASETS, latestFilings, rateChanges }
