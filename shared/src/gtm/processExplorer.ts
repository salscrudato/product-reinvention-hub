// processExplorer.ts — the DETERMINISTIC converter from a Process Value Explorer "Report"
// sheet (the governed L1 "Product Manufacture" process asset) into the GTM launch-tracker's
// template tasks. Pure + platform-free: it consumes already-parsed rows (the thin exceljs
// reader lives in scripts/genGtmProcess.ts) and returns GtmTemplateTask[]. This is the ONE
// place the workbook's columns become tasks, so the mapping is unit-tested in the gate and
// re-run offline to regenerate shared/src/seed/gtmProcess.ts. Zero platform imports.
//
// THE 4E POINT: a row disposed **Exclude** never becomes a task — the platform automates the
// work it should Embrace / Elevate / Enhance and drops the work it should Exclude. The three
// surviving dispositions ride onto each task for the board's 4E filter + tint.
//
// Column mapping (Report sheet → GtmTemplateTask):
//   Level 2 Name          → phaseL2            Level 3 Name       → groupL3
//   Level 4 Name          → taskL4 (+ title)   Point of Contact   → owner (primary role)
//   SLA (in Days)         → slaDays (group-deduped; blank → DEFAULT_SLA_DAYS; "ongoing" → 0+ongoing)
//   Type of Work          → typeOfWork         Value of Work      → valueOfWork
//   4E                    → disposition (Exclude dropped)
//   L2 phase index        → phaseOrder (1..5; the scheduler's pre/post-launch pivot)
// The Complex/Simple ActivityFlow indices order the source rows (the sequence globalOrder
// preserves); phaseOrder is the L2 phase so the back-scheduler's ≤4 pre-launch / 5 governance
// split keeps working.
import type { GtmTemplateTask, GtmBoardColumn, GtmPhase } from './types'
import { GTM_PHASE_ORDER } from './types'
import type { TypeOfWork, ValueOfWork, Disposition } from '../types'

/** One raw Report-sheet row (cell values already coerced to string/number by the reader). */
export interface ProcessExplorerRow {
  level1:          string
  level2:          string
  level3:          string
  level4:          string
  level1Desc?:     string
  level2Desc?:     string
  level3Desc?:     string
  level4Desc?:     string
  pointOfContact:  string
  sla:             string | number   // a number, "ongoing", or "" (blank)
  typeOfWork:      string
  valueOfWork:     string
  disposition:     string            // Embrace | Elevate | Enhance | Exclude | ""
  complexFlow?:    string            // Complex ActivityFlow order index (informative)
  simpleFlow?:     string            // Simple ActivityFlow order index (informative)
}

/** Documented default when the SLA cell is blank: 0 business days (a stage gate / milestone
 *  consumes no scheduled time; the scheduler still gives every task a one-day minimum span). */
export const DEFAULT_SLA_DAYS = 0

const TYPE_OF_WORK  = new Set<string>(['Differentiating', 'Analytical', 'Transactional', 'Regulatory / Compliance'])
const VALUE_OF_WORK = new Set<string>(['Enables', 'Directly Contributes', 'Neutral'])
const DISPOSITION   = new Set<string>(['Embrace', 'Elevate', 'Enhance', 'Exclude'])

// L2 phase → base board column. Product Launch splits: go-live tasks land in LAUNCH & MONITOR,
// the rest (training, roll-out planning, dev/test/acceptance) in TEST & APPROVE; governance is
// LAUNCH & MONITOR. Matches the approved column mapping in the process asset's meta block.
const PHASE_COLUMN: Record<string, GtmBoardColumn> = {
  'Product Research':                'IDEATION & DESIGN',
  'Product Design':                  'IDEATION & DESIGN',
  'Product Definition':              'BUILD & FILE',
  'Product Launch':                  'TEST & APPROVE',
  'Product Governance & Monitoring': 'LAUNCH & MONITOR',
}
// The go-live tasks within Product Launch that belong in LAUNCH & MONITOR (the launch moment).
const GO_LIVE_RE = /manage product launch|deploy to production|decide to roll-?out/i

/** "Chief Product Officer (Primary); Strategy Lead" → "Chief Product Officer". Blank → "Unassigned". */
function primaryContact(poc: string): string {
  const first = (poc ?? '').split(';')[0] ?? ''
  return first.replace(/\s*\(primary\)\s*/i, '').trim() || 'Unassigned'
}

