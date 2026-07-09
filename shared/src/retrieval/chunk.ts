// retrieval/chunk.ts — turn corpus entities into GroundingChunks.
//
// Chunking is SEMANTIC: one coherent idea per chunk (a whole coverage, a whole rule,
// one dictionary term, a paragraph of base-form prose), never a fixed byte window that
// splits a clause mid-sentence. Every chunk's text repeats its refId / form number so
// BOTH dense embeddings and the lexical fallback carry the citation anchor, and the same
// id is mirrored in metadata so a retrieved chunk is verifiable against the live catalogue.
//
// Pure + deterministic: the same entity always yields the same id + contentHash, so the
// indexer can diff by hash and re-embed only what changed (incremental build). Zero
// platform imports — the offline eval builds chunks straight from the seed constants.
import type {
  Product, Coverage, Rule, FormRule, Form, DictionaryEntry, RatingProgram,
  LDTable, RTTable,
} from '../types'
import { normalizeFormNumber } from '../insurance/extraction'
import type { GroundingChunk, ChunkMetadata } from './types'

// ─── Deterministic content hash (FNV-1a, 32-bit) ───────────────────────────────
// A dependency-free hash so `shared` stays platform-free (no node:crypto). Collisions
// are astronomically unlikely for this corpus; a hash change means the chunk text
// changed and must be re-embedded. Hex string keeps it Firestore-doc-id-safe.
export function contentHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Join the non-empty lines of a chunk body, trimming trailing whitespace. */
function body(...lines: (string | false | null | undefined)[]): string {
  return lines.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).join('\n').trim()
}

/** Assemble a chunk from an id, body text and metadata — hashing the text once. */
function make(id: string, text: string, metadata: ChunkMetadata): GroundingChunk {
  return { id, text, contentHash: contentHash(text), metadata }
}

// ─── Per-entity builders ────────────────────────────────────────────────────────

export function chunkProduct(p: Product): GroundingChunk {
  const refId = p.refId ?? ''
  const text = body(
    `Product: ${p.name} [${refId}]`,
    `Line of business: ${p.lob?.name ?? ''} (${p.lob?.refId ?? ''}). Segment: ${p.marketSegment}.`,
    p.description,
    p.baseForm?.formNumber ? `Base form: ${p.baseForm.formNumber}${p.baseForm.title ? ` — ${p.baseForm.title}` : ''}.` : '',
  )
  return make(`product:${refId}`, text, {
    type: 'product', refId: refId || null, formNumber: p.baseForm?.formNumber ?? null,
    productId: refId || null, path: `products/${refId}`, title: p.name,
  })
}

export function chunkCoverage(c: Coverage, productId: string): GroundingChunk {
  const refId = c.refId ?? ''
  const terms = (c.terms ?? []).map(t =>
    `- ${t.label} (${t.kind}${t.ldTableRef ? `, table ${t.ldTableRef}` : ''}): default ${String(t.default)}${t.unit ? ` ${t.unit}` : ''}${t.constraintNote ? ` — ${t.constraintNote}` : ''}`,
  )
  const text = body(
    `Coverage: ${c.name} [${refId}]`,
    `${c.requirement} · ${c.premiumGenerating ? 'premium-generating' : 'no premium'} · claims basis ${c.claimsBasis} · source ${c.source}.`,
    c.parentId ? `Sub-coverage of ${c.parentId}.` : 'Top-level coverage.',
    (c.formNumbers ?? []).length ? `Attached forms: ${c.formNumbers.join(', ')}.` : '',
    terms.length ? `Terms:\n${terms.join('\n')}` : '',
  )
  return make(`coverage:${refId}`, text, {
    type: 'coverage', refId: refId || null,
    formNumber: c.formNumbers?.[0] ?? null, productId,
    path: `products/${productId}/coverages/${refId.replace(/\./g, '-')}`, title: c.name,
  })
}

