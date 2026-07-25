// cloneProduct.ts — deep-copy a published product into a fresh, isolated DRAFT.
// Reads the source product's whole sub-tree through the adapter and re-writes it under
// a newly-minted draft doc id, EVERY write via adapter.db.mutate() (entity + audit +
// version + searchIndex + rev, atomically) — no bare Firestore writes. The clone is a
// self-contained sandbox: coverages/rules/form-rules/rating live in the draft's own
// sub-collections, and the source's forms are copied as draft-namespaced docs
// (`forms/{draftId}__{number}[__{edition}]`, identity = (number, edition) — F12/F21)
// linked via productRefIds = [draftId]. Nothing the
// source owns is mutated, so a launched product is never disturbed by cloning it.
// Shared LD/RT rate tables are referenced (not copied) — they are a read-only library.
// Provenance is stamped so the draft always shows what it was cloned from.
import { adapter } from '../backend'
import { newDraftId, cloneLineage, type Actor } from './draft'
import type { Product, Coverage, Rule, FormRule, RatingProgram, Form } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export interface CloneProgress { done: number; total: number; label: string }
export interface CloneResult { productId: string; written: number }

/** Strip the synthetic `id` (added by the adapter on read) so it isn't persisted as a
 *  field. Governance stamps (createdAt/updatedAt/updatedBy/rev) are overwritten by
 *  mutate() on create, so they need no special handling. */
function strip<T extends { id?: string }>(doc: T): Omit<T, 'id'> {
  const { id: _omit, ...rest } = doc
  void _omit
  return rest
}

const DRAFT_GOV = { status: 'ACTIVE' as const, lifecycle: 'DRAFT' as const, reviewStatus: 'NOT_STARTED' as const, reviewer: '' }

/** Clone `source` (a launched or draft product) into a new DRAFT. */
export async function cloneProductToDraft(
  source: WithId<Product>,
  actor: Actor,
  onProgress?: (p: CloneProgress) => void,
): Promise<CloneResult> {
  const draftId = newDraftId(source.refId ?? source.name)

  // Read the whole sub-tree first (so the total is known and writes run in order).
  // Forms use server-side array-contains queries so the result is never capped by MAX_LIST
  // (the global 'forms' collection can grow past the client-list page size).
  const [coverages, rules, formRules, programs, formsByDocId, formsByRefId] = await Promise.all([
    adapter.db.list<WithId<Coverage>>(`products/${source.id}/coverages`),
    adapter.db.list<WithId<Rule>>(`products/${source.id}/rules`),
    adapter.db.list<WithId<FormRule>>(`products/${source.id}/formRules`),
    adapter.db.list<WithId<RatingProgram>>(`products/${source.id}/ratingPrograms`),
    adapter.db.list<WithId<Form>>('forms', { where: [{ field: 'productRefIds', op: 'array-contains', value: source.id }] }),
    source.refId
      ? adapter.db.list<WithId<Form>>('forms', { where: [{ field: 'productRefIds', op: 'array-contains', value: source.refId }] })
      : Promise.resolve([] as WithId<Form>[]),
  ])
  const seenFormIds = new Set(formsByDocId.map(f => f.id))
  const forms = [...formsByDocId, ...formsByRefId.filter(f => !seenFormIds.has(f.id))]

  const total = 1 + coverages.length + rules.length + formRules.length + programs.length + forms.length
  let written = 0
  const tick = (label: string) => onProgress?.({ done: written, total, label })

  // Product doc — same identity/scope, reset to DRAFT, provenance stamped.
  tick(source.name)
  await adapter.db.mutate({
    op: 'create', path: `products/${draftId}`, entityType: 'product', productId: draftId, actor,
    data: {
      refId: source.refId, name: `${source.name} (draft)`, lob: source.lob,
      description: source.description, marketSegment: source.marketSegment,
      owner: { uid: actor.uid, name: actor.name },
      allStates: source.allStates, states: source.states,
      lineage: cloneLineage(source, actor),
      ...DRAFT_GOV,
    },
  })
  written++

  // Parent-before-child ordering: shallower refIds first (matches the importer).
  const orderedCovs = [...coverages].sort((a, b) => (a.refId?.split('.').length ?? 0) - (b.refId?.split('.').length ?? 0))

  for (const c of orderedCovs) {
    tick(c.name)
    await adapter.db.mutate({
      op: 'create', path: `products/${draftId}/coverages/${crypto.randomUUID()}`,
      entityType: 'coverage', productId: draftId, actor,
      data: { ...strip(c), ...DRAFT_GOV },
    })
    written++
  }
  for (const r of rules) {
    tick(r.refId ?? 'rule')
    await adapter.db.mutate({
      op: 'create', path: `products/${draftId}/rules/${crypto.randomUUID()}`,
      entityType: 'rule', productId: draftId, actor,
      data: { ...strip(r), ...DRAFT_GOV },
    })
    written++
  }
  for (const fr of formRules) {
    tick(fr.refId ?? 'form rule')
    await adapter.db.mutate({
      op: 'create', path: `products/${draftId}/formRules/${crypto.randomUUID()}`,
      entityType: 'formRule', productId: draftId, actor,
      data: { ...strip(fr), ...DRAFT_GOV },
    })
    written++
  }
  for (const p of programs) {
    tick(p.name)
    await adapter.db.mutate({
      op: 'create', path: `products/${draftId}/ratingPrograms/${crypto.randomUUID()}`,
      entityType: 'ratingProgram', productId: draftId, actor,
      data: { ...strip(p), ...DRAFT_GOV },
    })
    written++
  }
  // Forms — draft-namespaced copies, re-linked to the draft. The source's forms are
  // untouched (a different, un-namespaced doc id). Copy identity is (number, edition)
  // — F12/F21: envelope writes are upserts, so a number-only id keeps just the LAST
  // edition of a multi-edition number. Blank edition degrades to the number-only id.
  for (const f of forms) {
    tick(f.number)
    const copyId = f.edition ? `${f.number.replace(/\s+/g, '-')}__${f.edition.replace(/\s+/g, '-')}` : f.number.replace(/\s+/g, '-')
    await adapter.db.mutate({
      op: 'create', path: `forms/${draftId}__${copyId}`,
      entityType: 'form', actor,
      data: { ...strip(f), productRefIds: [draftId], ...DRAFT_GOV },
    })
    written++
  }

  return { productId: draftId, written }
}
