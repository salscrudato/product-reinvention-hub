// inventory.ts — pure builders for the portfolio inventory table and the
// product-framework hierarchy (Product → LOB → Coverage → Sub-Coverage).
//
// The single job of this module is to turn a product's flat coverage + form lists
// into SAFE, fully-accounted-for structures:
//   • buildCoverageTree   → a nested tree where every sub-coverage is rendered under
//     its parent, and any coverage whose parentId does not resolve is surfaced as an
//     explicit `orphans` subtree rather than silently dropped or shown as top-level.
//   • buildInventoryRows  → the flattened coverage × form rows the inventory grid
//     renders, each carrying its resolved top-level coverage so a sub-coverage row
//     always shows its parent.
// Because these are read-only projections, no consumer of them can create an orphan;
// the parentId integrity that *prevents* orphans on write lives at the mutation call
// sites (the Coverages editor blocks deleting a parent that still has children and
// only offers top-level coverages as parents).
//
// A coverage's `parentId` holds the parent coverage's **refId** (not its doc id) —
// this is the traceability link used everywhere (e.g. `c.parentId === parent.refId`).
// Pure TypeScript — zero platform imports.

import { resolveLob } from './lobRegistry'

// ─── Structural shapes (line-agnostic; the concrete Coverage/Form satisfy these) ──

export interface CoverageLike {
  refId:        string | null
  parentId:     string | null
  name:         string
  order?:       number
  source?:      string
  formNumbers?: string[]
  allStates?:   boolean
  states?:      string[]
}

export interface FormLike {
  number:   string
  name?:    string
  edition?: string
  source?:  string
}

const byOrder = (a: CoverageLike, b: CoverageLike) => (a.order ?? 0) - (b.order ?? 0)

/** The forms a coverage attaches, resolved from its `formNumbers` against the form
 *  set, preserving the coverage's declared order and skipping numbers with no form. */
export function formsForCoverage<F extends FormLike>(coverage: CoverageLike, forms: F[]): F[] {
  const byNumber = new Map(forms.map(f => [f.number, f]))
  const out: F[] = []
  for (const n of coverage.formNumbers ?? []) {
    const f = byNumber.get(n)
    if (f) out.push(f)
  }
  return out
}

// ─── Coverage tree (nested, safe) ─────────────────────────────────────────────

export interface CoverageNode<C extends CoverageLike, F extends FormLike> {
  coverage: C
  forms:    F[]
  children: CoverageNode<C, F>[]
}

export interface CoverageTree<C extends CoverageLike, F extends FormLike> {
  /** Top-level coverages (no parent), each with their nested sub-coverages. */
  roots:   CoverageNode<C, F>[]
  /** Coverages whose `parentId` points at a refId that no coverage owns. Never
   *  dropped — surfaced here so the UI can show them under an explicit label. */
  orphans: CoverageNode<C, F>[]
}

/** Build the nested coverage tree. Children attach to the coverage whose `refId`
 *  equals their `parentId`; a coverage with an unresolvable parent becomes a root of
 *  the `orphans` list. Cycle- and depth-safe (a `visited` set prevents infinite
 *  recursion if data ever contains a loop). */
export function buildCoverageTree<C extends CoverageLike, F extends FormLike>(
  coverages: C[],
  forms: F[],
): CoverageTree<C, F> {
  const byRefId = new Map<string, C>()
  for (const c of coverages) if (c.refId) byRefId.set(c.refId, c)

  const childrenOf = new Map<string, C[]>()
  for (const c of coverages) {
    if (c.parentId == null) continue
    const arr = childrenOf.get(c.parentId) ?? []
    arr.push(c)
    childrenOf.set(c.parentId, arr)
  }

  const visited = new Set<C>()
  const build = (c: C): CoverageNode<C, F> => {
    visited.add(c)
    const kids = (c.refId ? childrenOf.get(c.refId) ?? [] : [])
      .filter(k => !visited.has(k))
      .sort(byOrder)
    return { coverage: c, forms: formsForCoverage(c, forms), children: kids.map(build) }
  }

  const roots = coverages.filter(c => c.parentId == null).sort(byOrder)
  const orphans = coverages
    .filter(c => c.parentId != null && !byRefId.has(c.parentId))
    .sort(byOrder)

  return { roots: roots.map(build), orphans: orphans.map(build) }
}

