// invalidate.ts — the mutate() invalidation hook (Part B), as Firestore write triggers.
//
// Every entity write — whether from the app's adapter.db.mutate() transaction, the server-side
// auditedMerge() (describeForm), or the seed — commits to Firestore and then fires the matching
// onDocumentWritten trigger here, IN THE SAME SERVER FLOW as the write (Firestore guarantees the
// trigger after commit). Each trigger keeps the entity's DERIVED artifacts consistent:
//
//   • embeddings / chunks  — re-chunk just this entity and upsert its vector incrementally
//     (or delete its chunk on entity delete), so a grounded answer NEVER retrieves a stale chunk.
//   • semantic-cache       — evict every cached answer that CITED this entity (by refId / form
//     number), so a cached answer can't outlive the data it summarized even while its refId
//     still resolves (the read-path freshness gate catches deletes; this catches edits).
//   • product summary       — mark the owning product's pre-generated summary stale so the
//     Overview regenerates it on next visit (lazy, no wasted proactive spend).
//   • form description       — a substantive form-field change clears the cached AI description
//     (loop-safe: the clear write re-fires once, sees an empty description, and stops).
//
// Loop safety: triggers write ONLY to OTHER collections (groundingChunks / semanticCache /
// productSummaries) — except the single, guarded form-description clear back onto forms/{key}.
// AWS-SWAP: onDocumentWritten → DynamoDB Streams; the derive/invalidate logic is unchanged.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import type { Change, DocumentSnapshot, FirestoreEvent } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  chunkProduct, chunkCoverage, chunkRule, chunkFormRule, chunkForm,
  chunkDictionary, chunkRatingProgram, chunkLdTable, chunkRtTable, normalizeFormNumber,
} from '@pf/shared'
import type {
  GroundingChunk, Product, Coverage, Rule, FormRule, Form, DictionaryEntry,
  RatingProgram, LDTable, RTTable,
} from '@pf/shared'
import { VOYAGE_API_KEY, voyageKey } from './runtime'
import { getProvider, store } from './retrieval/index'
import { invalidateSemanticCacheByAnchors } from './semanticCache'

type Kind = 'product' | 'coverage' | 'rule' | 'formRule' | 'ratingProgram' | 'form' | 'dictionary' | 'ldTable' | 'rtTable'
type Data = Record<string, unknown>
type WriteEvent = FirestoreEvent<Change<DocumentSnapshot> | undefined, Record<string, string>>

/** Product-scoped kinds whose change invalidates the owning product's cached summary. */
const PRODUCT_SCOPED = new Set<Kind>(['product', 'coverage', 'rule', 'formRule', 'ratingProgram'])

const up = (s: unknown): string => String(s ?? '').trim().toUpperCase()

/** Rebuild the chunk for one entity from its current data (deterministic id + contentHash, so
 *  the store upserts incrementally and a later full reindex stays consistent). */
function chunkFor(kind: Kind, data: Data, params: Record<string, string>): GroundingChunk | null {
  const pid = params.pid ?? ''
  switch (kind) {
    case 'product':       return chunkProduct(data as unknown as Product)
    case 'coverage':      return chunkCoverage(data as unknown as Coverage, pid)
    case 'rule':          return chunkRule(data as unknown as Rule, pid)
    case 'formRule':      return chunkFormRule(data as unknown as FormRule, pid)
    case 'ratingProgram': return chunkRatingProgram(data as unknown as RatingProgram, pid)
    case 'form':          return chunkForm(data as unknown as Form)
    case 'dictionary':    return chunkDictionary(data as unknown as DictionaryEntry)
    case 'ldTable':       return chunkLdTable(params.id!, data as unknown as LDTable)
    case 'rtTable':       return chunkRtTable(params.id!, data as unknown as RTTable)
  }
}

/** The citation anchors that IDENTIFY this entity (upper-cased refId / normalized form number),
 *  matching how the semantic cache stores anchors — the key to evict any answer that cited it. */
function anchorsFor(kind: Kind, data: Data, params: Record<string, string>): string[] {
  const out: string[] = []
  const forms = Array.isArray(data.formNumbers) ? (data.formNumbers as string[]) : []
  switch (kind) {
    case 'product': {
      if (data.refId) out.push(up(data.refId))
      const bf = data.baseForm as { formNumber?: string } | undefined
      if (bf?.formNumber) out.push(normalizeFormNumber(bf.formNumber))
      break
    }
    case 'coverage': case 'rule': case 'formRule': case 'ratingProgram':
      if (data.refId) out.push(up(data.refId))
      for (const fn of forms) out.push(normalizeFormNumber(fn))
      break
    case 'form':
      if (data.number) out.push(normalizeFormNumber(String(data.number)))
      break
    case 'dictionary':
      if (data.refId) out.push(up(data.refId))
      break
    case 'ldTable': case 'rtTable':
      out.push(up(params.id))
      break
  }
  return [...new Set(out.filter(Boolean))]
}

/** A form change is "substantive" (invalidates the cached description) when any field OTHER than
 *  the derived/governance fields changed — so generating the description itself never re-clears it. */
function substantiveFormChange(before: Data, after: Data): boolean {
  const IGNORE = new Set(['description', 'rev', 'updatedAt', 'updatedBy', 'createdAt'])
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of keys) {
    if (IGNORE.has(k)) continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) return true
  }
  return false
}

