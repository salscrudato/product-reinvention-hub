// changeset/diff.ts — deterministic diff engine over a CLONE lineage.
//
// diffProducts(parent, clone) computes a typed ChangeSet from the two full
// product snapshots. Pure TypeScript; no platform I/O; fully deterministic.
// Called server-side after Cosmos fetches; also callable from tests with fixture data.

import type { Coverage, Form, LDTable, RTTable, RatingProgram, StandardOption, CoverageTerm } from '../types'
import type {
  ChangeSet, CoverageChange, TermChange, TermFieldChange, OptionSetChange,
  RateTableCellChange, LDTableChange, FormEditionChange,
} from './types'

/** Full product data snapshot — what the server fetches from Cosmos for one product. */
export interface ProductSnapshot {
  refId:         string
  name:          string
  coverages:     Coverage[]
  forms:         Form[]
  rtTables:      Record<string, RTTable>
  ldTables:      Record<string, LDTable>
  ratingProgram: RatingProgram
}

// ─── Coverage diff ─────────────────────────────────────────────────────────────

function diffTerms(parentTerms: CoverageTerm[], cloneTerms: CoverageTerm[]): TermChange[] {
  const changes: TermChange[] = []
  const byId = (ts: CoverageTerm[]) => new Map(ts.map(t => [t.id, t]))
  const pm = byId(parentTerms)
  const cm = byId(cloneTerms)

  const allIds = new Set([...pm.keys(), ...cm.keys()])
  for (const id of allIds) {
    const pt = pm.get(id)
    const ct = cm.get(id)
    if (!pt || !ct) continue   // added/removed terms are covered at coverage level
    const fieldChanges: TermFieldChange[] = []
    const optionSetChanges: OptionSetChange[] = []

    const scalarFields: Array<keyof CoverageTerm> = ['options', 'default', 'min', 'max', 'label', 'notes', 'basis', 'constraintNote']
    for (const f of scalarFields) {
      const before = pt[f]
      const after  = ct[f]
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        fieldChanges.push({ field: f as TermFieldChange['field'], before, after })
      }
    }

    // optionSet deep diff
    const pOpts = pt.optionSet ?? []
    const cOpts = ct.optionSet ?? []
    const pByOid = new Map<string, StandardOption>(pOpts.map(o => [o.id, o]))
    const cByOid = new Map<string, StandardOption>(cOpts.map(o => [o.id, o]))
    const allOids = new Set([...pByOid.keys(), ...cByOid.keys()])
    for (const oid of allOids) {
      const po = pByOid.get(oid)
      const co = cByOid.get(oid)
      if (!po) { optionSetChanges.push({ optionId: oid, kind: 'added' }); continue }
      if (!co) { optionSetChanges.push({ optionId: oid, kind: 'removed' }); continue }
      const optFields: Array<keyof StandardOption> = ['type', 'value', 'parts', 'label', 'allStates', 'states', 'isDefault', 'enabled', 'constraintNote']
      for (const f of optFields) {
        if (JSON.stringify(po[f]) !== JSON.stringify(co[f])) {
          optionSetChanges.push({ optionId: oid, kind: 'modified', field: f, before: po[f], after: co[f] })
        }
      }
    }

    if (fieldChanges.length > 0 || optionSetChanges.length > 0) {
      changes.push({ termId: id, termLabel: ct.label || pt.label, termKind: ct.kind, fieldChanges, optionSetChanges })
    }
  }
  return changes
}

