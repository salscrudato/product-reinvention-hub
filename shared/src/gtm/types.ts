// GTM (go-to-market) launch-tracker domain — pure TypeScript, zero platform imports.
// The generic insurance product-manufacture process (L1 → L2 phase → L3 group → L4 task)
// plus the backward scheduler that lands the last pre-launch task exactly on the deadline.
// Consumed by both app/ (the Tasks board) and the seed/scheduler unit tests.
import type { TypeOfWork } from '../types'

// The four board columns, in the process's own label form. These map 1:1 onto the
// app's canonical `TaskColumn` enum via GTM_COLUMN_TO_TASK below (the board renders the
// existing enum; these strings are the process/template vocabulary).
export type GtmBoardColumn =
  | 'IDEATION & DESIGN'
  | 'BUILD & FILE'
  | 'TEST & APPROVE'
  | 'LAUNCH & MONITOR'

/** One template task in the L1 "Product Manufacture" process. `slaDays` drives the
 *  backward schedule; `phaseOrder` (1..5) splits pre-launch (≤4) from governance (5);
 *  `owner` is the owning role (a role, not a person); `ongoing` governance tasks have
 *  no due date. Field-for-field lossless from build/product-process-template.json. */
export interface GtmTemplateTask {
  globalOrder: number
  phaseL2:     string          // L2 phase, e.g. "Product Design"
  groupL3:     string          // L3 group, e.g. "Product Pricing"
  taskL4:      string          // L4 task — the card title
  boardColumn: GtmBoardColumn
  phaseOrder:  number          // 1..5; ≤4 = pre-launch, 5 = post-launch governance
  slaDays:     number          // business-day SLA (0 for milestone/rider tasks)
  ongoing:     boolean         // governance tasks with no fixed due date
  owner:       string          // owning role (short form), e.g. "Product Mgr."
  typeOfWork:  TypeOfWork | '' // '' = the un-typed stage-gate approval task
}

// ─── Phase + column metadata (from the template's meta block) ──────────────────

/** The five L2 phases in execution order. phaseOrder is the 1-based index here. */
export const GTM_PHASE_ORDER = [
  'Product Research',
  'Product Design',
  'Product Definition',
  'Product Launch',
  'Product Governance & Monitoring',
] as const
export type GtmPhase = (typeof GTM_PHASE_ORDER)[number]

/** The four board columns in left-to-right order. */
export const GTM_BOARD_COLUMNS: GtmBoardColumn[] = [
  'IDEATION & DESIGN',
  'BUILD & FILE',
  'TEST & APPROVE',
  'LAUNCH & MONITOR',
]

/** phaseOrder ≤ this is PRE-LAUNCH (back-scheduled to the deadline); above is POST-LAUNCH
 *  governance (forward-scheduled after the deadline). Launch is the pivot, not the end. */
export const GTM_PRELAUNCH_MAX_PHASE_ORDER = 4

// ─── Scheduler I/O ─────────────────────────────────────────────────────────────

/** A template task annotated with its computed schedule. Dates are ISO `yyyy-mm-dd`
 *  strings (timezone-free, deterministic). `dueDate` is null for ongoing governance. */
export interface ScheduledTask extends GtmTemplateTask {
  startDate: string | null
  dueDate:   string | null
}

/** Emitted when the deadline is sooner than the critical path needs. The schedule is
 *  still computed (starts may fall before `today`) — never silently corrupted. */
export interface ScheduleWarning {
  code:          'compressed'
  neededDays:    number   // = criticalPathDays (business days of pre-launch SLA)
  availableDays: number   // business days between today and the deadline
}

export interface ScheduleResult {
  tasks:            ScheduledTask[]
  projectStartDate: string | null   // earliest pre-launch start (or the deadline if none)
  criticalPathDays: number          // Σ pre-launch slaDays (business days)
  warnings:         ScheduleWarning[]
}

export interface ScheduleOptions {
  /** true (default) = count spans in business days (Mon–Fri); false = calendar days. */
  businessDays?: boolean
  /** Injected "today" so the scheduler is pure + deterministic (no Date.now inside). */
  today: string | Date
}
