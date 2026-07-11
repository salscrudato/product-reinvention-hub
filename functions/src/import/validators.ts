// import/validators.ts — deterministic, non-AI structural validators for the import pipeline.
//
// These are the authoritative judges on numeric tables and rate-program structure.
// They run before any AI-proposed mapping is accepted and can VETO it.
// The invariant: consensus is not verification; deterministic checks are final.
//
// API contract:
//   • ValidatorResult.ok === false  → mapping vetoed (at least one 'error' violation)
//   • ValidatorResult.ok === true   → accepted (may still carry 'warning' violations)
//   • Pure TypeScript — no I/O, no async, no AI calls.

import type { RatingStep } from '@pf/shared'

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ValidatorViolation {
  check:     string     // which validator fired (e.g. 'checkMonotonicity')
  message:   string
  location?: string     // row index, column name, or step label
  severity:  'error' | 'warning'
}

export interface ValidatorResult {
  ok:         boolean               // false when any 'error' violation exists
  violations: ValidatorViolation[]
}

function passResult(): ValidatorResult { return { ok: true, violations: [] } }

function buildResult(violations: ValidatorViolation[]): ValidatorResult {
  return {
    ok:         violations.every(v => v.severity === 'warning'),
    violations,
  }
}

// ─── 1. Sum consistency ───────────────────────────────────────────────────────

/** Verify that `rows[].value` sums to `declaredTotal` within `tolerance`.
 *  P&C premium schedule tables carry declared sub-totals; a mismatch means the AI
 *  mis-mapped a row or a cell was silently skipped. */
export function checkSumConsistency(
  rows:          { label: string; value: number }[],
  declaredTotal: number,
  tolerance      = 0.01,
): ValidatorResult {
  if (rows.length === 0) return passResult()
  const sum  = rows.reduce((acc, r) => acc + r.value, 0)
  const diff = Math.abs(sum - declaredTotal)
  if (diff <= tolerance) return passResult()
  return buildResult([{
    check:    'checkSumConsistency',
    message:  `Row sum ${sum.toFixed(4)} differs from declared total ${declaredTotal.toFixed(4)} by ${diff.toFixed(4)}`,
    severity: 'error',
  }])
}

// ─── 2. Monotonicity ──────────────────────────────────────────────────────────

/** Verify that a factor curve is monotone (non-decreasing or non-increasing).
 *  Key-factor curves indexed by coverage amount MUST be monotone; a violation
 *  signals a mis-mapped row, a hidden-sheet tab included in the wrong position,
 *  or a transposed table being read in the wrong orientation. */
export function checkMonotonicity(
  values:    number[],
  direction: 'increasing' | 'decreasing' | 'auto',
  labels?:   string[],
): ValidatorResult {
  if (values.length < 2) return passResult()

  const effectiveDir: 'increasing' | 'decreasing' =
    direction === 'auto'
      ? (values[0]! <= values[values.length - 1]! ? 'increasing' : 'decreasing')
      : direction

  const violations: ValidatorViolation[] = []
  for (let i = 1; i < values.length; i++) {
    const prev  = values[i - 1]!
    const curr  = values[i]!
    const label = labels ? `row "${labels[i] ?? String(i)}"` : `index ${i}`
    const violated =
      effectiveDir === 'increasing' ? curr < prev - 1e-9 : curr > prev + 1e-9
    if (violated) {
      violations.push({
        check:    'checkMonotonicity',
        message:  `Factor ${curr} at ${label} violates ${effectiveDir} monotonicity (previous was ${prev})`,
        location: label,
        severity: 'error',
      })
    }
  }
  return violations.length ? buildResult(violations) : passResult()
}

// ─── 3. Rate-order completeness ───────────────────────────────────────────────

/** Verify the rating program contains the required op sequence.
 *  Every P&C rating program must: start with a SET (base rate/loss cost), apply at
 *  least one MUL (relativities), and floor with MIN_FLOOR (minimum premium).
 *  A program missing any of these is incomplete and must not be auto-accepted. */
export function checkRateOrderCompleteness(
  steps:    Pick<RatingStep, 'op' | 'label'>[],
  required: readonly string[] = ['SET', 'MUL', 'MIN_FLOOR'],
): ValidatorResult {
  if (steps.length === 0) {
    return buildResult([{
      check:    'checkRateOrderCompleteness',
      message:  'Rating program has no steps — nothing to import',
      severity: 'error',
    }])
  }
  const ops = new Set<string>(steps.map(s => s.op))
  const violations: ValidatorViolation[] = []
  for (const req of required) {
    if (!ops.has(req)) {
      violations.push({
        check:    'checkRateOrderCompleteness',
        message:  `Required op "${req}" is absent from the proposed rating program`,
        severity: 'error',
      })
    }
  }
  return violations.length ? buildResult(violations) : passResult()
}

// ─── 4. Cross-foot totals ─────────────────────────────────────────────────────

/** Verify row sums equal declared rowTotals and column sums equal colTotals.
 *  Cross-footing is the standard audit on P&C rate tables: the corner cell
 *  (total-of-totals) must match both the row-total column and the column-total row. */