function diffCoverages(parentCovs: Coverage[], cloneCovs: Coverage[]): CoverageChange[] {
  const changes: CoverageChange[] = []
  const byRef = (cs: Coverage[]) => new Map(cs.filter(c => c.refId).map(c => [c.refId!, c]))
  const pm = byRef(parentCovs)
  const cm = byRef(cloneCovs)

  for (const [ref, cov] of cm.entries()) {
    if (!pm.has(ref)) changes.push({ kind: 'added', refId: ref, name: cov.name })
  }
  for (const [ref, cov] of pm.entries()) {
    if (!cm.has(ref)) changes.push({ kind: 'removed', refId: ref, name: cov.name })
  }
  for (const [ref, pc] of pm.entries()) {
    const cc = cm.get(ref)
    if (!cc) continue
    const termChanges = diffTerms(pc.terms, cc.terms)
    const covFields: Array<keyof Coverage> = ['name', 'requirement', 'claimsBasis', 'premiumGenerating', 'source', 'formNumbers']
    const fieldChanges: CoverageChange['fieldChanges'] = []
    for (const f of covFields) {
      if (JSON.stringify(pc[f]) !== JSON.stringify(cc[f])) {
        fieldChanges.push({ field: f, before: pc[f], after: cc[f] })
      }
    }
    if (termChanges.length > 0 || fieldChanges.length > 0) {
      changes.push({ kind: 'modified', refId: ref, name: cc.name, termChanges, fieldChanges })
    }
  }
  return changes
}

// ─── RT table diff (cell-level) ──────────────────────────────────────────────

/** Identify the value column(s) for a table. When `dimensions` are declared the
 *  value columns are those NOT listed as dimension keys. Without dimensions, fall back
 *  to the explicit `valueColumn`, then the last column. Key columns are everything else. */
function resolveTableLayout(table: RTTable): { keyColumns: string[]; valueCols: string[] } {
  if (table.dimensions && table.dimensions.length > 0) {
    const dimKeys = new Set(table.dimensions.map(d => d.key))
    const valueCols = table.columns.filter(c => !dimKeys.has(c))
    return { keyColumns: [...dimKeys].filter(k => table.columns.includes(k)), valueCols }
  }
  const valueCol  = table.valueColumn ?? table.columns[table.columns.length - 1]!
  const keyColumns = table.columns.filter(c => c !== valueCol)
  return { keyColumns, valueCols: [valueCol] }
}

/** Build a stable composite key string for a row using all key columns. */
function compositeKey(row: Record<string, unknown>, keyColumns: string[]): string {
  const obj: Record<string, unknown> = {}
  for (const k of keyColumns) obj[k] = row[k]
  return JSON.stringify(obj)
}

function diffRTTables(
  parentTables: Record<string, RTTable>,
  cloneTables:  Record<string, RTTable>,
): RateTableCellChange[] {
  const changes: RateTableCellChange[] = []
  const allRefs = new Set([...Object.keys(parentTables), ...Object.keys(cloneTables)])

  for (const ref of allRefs) {
    const pt = parentTables[ref]
    const ct = cloneTables[ref]
    if (!pt || !ct) continue   // table added/removed is outside cell-diff scope

    const { keyColumns, valueCols } = resolveTableLayout(ct)

    // Build parent row map by composite key
    const pByKey = new Map<string, Record<string, unknown>>()
    for (const row of pt.rows) pByKey.set(compositeKey(row, keyColumns), row)

    for (const row of ct.rows) {
      const key    = compositeKey(row, keyColumns)
      const pr     = pByKey.get(key)
      const rowKey: Record<string, unknown> = {}
      for (const k of keyColumns) rowKey[k] = row[k]

      for (const vc of valueCols) {
        const beforeRaw = pr ? pr[vc] : undefined
        const afterRaw  = row[vc]
        const before = typeof beforeRaw === 'number' ? beforeRaw : parseFloat(String(beforeRaw ?? 'NaN'))
        const after  = typeof afterRaw  === 'number' ? afterRaw  : parseFloat(String(afterRaw  ?? 'NaN'))
        if (!isFinite(before) || !isFinite(after)) continue
        if (before !== after) {
          const pctChange = before !== 0 ? ((after - before) / Math.abs(before)) * 100 : null
          changes.push({ tableRefId: ref, tableName: ct.name, rowKey: { ...rowKey }, column: vc, before, after, pctChange })
        }
      }
    }
  }
  return changes
}

// ─── LD table diff (row-level) ────────────────────────────────────────────────

