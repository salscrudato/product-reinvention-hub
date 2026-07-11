#!/usr/bin/env node
/**
 * hardening/convergence.mjs
 *
 * Parses hardening/ledger.md, recomputes the SUMMARY line (line 1) in place,
 * prints counts to stdout, and exits 1 if effective OPEN count > 0.
 *
 * WONTFIX entries without a "Sal-acknowledged: yes" line anywhere in their block
 * are counted as OPEN (unresolved).  This prevents unreviewed WONTFIXes from
 * silently clearing the gate.
 *
 * SUMMARY format (line 1 of ledger.md):
 *   SUMMARY: OPEN: n | CRITICAL: n | HIGH: n | MEDIUM: n | LOW: n | WONTFIX: n | FALSE-POSITIVE: n
 *
 * Where CRITICAL/HIGH/MEDIUM/LOW count open defects at each severity.
 * WONTFIX counts only acknowledged WONTFIXes (not counted in OPEN).
 * FALSE-POSITIVE counts entries closed as false positive.
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LEDGER = join(__dirname, 'ledger.md')

const VALID_STATUSES = new Set(['OPEN', 'FIXED', 'WONTFIX', 'FALSE-POSITIVE'])
const VALID_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])

function parseDefects(text) {
  const defects = []
  let current = null
  let inBlock = false

  for (const line of text.split('\n')) {
    const defMatch = line.match(/^###\s+(DEF-\d+)\s*$/)
    if (defMatch) {
      if (current) defects.push(current)
      current = { id: defMatch[1], status: null, severity: null, acknowledged: false }
      inBlock = true
      continue
    }
    // A new H2/H3 that is NOT a DEF block ends the current defect
    if (line.match(/^##+ /) && !defMatch) {
      if (current) { defects.push(current); current = null }
      inBlock = false
      continue
    }
    if (!inBlock || !current) continue

    const statusMatch = line.match(/^-\s+status:\s*(\S+)/)
    if (statusMatch) {
      const s = statusMatch[1].trim().toUpperCase()
      current.status = VALID_STATUSES.has(s) ? s : null
    }
    const sevMatch = line.match(/^-\s+severity:\s*(\S+)/)
    if (sevMatch) {
      const sv = sevMatch[1].trim().toUpperCase()
      current.severity = VALID_SEVERITIES.has(sv) ? sv : null
    }
    if (line.trim() === 'Sal-acknowledged: yes') {
      current.acknowledged = true
    }
  }
  if (current) defects.push(current)
  return defects
}

function compute(defects) {
  const counts = { OPEN: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, WONTFIX: 0, 'FALSE-POSITIVE': 0 }

  for (const d of defects) {
    if (!d.status) continue

    const isUnacknowledgedWontfix = d.status === 'WONTFIX' && !d.acknowledged
    const effectiveStatus = isUnacknowledgedWontfix ? 'OPEN' : d.status

    if (effectiveStatus === 'OPEN') {
      counts.OPEN++
      if (d.severity) counts[d.severity]++
    } else if (effectiveStatus === 'WONTFIX') {
      counts.WONTFIX++
    } else if (effectiveStatus === 'FALSE-POSITIVE') {
      counts['FALSE-POSITIVE']++
    }
    // FIXED entries do not increment any displayed counter
  }

  return counts
}

function formatSummary(c) {
  return `SUMMARY: OPEN: ${c.OPEN} | CRITICAL: ${c.CRITICAL} | HIGH: ${c.HIGH} | MEDIUM: ${c.MEDIUM} | LOW: ${c.LOW} | WONTFIX: ${c.WONTFIX} | FALSE-POSITIVE: ${c['FALSE-POSITIVE']}`
}

// ─── main ──────────────────────────────────────────────────────────────────────

let text
try {
  text = readFileSync(LEDGER, 'utf8')
} catch (e) {
  console.error(`convergence: cannot read ${LEDGER}: ${e.message}`)
  process.exit(2)
}

const defects = parseDefects(text)
if (defects.length === 0) {
  console.error('convergence: no DEF-XXXX blocks found in ledger.md')
  process.exit(2)
}

const counts = compute(defects)
const summary = formatSummary(counts)

// Rewrite line 1 in place (the SUMMARY line)
const lines = text.split('\n')
lines[0] = summary
const updated = lines.join('\n')
writeFileSync(LEDGER, updated, 'utf8')

// Print results
console.log(summary)
console.log(`\nDefect breakdown (${defects.length} total):`)
for (const d of defects) {
  const isUnacknowledgedWontfix = d.status === 'WONTFIX' && !d.acknowledged
  const effectiveStatus = isUnacknowledgedWontfix ? 'OPEN (WONTFIX/unacknowledged)' : (d.status ?? 'UNKNOWN')
  console.log(`  ${d.id}  ${d.severity ?? '?'}  ${effectiveStatus}`)
}

if (counts.OPEN > 0) {
  console.error(`\nconvergence: OPEN defects remain (${counts.OPEN}). Fix or acknowledge before shipping.`)
  process.exit(1)
} else {
  console.log('\nconvergence: all defects resolved. Gate green.')
  process.exit(0)
}
