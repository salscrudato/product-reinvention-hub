// taskLens — the ONE pure resolver that maps a board task's L3 process group to a single
// artifact "lens" over the linked product, plus the gating rule that decides whether a lens
// renders at all. Pure and dependency-free so it unit-tests without mocks and both the
// slide-over and its tests share exactly one mapping. The slide-over renders the resolved
// lens ONLY when the task's project links a productId; otherwise it shows an honest empty
// state (never a blank panel) — see resolveTaskEnrichment.

/** Which product artifact the task's work centres on. `generic` is the honest fallback for
 *  any group that doesn't map cleanly — a product-overview lens, never a blank one. */
export type LensKind = 'rating' | 'forms' | 'coverage' | 'rules' | 'generic'

/** The product-workspace tab a lens deep-links into (the existing editors). */
export type ProductTab = 'pricing' | 'forms' | 'coverages' | 'rules' | 'overview'

export interface LensDescriptor {
  kind:  LensKind
  title: string   // panel heading
  blurb: string   // one line describing what the lens surfaces
  tab:   ProductTab
}

/**
 * Map an L3 group name to exactly one lens. Keyword-matched (case-insensitive) against the
 * generic L1–L4 insurance product process groups (e.g. "Product Pricing", "Regulatory
 * Filings & State Approvals", "Product Features") AND any ad-hoc group a PM types, so it
 * degrades to the generic overview lens rather than guessing. Order matters: the first
 * family that matches wins.
 */
export function resolveTaskLens(group?: string | null): LensDescriptor {
  const g = (group ?? '').trim().toLowerCase()
  if (g) {
    // Rating / pricing — "Product Pricing", actuarial / premium work.
    if (/pricing|rating|\brate\b|premium|actuar/.test(g))
      return { kind: 'rating', tab: 'pricing', title: 'Rating & premium',
        blurb: 'Rating programs, the live worked-example premium, and the tables they read.' }
    // Forms / filing — "Regulatory Filings & State Approvals", form drafting, compliance.
    if (/form|filing|regulat|state approval|licens|complian/.test(g))
      return { kind: 'forms', tab: 'forms', title: 'Forms & filing',
        blurb: 'The forms library and this product filing / state-approval status.' }
    // Rules — eligibility / underwriting rule work.
    if (/\brule|eligibil|underwrit/.test(g))
      return { kind: 'rules', tab: 'rules', title: 'Rules',
        blurb: 'The product, rating and forms rules governing this launch.' }
    // Coverage — "Product Features", "Product Specifications", perils, endorsements.
    if (/coverage|feature|specification|benefit|peril|endorsement|wording/.test(g))
      return { kind: 'coverage', tab: 'coverages', title: 'Coverages',
        blurb: 'The coverage tree — parts, terms and the forms they attach.' }
  }
  return { kind: 'generic', tab: 'overview', title: 'Product overview',
    blurb: 'A snapshot of the linked product — composition and lifecycle.' }
}

/** The gating decision: does this task's project link a product, and which lens applies?
 *  `hasProduct === false` → the slide-over shows the empty state and renders NO lens. */
export interface TaskEnrichment {
  hasProduct: boolean
  productId:  string | null
  lens:       LensDescriptor
}

export function resolveTaskEnrichment(
  project: { productId?: string | null } | null | undefined,
  task:    { groupL3?: string | null },
): TaskEnrichment {
  const productId = project?.productId ?? null
  return { hasProduct: !!productId, productId, lens: resolveTaskLens(task.groupL3) }
}

/** Build a deep link into an existing product editor tab, honouring the query params those
 *  tabs already read (`?cov=<refId>` on coverages, `?form=<number>` on forms). Pure. */
export type DeepLinkTarget =
  | { tab: 'coverages'; ref?: string }
  | { tab: 'forms'; formNumber?: string }
  | { tab: 'rules' }
  | { tab: 'pricing' }
  | { tab: 'overview' }

export function productDeepLink(pid: string, target: DeepLinkTarget): string {
  const base = `/app/products/${pid}`
  switch (target.tab) {
    case 'coverages': return target.ref ? `${base}/coverages?cov=${encodeURIComponent(target.ref)}` : `${base}/coverages`
    case 'forms':     return target.formNumber ? `${base}/forms?form=${encodeURIComponent(target.formNumber)}` : `${base}/forms`
    case 'rules':     return `${base}/rules`
    case 'pricing':   return `${base}/pricing`
    case 'overview':  return `${base}/overview`
  }
}