function diffLDTables(
  parentTables: Record<string, LDTable>,
  cloneTables:  Record<string, LDTable>,
): LDTableChange[] {
  const changes: LDTableChange[] = []
  const allRefs = new Set([...Object.keys(parentTables), ...Object.keys(cloneTables)])

  for (const ref of allRefs) {
    const pt = parentTables[ref]
    const ct = cloneTables[ref]
    if (!pt || !ct) continue

    if (pt.defaultValue !== ct.defaultValue) {
      changes.push({ tableRefId: ref, tableName: ct.name, kind: 'default-changed', field: 'defaultValue', before: pt.defaultValue, after: ct.defaultValue })
    }

    const pByLabel = new Map(pt.rows.map(r => [r.label, r]))
    const cByLabel = new Map(ct.rows.map(r => [r.label, r]))

    for (const [label, cr] of cByLabel.entries()) {
      if (!pByLabel.has(label)) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: 'row-added', label })
        continue
      }
      const pr = pByLabel.get(label)!
      if (pr.value !== cr.value) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: 'row-modified', label, field: 'value', before: pr.value, after: cr.value })
      }
      if (pr.constraintNote !== cr.constraintNote) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: 'row-modified', label, field: 'constraintNote', before: pr.constraintNote, after: cr.constraintNote })
      }
    }
    for (const label of pByLabel.keys()) {
      if (!cByLabel.has(label)) {
        changes.push({ tableRefId: ref, tableName: ct.name, kind: 'row-removed', label })
      }
    }
  }
  return changes
}

// ─── Form diff ────────────────────────────────────────────────────────────────

function diffForms(parentForms: Form[], cloneForms: Form[]): FormEditionChange[] {
  const changes: FormEditionChange[] = []
  const pByNum = new Map(parentForms.map(f => [f.number, f]))
  const cByNum = new Map(cloneForms.map(f => [f.number, f]))

  for (const [num, cf] of cByNum.entries()) {
    const pf = pByNum.get(num)
    if (!pf) continue
    const fields: Array<keyof Form> = ['edition', 'status', 'category', 'description']
    for (const field of fields) {
      if (pf[field] !== cf[field]) {
        changes.push({ formNumber: num, formName: cf.name, field: field as FormEditionChange['field'], before: pf[field], after: cf[field] })
      }
    }
  }
  return changes
}

// ─── Public entry point ───────────────────────────────────────────────────────

/** Compute the full typed ChangeSet between a parent product snapshot and its CLONE. */
export function diffProducts(parent: ProductSnapshot, clone: ProductSnapshot): ChangeSet {
  const coverageChanges      = diffCoverages(parent.coverages, clone.coverages)
  const rateTableCellChanges = diffRTTables(parent.rtTables, clone.rtTables)
  const ldTableChanges       = diffLDTables(parent.ldTables, clone.ldTables)
  const formEditionChanges   = diffForms(parent.forms, clone.forms)

  const hasCoverageOptionChanges = coverageChanges.some(
    c => c.kind === 'modified' && c.termChanges != null && c.termChanges.length > 0,
  )

  return {
    cloneRefId:  clone.refId,
    parentRefId: parent.refId,
    cloneName:   clone.name,
    parentName:  parent.name,
    generatedAt: new Date().toISOString(),

    coverageChanges,
    rateTableCellChanges,
    ldTableChanges,
    formEditionChanges,

    summary: {
      coveragesAdded:       coverageChanges.filter(c => c.kind === 'added').length,
      coveragesRemoved:     coverageChanges.filter(c => c.kind === 'removed').length,
      coveragesModified:    coverageChanges.filter(c => c.kind === 'modified').length,
      rateTableCellsChanged: rateTableCellChanges.length,
      ldTableChanges:       ldTableChanges.length,
      formEditionChanges:   formEditionChanges.length,
      hasRateImpact:        rateTableCellChanges.length > 0 || ldTableChanges.length > 0,
      hasFormChanges:       formEditionChanges.length > 0,
      hasCoverageOptionChanges,
    },
  }
}