/** Coerce the SLA cell: a number stays; "ongoing" → 0 days + ongoing flag; blank → the
 *  documented default; any other string parses as a number (else the default). */
function parseSla(sla: string | number): { slaDays: number; ongoing: boolean } {
  if (typeof sla === 'number') return { slaDays: Number.isFinite(sla) ? sla : DEFAULT_SLA_DAYS, ongoing: false }
  const s = String(sla ?? '').trim()
  if (/ongoing/i.test(s)) return { slaDays: 0, ongoing: true }
  if (s === '') return { slaDays: DEFAULT_SLA_DAYS, ongoing: false }
  const n = Number(s)
  return { slaDays: Number.isFinite(n) ? n : DEFAULT_SLA_DAYS, ongoing: false }
}

const asTypeOfWork  = (v: string): TypeOfWork | ''  => TYPE_OF_WORK.has(v.trim())  ? (v.trim() as TypeOfWork)  : ''
const asValueOfWork = (v: string): ValueOfWork | '' => VALUE_OF_WORK.has(v.trim()) ? (v.trim() as ValueOfWork) : ''
const asDisposition = (v: string): Disposition | '' => DISPOSITION.has(v.trim())   ? (v.trim() as Disposition) : ''

/**
 * Convert Process Value Explorer rows to the ordered GTM template tasks.
 *  - Rows disposed **Exclude** are dropped (the 4E point). Header / type-hint / blank rows
 *    (no Level 4 name) are skipped.
 *  - A group's SLA is expressed on every row of the group; it is assigned to the FIRST KEPT
 *    task of the group (siblings 0) so the back-schedule consumes each group's SLA once, not
 *    SLA × rows. `ongoing` (governance) tasks carry no SLA.
 *  - Output order (globalOrder) preserves the input row order (the workbook's Complex-flow
 *    sequence), and phaseOrder is the L2 phase index (1..5).
 */
export function convertProcessExplorer(rows: ProcessExplorerRow[]): GtmTemplateTask[] {
  const out: GtmTemplateTask[] = []
  const groupSlaTaken = new Set<string>()   // (phaseL2 || groupL3) whose SLA has been placed
  let globalOrder = 0

  for (const row of rows) {
    const taskL4 = (row.level4 ?? '').trim()
    if (!taskL4) continue                                  // header / type-hint / empty row
    const disposition = asDisposition(row.disposition)
    if (disposition === 'Exclude') continue                // excluded work never becomes a task

    const phaseL2 = (row.level2 ?? '').trim()
    const groupL3 = (row.level3 ?? '').trim()
    const idx = GTM_PHASE_ORDER.indexOf(phaseL2 as GtmPhase)
    const phaseOrder = idx >= 0 ? idx + 1 : 1               // unknown phase → treat as first (pre-launch)
    const base = PHASE_COLUMN[phaseL2] ?? 'IDEATION & DESIGN'
    const boardColumn: GtmBoardColumn =
      phaseL2 === 'Product Launch' && GO_LIVE_RE.test(taskL4) ? 'LAUNCH & MONITOR' : base

    const { slaDays: rawSla, ongoing } = parseSla(row.sla)
    const groupKey = `${phaseL2} || ${groupL3}`
    let slaDays = 0
    if (!ongoing && !groupSlaTaken.has(groupKey)) { slaDays = rawSla; groupSlaTaken.add(groupKey) }

    globalOrder += 1
    out.push({
      globalOrder,
      phaseL2, groupL3, taskL4,
      boardColumn, phaseOrder,
      slaDays, ongoing,
      owner:       primaryContact(row.pointOfContact),
      typeOfWork:  asTypeOfWork(row.typeOfWork),
      valueOfWork: asValueOfWork(row.valueOfWork),
      disposition,
    })
  }
  return out
}

/** Tally of kept vs dropped rows by 4E disposition — used by the generator's summary + the
 *  converter test. `Exclude` counts the rows dropped; every other key counts kept tasks. */
export function dispositionCounts(rows: ProcessExplorerRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (!(row.level4 ?? '').trim()) continue
    const d = asDisposition(row.disposition) || '(none)'
    counts[d] = (counts[d] ?? 0) + 1
  }
  return counts
}