export function chunkRule(r: Rule, productId: string): GroundingChunk {
  const refId = r.refId ?? ''
  const text = body(
    `Rule ${refId} (${r.category}${r.subCategory ? ` / ${r.subCategory}` : ''})`,
    `IF ${r.condition} THEN ${r.outcome}.`,
    (r.coverageRefIds ?? []).length ? `Coverages: ${r.coverageRefIds.join(', ')}.` : '',
    (r.formNumbers ?? []).length ? `Forms: ${r.formNumbers.join(', ')}.` : '',
    r.ldTableRef ? `Table: ${r.ldTableRef}.` : '',
  )
  return make(`rule:${refId}`, text, {
    type: 'rule', refId: refId || null, formNumber: r.formNumbers?.[0] ?? null,
    productId, path: `products/${productId}/rules/${refId.replace(/\./g, '-')}`,
    title: `${refId} · ${r.subCategory || r.category}`,
  })
}

export function chunkFormRule(fr: FormRule, productId: string): GroundingChunk {
  const refId = fr.refId ?? ''
  const text = body(
    `Form-attachment rule ${refId}`,
    `IF ${fr.condition} THEN ${fr.outcome}.`,
    (fr.formNumbers ?? []).length ? `Forms: ${fr.formNumbers.join(', ')}.` : '',
    fr.mandatory ? 'Mandatory attachment.' : 'Optional attachment.',
  )
  return make(`formRule:${refId}`, text, {
    type: 'formRule', refId: refId || null, formNumber: fr.formNumbers?.[0] ?? null,
    productId, path: `products/${productId}/formRules/${refId.replace(/\./g, '-')}`,
    title: `Form rule ${refId}`,
  })
}

export function chunkForm(f: Form): GroundingChunk {
  const text = body(
    `Form ${f.number} (Ed. ${f.edition}) — ${f.name}`,
    `Category ${f.category}. Attachment: ${f.attachmentCondition}. ${f.mandatoryDefault ? 'Mandatory by default.' : 'Not mandatory by default.'}`,
    (f.coverageParts ?? []).length ? `Coverage parts: ${f.coverageParts.join(', ')}.` : '',
    f.description || '',
  )
  return make(`form:${normalizeFormNumber(f.number)}`, text, {
    type: 'form', refId: null, formNumber: f.number,
    productId: f.productRefIds?.[0] ?? null,
    path: `forms/${f.number.replace(/\s+/g, '-')}`, title: `${f.number} — ${f.name}`,
  })
}

export function chunkDictionary(d: DictionaryEntry): GroundingChunk {
  const refId = d.refId ?? ''
  const idKey = refId || d.name.toLowerCase().replace(/\s+/g, '-')
  const text = body(
    `Definition: ${d.name}${refId ? ` [${refId}]` : ''} (${d.type})`,
    d.description,
    (d.aliases ?? []).length ? `Also known as: ${d.aliases!.join(', ')}.` : '',
    (d.allowedValues ?? []).length ? `Allowed values: ${d.allowedValues.join(', ')}.` : '',
    d.format ? `Format: ${d.format}.` : '',
    (d.tags ?? []).length ? `Tags: ${d.tags.join(', ')}.` : '',
  )
  return make(`dictionary:${idKey}`, text, {
    type: 'dictionary', refId: refId || null, formNumber: null, productId: null,
    path: `dictionary/${d.name.toLowerCase().replace(/\s+/g, '-')}`, title: d.name,
  })
}

export function chunkRatingProgram(rp: RatingProgram, productId: string): GroundingChunk {
  const steps = (rp.steps ?? []).map(s => {
    const ref = s.source && 'ref' in s.source ? (s.source as { ref?: string }).ref : undefined
    return `- ${s.label} (${s.op}${ref ? `, ${ref}` : ''})`
  })
  const text = body(
    `Rating program: ${rp.name} [${rp.refId}]`,
    `Minimum premium $${rp.minimumPremium}. ${steps.length} steps.`,
    steps.join('\n'),
  )
  return make(`ratingProgram:${rp.refId}`, text, {
    type: 'ratingProgram', refId: rp.refId, formNumber: null, productId,
    path: `products/${productId}/ratingPrograms/${rp.refId.replace(/\./g, '-')}`, title: rp.name,
  })
}

export function chunkLdTable(refId: string, t: LDTable): GroundingChunk {
  const rows = (t.rows ?? []).map(r => `- ${r.label}: ${String(r.value)}${r.constraintNote ? ` (${r.constraintNote})` : ''}`)
  const text = body(`Limit/Deductible table ${refId} — ${t.name}`, rows.join('\n'))
  return make(`ldTable:${refId}`, text, {
    type: 'ldTable', refId, formNumber: null, productId: null,
    path: `ldTables/${refId}`, title: t.name,
  })
}