// ─── Flattened inventory rows (coverage × form) ─────────────────────────────────

export interface InventoryRow<C extends CoverageLike, F extends FormLike> {
  coverage:  C          // the coverage this row is about
  top:       C          // the top-level coverage shown in the "Coverage" column
  isSub:     boolean    // coverage is nested under `top` → name belongs in "Sub-Coverage"
  isOrphan:  boolean    // parentId set but unresolvable → flag rather than hide
  form:      F | null   // one row per attached form; null when the coverage has none
  formCount: number     // total forms the coverage attaches (row context)
}

/** Resolve a coverage's top-level ancestor by walking `parentId` up to a root.
 *  Returns the coverage itself when it is a root; also reports whether the chain
 *  broke (an orphan) so the row can be flagged rather than silently reparented. */
function resolveTop<C extends CoverageLike>(
  c: C,
  byRefId: Map<string, C>,
): { top: C; isOrphan: boolean } {
  const seen = new Set<string>()
  let cur = c
  let orphan = false
  while (cur.parentId != null) {
    if (cur.refId && seen.has(cur.refId)) break // cycle guard
    if (cur.refId) seen.add(cur.refId)
    const parent = byRefId.get(cur.parentId)
    if (!parent) { orphan = true; break }       // unresolvable parent → orphan
    cur = parent
  }
  return { top: cur, isOrphan: orphan }
}

/** Flatten the coverage tree into grid rows in reading order (each root followed by
 *  its descendants, orphans last), emitting one row per attached form and a single
 *  form-less row for coverages with no forms. Every row carries its resolved
 *  top-level coverage so a sub-coverage row can always name its parent. */
export function buildInventoryRows<C extends CoverageLike, F extends FormLike>(
  coverages: C[],
  forms: F[],
): InventoryRow<C, F>[] {
  const byRefId = new Map<string, C>()
  for (const c of coverages) if (c.refId) byRefId.set(c.refId, c)

  const { roots, orphans } = buildCoverageTree(coverages, forms)
  const rows: InventoryRow<C, F>[] = []

  const emit = (node: CoverageNode<C, F>) => {
    const { top, isOrphan } = resolveTop(node.coverage, byRefId)
    const isSub = node.coverage !== top
    const base = { coverage: node.coverage, top, isSub, isOrphan, formCount: node.forms.length }
    if (node.forms.length === 0) {
      rows.push({ ...base, form: null })
    } else {
      for (const form of node.forms) rows.push({ ...base, form })
    }
    for (const child of node.children) emit(child)
  }

  for (const r of roots) emit(r)
  for (const o of orphans) emit(o)
  return rows
}

// ─── Product display identity ───────────────────────────────────────────────────

export interface ProductLike {
  refId?:  string | null
  name?:   string
  lob?:    { refId?: string | null; name?: string } | null
}

export interface ProductIdentity {
  offeringName: string   // the offering as marketed (the product's full name)
  productName:  string   // the specific policy-form name (suffix after an em/en dash)
  productCode:  string   // short line code from the registry (e.g. "HO", "PA")
  frameworkId:  string   // the Product Framework ID — the product refId
  lobName:      string   // line-of-business display name
}

/** Derive the product-identity columns the inventory shows, from real fields only
 *  (no fabrication). `productName` is the form-specific suffix of the offering name
 *  when it is written "Offering — Form" (split on an em/en dash, never a hyphen so
 *  "HO-3" is preserved); otherwise it equals the full name. `productCode` comes from
 *  the LOB registry so it is not hard-coded per line. */
export function productDisplayIdentity(product: ProductLike | null | undefined): ProductIdentity {
  const name = product?.name?.trim() || 'Untitled product'
  const parts = name.split(/\s*[—–]\s*/) // em dash / en dash only
  const productName = parts.length > 1 ? parts.slice(1).join(' — ') : name
  const lob = resolveLob(product)
  return {
    offeringName: name,
    productName,
    productCode:  lob.code,
    frameworkId:  product?.refId ?? '—',
    lobName:      product?.lob?.name ?? lob.displayName,
  }
}