export function checkCrossFootTotals(
  cells:      number[][],   // [row][col] matrix of numeric values
  rowTotals?: number[],     // expected sum per row (length === cells.length)
  colTotals?: number[],     // expected sum per col (length === cells[0]?.length)
  tolerance   = 0.01,
): ValidatorResult {
  const violations: ValidatorViolation[] = []

  if (rowTotals) {
    for (let r = 0; r < cells.length; r++) {
      const row      = cells[r] ?? []
      const sum      = row.reduce((a, v) => a + v, 0)
      const expected = rowTotals[r] ?? 0
      if (Math.abs(sum - expected) > tolerance) {
        violations.push({
          check:    'checkCrossFootTotals',
          message:  `Row ${r} sum ${sum.toFixed(4)} ≠ declared total ${expected.toFixed(4)}`,
          location: `row:${r}`,
          severity: 'error',
        })
      }
    }
  }

  if (colTotals && cells.length > 0) {
    const numCols = cells[0]!.length
    for (let c = 0; c < numCols; c++) {
      const sum      = cells.reduce((a, row) => a + (row[c] ?? 0), 0)
      const expected = colTotals[c] ?? 0
      if (Math.abs(sum - expected) > tolerance) {
        violations.push({
          check:    'checkCrossFootTotals',
          message:  `Column ${c} sum ${sum.toFixed(4)} ≠ declared total ${expected.toFixed(4)}`,
          location: `col:${c}`,
          severity: 'error',
        })
      }
    }
  }

  return violations.length ? buildResult(violations) : passResult()
}

// ─── 5. Transpose detection ───────────────────────────────────────────────────

/** Detect if a rate table appears transposed (rows and columns swapped).
 *  This happens when a carrier pivots a factor matrix for compactness — the
 *  state dimension becomes columns and the factor dimension becomes rows, or vice versa.
 *
 *  Heuristic: ≥ 50% of the first row's cells are numeric (unusual for a header row)
 *  AND the first column contains string label values.
 *
 *  A transposed table read straight would silently map territory labels as factor keys
 *  and factor values as territory codes — a silent mis-map that no AI check catches. */
export function detectTranspose(
  headerRow:  unknown[],
  sampleRows: unknown[][],
): { likelyTransposed: boolean; reason?: string } {
  if (headerRow.length === 0) return { likelyTransposed: false }

  const numericHeaderCount = headerRow.filter(v =>
    typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(String(v).trim()))
  ).length
  const headerNumericFraction = numericHeaderCount / headerRow.length

  const firstColStringCount = sampleRows.filter(r =>
    typeof r[0] === 'string' && isNaN(Number(r[0]))
  ).length
  const firstColHasLabels = sampleRows.length > 0 && firstColStringCount / sampleRows.length > 0.5

  if (headerNumericFraction >= 0.5 && firstColHasLabels) {
    return {
      likelyTransposed: true,
      reason: `Header row is ${Math.round(headerNumericFraction * 100)}% numeric while the first column carries string labels — table is likely transposed and would mis-map factors as keys`,
    }
  }
  return { likelyTransposed: false }
}

// ─── 6. Merged-header detection ───────────────────────────────────────────────

/** Detect merged-cell artifacts in header rows.
 *  In Excel, a merged cell region has a value only in the top-left cell; the
 *  remaining cells appear as null when read by exceljs. A null cell that immediately
 *  follows a non-null cell in a header row is a strong merged-region signal.
 *
 *  A merged header spanning columns A–C means columns B and C have no name — the
 *  importer would silently produce anonymous columns and could merge factors from
 *  separate rate dimensions into a single unnamed column. */
export function detectMergedHeaders(
  headerRows: (unknown[] | null)[],
): { hasMergedHeaders: boolean; affectedColumns: number[] } {
  const affectedColumns = new Set<number>()

  for (const row of headerRows) {
    if (!row || row.length === 0) continue
    let inMerge = false
    for (let i = 0; i < row.length; i++) {
      const cell = row[i]
      if (cell !== null && cell !== undefined && cell !== '') {
        inMerge = true
      } else if (inMerge) {
        // Null after non-null in a header row → merge-artifact column
        affectedColumns.add(i)
      }
    }
  }

  return {
    hasMergedHeaders: affectedColumns.size > 0,
    affectedColumns:  Array.from(affectedColumns).sort((a, b) => a - b),
  }
}

// ─── 7. Rate-order variable resolution ───────────────────────────────────────

/** Verify that every variable referenced in the rate order has a resolved source.
 *  Unresolved variables that reach the rating program without a table or input
 *  source silently default to zero — suppressing premium without any error. */
export function checkVariableResolution(
  rateOrderVarNames: string[],
  resolvedKeys:      Set<string>,
): ValidatorResult {
  const violations: ValidatorViolation[] = []
  for (const name of rateOrderVarNames) {
    if (!resolvedKeys.has(name)) {
      violations.push({
        check:    'checkVariableResolution',
        message:  `Rate-order variable "${name}" has no resolved mapping — defaults to zero and silently suppresses premium`,
        location: name,
        severity: 'error',
      })
    }
  }
  return violations.length ? buildResult(violations) : passResult()
}