export function chunkRtTable(refId: string, t: RTTable): GroundingChunk {
  const text = body(
    `Rate table ${refId} — ${t.name}`,
    (t.columns ?? []).length ? `Columns: ${t.columns.join(', ')}.` : '',
    `${(t.rows ?? []).length} rows.`,
  )
  return make(`rtTable:${refId}`, text, {
    type: 'rtTable', refId, formNumber: null, productId: null,
    path: `rtTables/${refId}`, title: t.name,
  })
}

// ─── Base-form prose ──────────────────────────────────────────────────────────
// Split extracted base-form text into semantic paragraphs (double-newline separated),
// coalescing tiny fragments up to a soft character budget so a heading rides with the
// clause it introduces. Every chunk carries the form number as its citation anchor.
export function chunkBaseFormText(formNumber: string, text: string, softLimit = 900): GroundingChunk[] {
  const norm = normalizeFormNumber(formNumber)
  const paras = text.split(/\n\s*\n/).map(p => p.replace(/\s+\n/g, '\n').trim()).filter(Boolean)
  const chunks: GroundingChunk[] = []
  let buf = ''
  let heading = ''
  const flush = () => {
    if (!buf.trim()) return
    const n = chunks.length
    const chunkText = body(`Form ${formNumber} — ${heading || 'text'}`, buf)
    chunks.push(make(`baseForm:${norm}:${n}`, chunkText, {
      type: 'baseForm', refId: null, formNumber, productId: null,
      path: `forms/${formNumber.replace(/\s+/g, '-')}`, title: `${formNumber} — ${heading || `section ${n + 1}`}`,
      section: heading || undefined,
    }))
    buf = ''
  }
  for (const p of paras) {
    // A short ALL-CAPS-ish line reads as a section heading — start a fresh chunk on it.
    if (p.length < 70 && /[A-Z]/.test(p) && p === p.toUpperCase()) { flush(); heading = p }
    buf = buf ? `${buf}\n\n${p}` : p
    if (buf.length >= softLimit) flush()
  }
  flush()
  return chunks
}

// ─── Bundle assembly ────────────────────────────────────────────────────────────

/** Everything one product contributes to the corpus (its own doc + subcollections)
 *  plus the globals it owns (forms, tables, dictionary). Mirrors the seed ProductBundle. */
export interface CorpusBundle {
  product:        Product
  coverages:      Coverage[]
  rules:          Rule[]
  formRules?:     FormRule[]
  forms:          Form[]
  dictionary:     DictionaryEntry[]
  ratingProgram?: RatingProgram | null
  ldTables?:      Record<string, LDTable>
  rtTables?:      Record<string, RTTable>
}

/** Build every chunk for one product bundle. The caller de-duplicates globals
 *  (forms/tables/dictionary shared across products) by chunk id. */
export function buildBundleChunks(b: CorpusBundle): GroundingChunk[] {
  const pid = b.product.refId ?? ''
  const out: GroundingChunk[] = [chunkProduct(b.product)]
  for (const c of b.coverages) out.push(chunkCoverage(c, pid))
  for (const r of b.rules) out.push(chunkRule(r, pid))
  for (const fr of b.formRules ?? []) out.push(chunkFormRule(fr, pid))
  for (const f of b.forms) out.push(chunkForm(f))
  for (const d of b.dictionary) out.push(chunkDictionary(d))
  if (b.ratingProgram) out.push(chunkRatingProgram(b.ratingProgram, pid))
  for (const [refId, t] of Object.entries(b.ldTables ?? {})) out.push(chunkLdTable(refId, t))
  for (const [refId, t] of Object.entries(b.rtTables ?? {})) out.push(chunkRtTable(refId, t))
  return out
}

/** Merge chunks from many bundles, keeping the first of each duplicate id (globals
 *  such as forms/dictionary appear in every bundle that references them). */
export function dedupeChunks(chunks: GroundingChunk[]): GroundingChunk[] {
  const seen = new Map<string, GroundingChunk>()
  for (const c of chunks) if (!seen.has(c.id)) seen.set(c.id, c)
  return [...seen.values()]
}
