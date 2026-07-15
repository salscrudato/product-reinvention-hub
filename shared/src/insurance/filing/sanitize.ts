// filing/sanitize.ts — the pure anti-fabrication guards for the CLASSIFY + EXTRACT stages,
// mirroring insurance/extraction.ts for the policy-form sections. They turn a model's raw
// forced-tool input into the typed FilingExtraction shapes, and in doing so enforce the same
// grounding contract the rest of the platform holds itself to:
//
//   • Every rate-order variable and every manual rule MUST carry a non-empty citation — items
//     without one are DROPPED here, in code, not merely discouraged in the prompt.
//   • Enums are coerced to the known vocabulary (never trusted raw); confidence is clamped.
//   • A manual table carries only a SCHEMA + a verbatim source region — never model-authored
//     rows. The deterministic parser (tableParser.ts) produces the rows; the model cannot
//     inject a factor here.
//   • concept and kind are backfilled deterministically from the registry (matchConcept /
//     classifyRuleNumber) when the model leaves them blank, so the reconcile join still works.
//
// Pure TypeScript; functions/ imports these, and the gate exercises them without a live model.
import type {
  FilingDocClassification, FilingDocRole, RateOrderExtraction, RateOrderVariable,
  ManualExtraction, ManualRule, ManualRuleKind, ManualTableSchema, FilingOp, RateOrderStage,
} from './types'
import { matchConcept, classifyRuleNumber } from './registry'

const str = (v: unknown): string => String(v ?? '').trim()
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const conf = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0 }
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

const ROLES = new Set<FilingDocRole>(['rateOrder', 'manual', 'policyForm', 'other'])
const STAGES = new Set<RateOrderStage>(['BASE_LOSS_COST', 'BASE_PREMIUM', 'ADJUSTED_BASE', 'INCREASED_LIMIT', 'ADDITIONAL_COVERAGE'])
const KINDS = new Set<ManualRuleKind>(['BASE_LOSS_COST', 'FACTOR_TABLE', 'SCALAR', 'DEDUCTIBLE', 'CREDIT_CAP', 'MIN_PREMIUM', 'PREMIUM_CAP', 'SCHEDULED_PROPERTY', 'PROTECTIVE_DEVICE', 'ENDORSEMENT_SCHEDULE', 'ELIGIBILITY', 'OTHER'])
const LAYOUTS = new Set<ManualTableSchema['layout']>(['triples', 'matrix', 'pairs'])

/** Premium → additive; Factor → multiplicative. Accept the printed word or the engine op. */
function coerceOp(v: unknown): FilingOp {
  const s = str(v).toUpperCase()
  if (/FACTOR|MUL|MULT|×|\bX\b/.test(s)) return 'MUL'
  if (/PREMIUM|ADD|\+/.test(s)) return 'ADD'
  return 'MUL'
}
function coerceStage(v: unknown): RateOrderStage {
  const s = str(v).toUpperCase().replace(/[^A-Z]/g, '_')
  return STAGES.has(s as RateOrderStage) ? (s as RateOrderStage) : 'ADJUSTED_BASE'
}

export function sanitizeClassification(name: string, input: Record<string, unknown> | undefined): FilingDocClassification {
  const roleRaw = str(input?.role) as FilingDocRole
  const role = ROLES.has(roleRaw) ? roleRaw : 'other'
  // F13: multi-role documents are real (a manual with an embedded rate-order
  // appendix) — keep validated secondary roles, deduped against the primary.
  const secondaryRoles = (Array.isArray(input?.secondaryRoles) ? (input!.secondaryRoles as unknown[]) : [])
    .map(v => str(v) as FilingDocRole)
    .filter(r => ROLES.has(r) && r !== 'other' && r !== role)
  return {
    name,
    role,
    ...(secondaryRoles.length > 0 ? { secondaryRoles: [...new Set(secondaryRoles)] } : {}),
    cue: str(input?.cue) || 'No structural cue reported.',
    confidence: conf(input?.confidence),
  }
}

export function sanitizeRateOrder(input: Record<string, unknown> | undefined): RateOrderExtraction {
  const variables: RateOrderVariable[] = []
  let dropped = 0
  for (const v of asArray(input?.variables)) {
    const name = str(v.name)
    const citation = str(v.citation)
    if (!name || !citation) { dropped++; continue }          // citation is mandatory
    variables.push({
      name, op: coerceOp(v.op), stage: coerceStage(v.stage),
      forms: strArr(v.forms).map(f => f.toUpperCase()),
      citation, confidence: conf(v.confidence),
    })
  }
  const note = dropped > 0 ? `${dropped} uncited rate-order variable${dropped === 1 ? '' : 's'} dropped.` : str(input?.note) || undefined
  return {
    variables,
    maxCreditRuleRef: str(input?.maxCreditRuleRef) || undefined,
    minPremiumRuleRef: str(input?.minPremiumRuleRef) || undefined,
    ...(note ? { note } : {}),
  }
}

function sanitizeTable(v: unknown): ManualTableSchema | undefined {
  if (!v || typeof v !== 'object') return undefined
  const t = v as Record<string, unknown>
  const layout = str(t.layout) as ManualTableSchema['layout']
  const rowRegion = str(t.rowRegion)
  const keyColumns = strArr(t.keyColumns)
  const valueColumn = str(t.valueColumn)
  // A usable schema needs a known layout, a value column, at least one key column, and a
  // non-trivial source region for the deterministic parser to read.
  if (!LAYOUTS.has(layout) || !valueColumn || keyColumns.length === 0 || rowRegion.length < 3) return undefined
  const columnKeys = strArr(t.columnKeys)
  // lookupKeys must be a subset of the declared key columns; anything else is ignored.
  const lookupKeys = strArr(t.lookupKeys).filter(k => keyColumns.includes(k))
  return {
    layout, keyColumns, valueColumn, rowRegion,
    ...(columnKeys.length ? { columnKeys } : {}),
    ...(lookupKeys.length ? { lookupKeys } : {}),
  }
}

export function sanitizeManual(input: Record<string, unknown> | undefined): ManualExtraction {
  const rules: ManualRule[] = []
  let dropped = 0
  for (const r of asArray(input?.rules)) {
    const title = str(r.title)
    const citation = str(r.citation)
    if (!title || !citation) { dropped++; continue }          // citation is mandatory
    const ruleNumber = str(r.ruleNumber)
    const kindRaw = str(r.kind) as ManualRuleKind
    const kind = KINDS.has(kindRaw) ? kindRaw : classifyRuleNumber(ruleNumber)
    const concept = str(r.concept) || matchConcept(title)?.key || ''
    const table = sanitizeTable(r.table)
    const scalarsRaw = asArray(r.scalars)
      .map(s => ({ label: str(s.label), value: num(s.value), form: str(s.form) || undefined }))
      .filter(s => Number.isFinite(s.value))
    const draftCond = str((r.ruleDraft as Record<string, unknown> | undefined)?.condition)
    const draftOut = str((r.ruleDraft as Record<string, unknown> | undefined)?.outcome)
    rules.push({
      ruleNumber, title, kind, concept, citation, confidence: conf(r.confidence),
      ...(table ? { table } : {}),
      ...(scalarsRaw.length ? { scalars: scalarsRaw } : {}),
      ...(draftCond && draftOut ? { ruleDraft: { condition: draftCond, outcome: draftOut } } : {}),
    })
  }
  const note = dropped > 0 ? `${dropped} uncited manual rule${dropped === 1 ? '' : 's'} dropped.` : str(input?.note) || undefined
  return { rules, ...(note ? { note } : {}) }
}
