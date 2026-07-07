// draft.ts — draft-identity + provenance helpers shared by every draft-creation flow
// (import, clone, AI scaffold, blank). Two jobs:
//
//  1. Mint a DISTINCT product doc id for every draft. A draft NEVER reuses a canonical
//     ISO refId as its doc id, so importing/cloning can never clobber — nor silently
//     demote — a launched product that happens to share that refId. The canonical
//     refId is preserved in the product's `refId` field (for display + citation); only
//     the Firestore doc id is synthetic. Promotion later flips lifecycle in place; it
//     never moves the doc.
//  2. Build the `Lineage` record so a draft's origin is always captured and shown.
import type { Lineage, LineageSource } from '@pf/shared'

export interface Actor { uid: string; name: string }

/** A unique, human-readable draft doc id, e.g. `draft-ho-prod-001-l3k9`. */
export function newDraftId(seed?: string): string {
  const slug = (seed ?? 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'product'
  const rand = Math.random().toString(36).slice(2, 6)
  return `draft-${slug}-${Date.now().toString(36)}-${rand}`
}

const now = () => new Date().toISOString()

export function importLineage(files: string[], productRefId: string | null, by: Actor): Lineage {
  const sources: LineageSource[] = files.map(f => ({ type: 'file', ref: f }))
  return {
    kind: 'IMPORT',
    summary: `Imported from ${files.length} ISO workbook${files.length === 1 ? '' : 's'}${productRefId ? ` as ${productRefId}` : ''}`,
    sources,
    by, at: now(),
  }
}

export function cloneLineage(source: { id: string; refId: string | null; name: string }, by: Actor): Lineage {
  return {
    kind: 'CLONE',
    summary: `Cloned from ${source.refId ?? source.name}`,
    sources: [{ type: 'product', ref: source.refId ?? source.id, name: source.name }],
    by, at: now(),
  }
}

export function scaffoldLineage(instruction: string, sources: LineageSource[], by: Actor): Lineage {
  const trimmed = instruction.trim().slice(0, 100)
  return {
    kind: 'AI_SCAFFOLD',
    summary: `AI-scaffolded${trimmed ? `: "${trimmed}${instruction.length > 100 ? '…' : ''}"` : ''}`,
    // Only the grounded entities the scaffold was modelled on — deduped, capped.
    sources: sources.slice(0, 24),
    by, at: now(),
  }
}

export function blankLineage(by: Actor): Lineage {
  return { kind: 'BLANK', summary: 'Created from scratch', sources: [], by, at: now() }
}
