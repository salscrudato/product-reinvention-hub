// usage.ts — the single source of truth for a data-dictionary term's "used in"
// back-references. Given a dictionary entry and the current coverages / rules / forms,
// it returns every entity where the term (its canonical name or a curated alias)
// ACTUALLY appears in a high-signal text field.
//
// Two properties make this trustworthy — the exact things a hostile review checks:
//   • Never stale — this is a PURE projection over live entities. Both the app (from
//     realtime data) and the AI grounding tool (from a fresh Firestore read) call it,
//     so the back-references always reflect the current corpus, never a snapshot.
//   • No false positives — matching is whole-word (lookarounds, not substring) over an
//     explicit alias set, so "Coverage A" matches "Coverage A — Dwelling" but not
//     "Coverage Amount", and generic words are simply never aliased.
//
// Pure TypeScript — zero platform imports (mirrors inventory.ts).

export type DictUsageKind = 'coverage' | 'rule' | 'form' | 'ratingStep'

/** One resolved back-reference: enough to render a deep-linked, chip-cited row. */
export interface DictUsageRef {
  kind:       DictUsageKind
  refId:      string        // coverage/rule refId or form number — the citable chip token
  label:      string        // human label (coverage/form name, or rule condition)
  entityPath: string        // Firestore path (audit + fallback routing)
  productId?: string        // owning product doc id, for deep-linking a product tab
}

/** The matchable shape of a dictionary entry — just what feeds the matcher. */
export interface DictEntryLike {
  name:     string
  aliases?: string[]
}

// ── Structural corpus shapes (line-agnostic; concrete Coverage/Rule/Form satisfy them) ──

export interface CoverageUsageLike {
  refId:       string | null
  name:        string
  terms?:      { label?: string; notes?: string; default?: unknown }[]
  productId?:  string
  entityPath?: string
}
export interface RuleUsageLike {
  refId:        string | null
  condition?:   string
  outcome?:     string
  subCategory?: string
  productId?:   string
  entityPath?:  string
}
export interface FormUsageLike {
  number:         string
  name?:          string
  description?:   string
  dynamicFields?: { name?: string }[]
  productRefIds?: string[]
  entityPath?:    string
}

/** One rating-program step whose label text is scanned for dictionary term mentions. */
export interface RatingStepUsageLike {
  programRefId: string   // e.g. 'PH.RAT.1'
  stepId:       string   // e.g. 's4a'
  label:        string   // step label text to scan
  productId?:   string
  entityPath?:  string   // Firestore path to the owning ratingProgram document
}

export interface DictUsageCorpus {
  coverages:    CoverageUsageLike[]
  rules:        RuleUsageLike[]
  forms:        FormUsageLike[]
  ratingSteps?: RatingStepUsageLike[]
}

// ── Matching ────────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A whole-word, case-insensitive matcher over an entry's name + aliases, or null when
 *  the entry has nothing to match on. Alnum lookarounds (not `\b`) so multi-word and
 *  punctuated aliases ("All-Peril Deductible", "Coverage A") match cleanly without
 *  bleeding into adjacent words. */
export function buildEntryMatcher(entry: DictEntryLike): ((text: string) => boolean) | null {
  const terms = [entry.name, ...(entry.aliases ?? [])]
    .map(t => (t ?? '').trim())
    .filter(Boolean)
  if (terms.length === 0) return null
  // Dedupe case-insensitively; longest first so the alternation is deterministic.
  const uniq = [...new Map(terms.map(t => [t.toLowerCase(), t])).values()]
    .sort((a, b) => b.length - a.length)
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${uniq.map(escapeRe).join('|')})(?![A-Za-z0-9])`, 'i')
  return (text: string) => !!text && re.test(text)
}

/** Compute the back-references for a single dictionary entry against the live corpus.
 *  Deduped by kind+refId (one row per entity, however many fields matched) and stably
 *  ordered coverages → rules → forms, then by refId. */
export function computeDictionaryUsage(entry: DictEntryLike, corpus: DictUsageCorpus): DictUsageRef[] {
  const matches = buildEntryMatcher(entry)
  if (!matches) return []

  const out: DictUsageRef[] = []
  const seen = new Set<string>()
  const add = (ref: DictUsageRef) => {
    if (!ref.refId) return
    const key = `${ref.kind}:${ref.refId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(ref)
  }

  for (const c of corpus.coverages) {
    const fields = [c.name, ...(c.terms ?? []).flatMap(t => [
      t.label ?? '', t.notes ?? '', typeof t.default === 'string' ? t.default : '',
    ])]
    if (fields.some(matches)) {
      add({ kind: 'coverage', refId: c.refId ?? '', label: c.name,
        entityPath: c.entityPath ?? '', productId: c.productId })
    }
  }
  for (const r of corpus.rules) {
    const fields = [r.condition ?? '', r.outcome ?? '', r.subCategory ?? '']
    if (fields.some(matches)) {
      add({ kind: 'rule', refId: r.refId ?? '', label: r.condition || r.subCategory || (r.refId ?? ''),
        entityPath: r.entityPath ?? '', productId: r.productId })
    }
  }
  for (const f of corpus.forms) {
    const fields = [f.name ?? '', f.description ?? '', ...(f.dynamicFields ?? []).map(d => d.name ?? '')]
    if (fields.some(matches)) {
      add({ kind: 'form', refId: f.number, label: f.name || f.number,
        entityPath: f.entityPath ?? `forms/${f.number.replace(/\s+/g, '-')}`,
        productId: f.productRefIds?.[0] })
    }
  }
  for (const s of corpus.ratingSteps ?? []) {
    if (matches(s.label)) {
      add({ kind: 'ratingStep', refId: `${s.programRefId}/${s.stepId}`, label: s.label,
        entityPath: s.entityPath ?? '', productId: s.productId })
    }
  }

  const rank: Record<DictUsageKind, number> = { coverage: 0, rule: 1, form: 2, ratingStep: 3 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.refId.localeCompare(b.refId))
}