async function markSummaryStale(kind: Kind, params: Record<string, string>): Promise<void> {
  if (!PRODUCT_SCOPED.has(kind) || !params.pid) return
  try {
    // update() (not set/merge) so we ONLY flag an EXISTING summary — never create an empty
    // productSummaries doc for a product that has no summary yet (which would render blank in
    // the Overview). A not-found update throws and is swallowed: nothing to invalidate.
    await getFirestore().doc(`productSummaries/${params.pid}`).update({ stale: true, staleAt: FieldValue.serverTimestamp() })
  } catch { /* no summary to invalidate — nothing to do */ }
}

/** Bump the dictionary corpus version so the client-side useDictionaryCorpus hook
 *  re-fetches all back-references when product-scoped entity content changes.
 *  Written with merge:true so the first write creates the doc automatically. */
async function bumpDictionaryCorpusVersion(kind: Kind): Promise<void> {
  if (!PRODUCT_SCOPED.has(kind) && kind !== 'form' && kind !== 'dictionary') return
  try {
    await getFirestore().doc('meta/dictionaryCorpusVersion').set(
      { v: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  } catch (e) { console.warn('[invalidate] corpus version bump failed:', e instanceof Error ? e.message : e) }
}

/** Re-embed + upsert (dense when a Voyage key is bound, else a lexical null-vector chunk). */
async function upsertChunk(chunk: GroundingChunk): Promise<void> {
  const provider = getProvider(voyageKey())
  let vector: number[] | null = null
  if (provider.embeddings) {
    try { vector = (await provider.embeddings.embedDocuments([chunk.text]))[0] ?? null }
    catch (e) { console.warn('[invalidate] embed failed; storing lexical:', e instanceof Error ? e.message : e) }
  }
  await store.upsert([{ chunk, vector }])
}

/** The shared trigger body for every entity kind. */
async function handleWrite(kind: Kind, event: WriteEvent): Promise<void> {
  const params = event.params
  const before = event.data?.before?.data() as Data | undefined
  const after  = event.data?.after?.data() as Data | undefined
  const db = getFirestore()

  // ── DELETE — drop the entity's chunk + evict any answer that cited it ──
  if (!after) {
    if (!before) return
    const chunk = chunkFor(kind, before, params)
    if (chunk) { try { await db.doc(`groundingChunks/${chunk.id.replace(/\//g, '_')}`).delete() } catch { /* best-effort */ } }
    await invalidateSemanticCacheByAnchors(anchorsFor(kind, before, params))
    await markSummaryStale(kind, params)
    await bumpDictionaryCorpusVersion(kind)
    return
  }

  // ── CREATE / UPDATE ──
  // Form description invalidation (loop-safe): if a substantive field changed and a cached
  // description is present, clear it. Build the chunk from the description-less form so the
  // index is immediately correct; the clear write re-fires this trigger once, which sees no
  // description to clear and stops.
  let chunkData = after
  if (kind === 'form' && before && substantiveFormChange(before, after)) {
    const hasDesc = typeof after.description === 'string' && (after.description as string).trim().length > 0
    if (hasDesc) {
      chunkData = { ...after, description: '' }
      try { await event.data!.after!.ref.set({ description: FieldValue.delete() }, { merge: true }) }
      catch (e) { console.warn('[invalidate] description clear failed:', e instanceof Error ? e.message : e) }
    }
  }

  const chunk = chunkFor(kind, chunkData, params)
  if (chunk) {
    try { await upsertChunk(chunk) }
    catch (e) { console.warn('[invalidate] chunk upsert failed:', e instanceof Error ? e.message : e) }
  }
  // Evict cached answers that cited this entity even when its refId still resolves (edits).
  await invalidateSemanticCacheByAnchors(anchorsFor(kind, after, params))
  await markSummaryStale(kind, params)
  await bumpDictionaryCorpusVersion(kind)
}

// ─── Triggers — one per grounded collection (Firestore paths can't wildcard a collection) ──
const CFG = { secrets: [VOYAGE_API_KEY], memory: '512MiB' as const, timeoutSeconds: 120 }

export const onProductWrite       = onDocumentWritten({ document: 'products/{pid}', ...CFG },                        (e) => handleWrite('product', e))
export const onCoverageWrite      = onDocumentWritten({ document: 'products/{pid}/coverages/{cid}', ...CFG },        (e) => handleWrite('coverage', e))
export const onRuleWrite          = onDocumentWritten({ document: 'products/{pid}/rules/{rid}', ...CFG },            (e) => handleWrite('rule', e))
export const onFormRuleWrite      = onDocumentWritten({ document: 'products/{pid}/formRules/{frid}', ...CFG },       (e) => handleWrite('formRule', e))
export const onRatingProgramWrite = onDocumentWritten({ document: 'products/{pid}/ratingPrograms/{rpid}', ...CFG },  (e) => handleWrite('ratingProgram', e))
export const onFormWrite          = onDocumentWritten({ document: 'forms/{id}', ...CFG },                            (e) => handleWrite('form', e))
export const onDictionaryWrite    = onDocumentWritten({ document: 'dictionary/{id}', ...CFG },                       (e) => handleWrite('dictionary', e))
export const onLdTableWrite       = onDocumentWritten({ document: 'ldTables/{id}', ...CFG },                         (e) => handleWrite('ldTable', e))
export const onRtTableWrite       = onDocumentWritten({ document: 'rtTables/{id}', ...CFG },                         (e) => handleWrite('rtTable', e))
