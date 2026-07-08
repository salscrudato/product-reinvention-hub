// tools.ts — Firestore-backed grounding tools + the shared system prompt.
// The AI never answers from memory: every specific claim must come from a tool
// result and cite its refId / form number. Tool results are compact JSON so the
// model spends its context on reasoning, not boilerplate.
import { getFirestore } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import {
  evaluate, resolveRatingKit, resolveLobByRefId, DEFAULT_LOB, rankDocuments,
  computeDictionaryUsage, normalizeFormNumber,
} from '@pf/shared'
import type { RankDoc, DictUsageCorpus, ChunkSourceType } from '@pf/shared'
import type {
  RatingInputMap, RatingProgram, RTTable, LDTable, Coverage, Rule, Form,
  Product, DictionaryEntry, SearchIndexEntry,
} from '@pf/shared'
import { retrieve } from './retrieval/index'
import { voyageKey } from './runtime'

// ─── Tool definitions (Anthropic schema) ───────────────────────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_entities',
    description:
      'Full-text search the portfolio index for products, coverages, rules, forms, tables or dictionary terms. Use first when you need to locate something by name or keyword. Returns each hit with its path and refId.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text, e.g. "scheduled personal property" or "HO.RU.006".' },
        type:  { type: 'string', enum: ['product', 'coverage', 'rule', 'form', 'ldTable', 'rtTable', 'dictionary', 'task'], description: 'Optional entity-type filter.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product_tree',
    description:
      'Return a product with its full coverage hierarchy (terms, requirement, form numbers), rating programs and collection counts. Omit productId to use the sole product in the portfolio.',
    input_schema: {
      type: 'object',
      properties: { productId: { type: 'string', description: 'Product document id (from a search path products/{id}). Optional.' } },
    },
  },
  {
    name: 'get_coverage',
    description: 'Return one coverage in full (terms with LD refs, requirement, claims basis, attached form numbers, state scope) by its refId, e.g. HO.COV.003.002.',
    input_schema: {
      type: 'object',
      properties: { refId: { type: 'string', description: 'Coverage refId, e.g. HO.COV.001.' } },
      required: ['refId'],
    },
  },
  {
    name: 'get_rules',
    description: 'Return product/rating/forms rules. Filter by coverageRefId (rules touching that coverage) or productId. Each rule has condition, outcome and the refIds/forms it references.',
    input_schema: {
      type: 'object',
      properties: {
        coverageRefId: { type: 'string', description: 'Return only rules referencing this coverage refId.' },
        productId:     { type: 'string', description: 'Product document id. Optional (defaults to sole product).' },
      },
    },
  },
  {
    name: 'get_forms',
    description: 'Return forms (documents) with optional filters. Use to see which forms exist and when they attach. Filter by category, state, a specific form number, product, or coverage part (A–F).',
    input_schema: {
      type: 'object',
      properties: {
        category:     { type: 'string', enum: ['BASE_COVERAGE', 'DECLARATIONS', 'ENDORSEMENT', 'EXCLUSION', 'AMENDATORY', 'POLICY_NOTICE'] },
        state:        { type: 'string', description: '2-letter state code; returns forms admitted in that state.' },
        formNumber:   { type: 'string', description: 'A specific form number, e.g. "HO 04 61".' },
        coveragePart: { type: 'string', description: 'Coverage part letter A–F.' },
        search:       { type: 'string', description: 'Free text over form name/number.' },
      },
    },
  },
  {
    name: 'get_ld_table',
    description: 'Return a Limit/Deductible option table by refId (e.g. HO.LD.002) — its rows, values and any per-row constraint notes.',
    input_schema: {
      type: 'object',
      properties: { refId: { type: 'string', description: 'LD table refId, e.g. HO.LD.001.' } },
      required: ['refId'],
    },
  },
  {
    name: 'run_rating',
    description:
      'Execute the rating algorithm and return the final premium with a step-by-step trace. Pass programRef (e.g. HO.RAT.1 or PA.RAT.1) and any subset of inputs; unspecified inputs default to that line\'s worked example (HO-3 $1,528, Personal Auto $1,002). Use to trace or re-price a premium.',
    input_schema: {
      type: 'object',
      properties: {
        programRef: { type: 'string', description: 'Rating program refId, e.g. HO.RAT.1 or PA.RAT.1.' },
        inputs:     { type: 'object', description: 'Partial rating inputs merged over the line\'s worked example. HO-3: territory, pc, construction, covA, allPerilDed, covCPct, covELimit, covFLimit, tier, deviceCredit, rcElected, windHailElected/windHailPct, waterBackupElected/waterBackupLimit, sppElected/sppItems. PA: territory, driverClass, biPdLimitCode, vehicleAgeClass, vehicleSymbol, tier, medPayElected, umElected, collisionElected/collisionDed, compElected/compDed, rentalElected/rentalCode, towingElected/towingLimit.' },
      },
      required: ['programRef'],
    },
  },
  {
    name: 'get_dictionary',
    description:
      'Return a governed data-dictionary definition by refId (e.g. HO.DEF.003) or name (e.g. "Coverage A Amount"). Gives type, description, allowed values, format, tags and a LIVE "used in" list of the coverages/rules/forms/rating-steps where the term actually appears (each with its own refId). Cite the definition by its refId, e.g. [HO.DEF.003].',
    input_schema: {
      type: 'object',
      properties: {
        refId: { type: 'string', description: 'Dictionary definition refId, e.g. HO.DEF.003 or PA.DEF.001. Preferred when known.' },
        name:  { type: 'string', description: 'Dictionary term name, e.g. "Coverage A Amount" or "Occurrence Limit".' },
      },
    },
  },
]

// ─── System prompt (cacheable) ─────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the Product Reinvention Hub portfolio analyst for P&C insurance product managers. The reference products are an ISO-style Homeowners HO-3 and an ISO-style Personal Auto Policy (PP 00 01); the platform is multi-line, so resolve every fact from the tools rather than assuming a line.

DATA MODEL (Firestore, all reachable via the tools):
- products → coverages (line-specific, e.g. HO-3 Coverage A–F or Personal Auto Parts A–D plus endorsements; each has terms of kind LIMIT | DEDUCTIBLE | OPTION), rules (category PRODUCT | RATING | FORMS, each a condition → outcome), formRules, and ratingPrograms (ordered SET/MUL/ADD/MIN_FLOOR steps).
- forms — policy documents keyed by number (e.g. "HO 04 61", "PP 00 01"), with category, attachment condition and coverage parts.
- ldTables — Limit/Deductible option tables (refIds like HO.LD.002, PA.LD.005). rtTables — rate tables (refIds like HO.RT.003, PA.RT.001). dictionary — governed field definitions, each with a citable refId (HO.DEF.003, PA.DEF.001) and a live list of the coverages/rules/forms it is used in.

REFERENCE IDs are the traceability backbone and must be preserved and cited exactly: coverage refIds (HO.COV.003.002, PA.COV.001.001), rule refIds (HO.RU.006, PA.RU.007), form-rule refIds (HO.FORM.RU.003, PA.FORM.RU.001), table refIds (HO.LD.002, PA.RT.001), dictionary definition refIds (HO.DEF.003, PA.DEF.001) and form numbers (HO 04 61, PP 00 01). When you define or explain what a field means, ground it with get_dictionary and cite the definition by its refId, e.g. [HO.DEF.003]. Never cite a definition refId that get_dictionary did not return.

HOUSE RULES — non-negotiable:
1. Assert ONLY what the tools return. Never invent coverages, forms, rules, limits, factors or premiums.
2. Cite every specific claim with its refId or form number in square brackets, e.g. [HO.RU.006] [HO 04 90]. One id per bracket.
3. If a tool returns nothing (found:false or an empty list), say so plainly — do not guess or fill the gap from prior knowledge.
4. Prefer calling a tool over answering from memory, and chain tools when needed (e.g. get_coverage to read a coverage's form numbers, then get_forms to describe them).
5. Be concise and concrete. Use the exact domain terminology and numbers the tools return.`

// ─── Dispatch ───────────────────────────────────────────────────────────────────

export interface ToolOutput {
  content: string   // compact JSON string returned to the model as the tool_result
  summary: string   // short human label for the UI status chip
}

/** Execute a grounding tool. Errors are returned (not thrown) so the model can recover. */
export async function runTool(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
  try {
    switch (name) {
      case 'search_entities': return await searchEntities(String(input.query ?? ''), input.type as string | undefined)
      case 'get_product_tree': return await getProductTree(input.productId as string | undefined)
      case 'get_coverage':     return await getCoverage(String(input.refId ?? ''))
      case 'get_rules':        return await getRules(input.coverageRefId as string | undefined, input.productId as string | undefined)
      case 'get_forms':        return await getForms(input)
      case 'get_ld_table':     return await getLdTable(String(input.refId ?? ''))
      case 'run_rating':       return await runRating(String(input.programRef ?? ''), (input.inputs as Partial<RatingInputMap>) ?? {})
      case 'get_dictionary':   return await getDictionary(input.name as string | undefined, input.refId as string | undefined)
      default: return { content: JSON.stringify({ error: `Unknown tool ${name}` }), summary: 'error' }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { content: JSON.stringify({ error: message }), summary: 'error' }
  }
}

// ─── Executors ───────────────────────────────────────────────────────────────────

/** Resolve the product id to use: the given one, or the sole product if omitted. */
async function resolveProductId(given?: string): Promise<string | null> {
  if (given) return given
  const snap = await getFirestore().collection('products').limit(2).get()
  return snap.size === 1 ? snap.docs[0]!.id : null
}

// Map the tool's coarse `type` filter to the chunk source types the index carries.
const SEARCH_TYPE_MAP: Record<string, ChunkSourceType[]> = {
  product:    ['product'],
  coverage:   ['coverage'],
  rule:       ['rule', 'formRule'],
  form:       ['form', 'baseForm'],
  ldTable:    ['ldTable'],
  rtTable:    ['rtTable'],
  dictionary: ['dictionary'],
}

async function searchEntities(query: string, type?: string): Promise<ToolOutput> {
  // Indexed retrieval (OBSERVATIONS B10): embed the query (or lexically rank), fetch the
  // top-k reranked chunks and return ONLY those with their metadata — not the whole
  // searchIndex. This is the input-token reduction per grounded turn.
  const types = type ? SEARCH_TYPE_MAP[type] : undefined
  const hits = await retrieve({ query, topK: 8, filter: types?.length ? { types } : undefined, voyageKey: voyageKey() })

  if (hits.length === 0) {
    // Safety net: the grounding index hasn't been built yet (reindexGrounding not run) —
    // fall back to the legacy searchIndex rank so discovery never returns empty meanwhile.
    return legacySearchEntities(query, type)
  }

  const results = hits.map(h => ({
    type: h.chunk.metadata.type, refId: h.chunk.metadata.refId, formNumber: h.chunk.metadata.formNumber,
    title: h.chunk.metadata.title, path: h.chunk.metadata.path,
    snippet: h.chunk.text.replace(/\s+/g, ' ').slice(0, 240),
    score: Math.round(h.score * 1000) / 1000,
  }))
  return { content: JSON.stringify(results), summary: `${results.length} result${results.length === 1 ? '' : 's'}` }
}

/** The original full-collection searchIndex rank — retained ONLY as the empty-index
 *  fallback for searchEntities (before the first reindexGrounding). Not the hot path. */
async function legacySearchEntities(query: string, type?: string): Promise<ToolOutput> {
  const snap = await getFirestore().collection('searchIndex').get()
  const entries = snap.docs
    .map(d => d.data() as SearchIndexEntry)
    .filter(e => !type || e.type === type)

  const docs: RankDoc[] = entries.map((e, i) => ({
    id: String(i),
    text: `${e.title} ${e.subtitle} ${e.refId ?? ''} ${e.refId ?? ''} ${(e.keywords ?? []).join(' ')}`,
  }))
  const ranked = rankDocuments(query, docs, 15).filter(r => r.score > 0 || !query.trim())

  const hits = ranked.map(r => {
    const e = entries[Number(r.id)]!
    return { type: e.type, refId: e.refId ?? null, title: e.title, subtitle: e.subtitle, path: e.path, score: Math.round(r.score * 1000) / 1000 }
  })
  return { content: JSON.stringify(hits), summary: `${hits.length} result${hits.length === 1 ? '' : 's'}` }
}

async function getProductTree(productIdArg?: string): Promise<ToolOutput> {
  const db        = getFirestore()
  const productId = await resolveProductId(productIdArg)
  if (!productId) return { content: JSON.stringify({ found: false, note: 'Specify productId — more than one product exists.' }), summary: 'not found' }

  const productDoc = await db.doc(`products/${productId}`).get()
  if (!productDoc.exists) return { content: JSON.stringify({ found: false }), summary: 'not found' }
  const p = productDoc.data() as Product

  const [covSnap, ruleSnap, ratingSnap] = await Promise.all([
    db.collection(`products/${productId}/coverages`).get(),
    db.collection(`products/${productId}/rules`).get(),
    db.collection(`products/${productId}/ratingPrograms`).get(),
  ])
  const formCount = await db.collection('forms').where('productRefIds', 'array-contains', productId).get().then(s => s.size).catch(() => 0)

  const coverages = covSnap.docs
    .map(d => d.data() as Coverage)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(c => ({
      refId: c.refId, name: c.name, parentId: c.parentId, requirement: c.requirement,
      premiumGenerating: c.premiumGenerating, formNumbers: c.formNumbers,
      terms: (c.terms ?? []).map(t => ({ label: t.label, kind: t.kind, ldTableRef: t.ldTableRef ?? null, default: t.default })),
    }))

  const tree = {
    productId,
    product: { refId: p.refId, name: p.name, marketSegment: p.marketSegment, lifecycle: p.lifecycle, allStates: p.allStates, states: p.states },
    coverages,
    ratingPrograms: ratingSnap.docs.map(d => { const r = d.data() as RatingProgram; return { refId: r.refId, name: r.name, minimumPremium: r.minimumPremium } }),
    counts: { coverages: covSnap.size, rules: ruleSnap.size, forms: formCount },
  }
  return { content: JSON.stringify(tree), summary: `${coverages.length} coverages` }
}

async function getCoverage(refId: string): Promise<ToolOutput> {
  if (!refId) return { content: JSON.stringify({ error: 'refId required' }), summary: 'error' }
  const snap = await getFirestore().collectionGroup('coverages').where('refId', '==', refId).limit(1).get()
  if (snap.empty) return { content: JSON.stringify({ found: false, refId }), summary: 'not found' }

  const c = snap.docs[0]!.data() as Coverage
  const out = {
    refId: c.refId, name: c.name, parentId: c.parentId, requirement: c.requirement,
    claimsBasis: c.claimsBasis, premiumGenerating: c.premiumGenerating, source: c.source,
    formNumbers: c.formNumbers, allStates: c.allStates, states: c.states,
    terms: c.terms ?? [],
  }
  return { content: JSON.stringify(out), summary: c.name }
}

async function getRules(coverageRefId?: string, productIdArg?: string): Promise<ToolOutput> {
  const db = getFirestore()
  let snap
  if (coverageRefId) {
    snap = await db.collectionGroup('rules').where('coverageRefIds', 'array-contains', coverageRefId).get()
  } else {
    const productId = await resolveProductId(productIdArg)
    const ref = productId ? db.collection(`products/${productId}/rules`) : db.collectionGroup('rules')
    snap = await ref.get()
  }

  const rules = snap.docs.map(d => d.data() as Rule).map(r => ({
    refId: r.refId, category: r.category, subCategory: r.subCategory,
    condition: r.condition, outcome: r.outcome,
    coverageRefIds: r.coverageRefIds, formNumbers: r.formNumbers, ldTableRef: r.ldTableRef ?? null,
  }))
  return { content: JSON.stringify(rules), summary: `${rules.length} rule${rules.length === 1 ? '' : 's'}` }
}

function projectForm(f: Form) {
  return {
    number: f.number, name: f.name, edition: f.edition, category: f.category,
    mandatoryDefault: f.mandatoryDefault, attachmentCondition: f.attachmentCondition,
    coverageParts: f.coverageParts, description: f.description || null,
  }
}

async function getForms(filter: Record<string, unknown>): Promise<ToolOutput> {
  const db         = getFirestore()
  const formNumber = (filter.formNumber as string | undefined)?.replace(/\s+/g, ' ').trim()
  const search     = (filter.search as string | undefined)?.trim()

  // Exact lookup by number → a direct doc read (the doc key is the number, spaces→dashes).
  if (formNumber) {
    const doc = await db.doc(`forms/${formNumber.replace(/\s+/g, '-')}`).get()
    const out = doc.exists ? [projectForm(doc.data() as Form)] : []
    return { content: JSON.stringify(out), summary: `${out.length} form${out.length === 1 ? '' : 's'}` }
  }

  // Free-text discovery → semantic retrieval over form chunks, then targeted reads of the
  // matched forms (top-k, not a full-collection scan).
  if (search) {
    const hits = await retrieve({ query: search, topK: 10, filter: { types: ['form'] }, voyageKey: voyageKey() })
    if (hits.length) {
      const docs  = await Promise.all(hits.map(h => db.doc(h.chunk.metadata.path).get()))
      const forms = docs.filter(d => d.exists).map(d => projectForm(d.data() as Form))
      return { content: JSON.stringify(forms), summary: `${forms.length} form${forms.length === 1 ? '' : 's'}` }
    }
    // fall through to the structured read if the index isn't built yet
  }

  // Structured filters (category/state/coveragePart) over the small global forms collection.
  const snap         = await db.collection('forms').get()
  const category     = filter.category as string | undefined
  const state        = (filter.state as string | undefined)?.toUpperCase()
  const coveragePart = (filter.coveragePart as string | undefined)?.toUpperCase()
  const searchLc     = search?.toLowerCase()

  const forms = snap.docs.map(d => d.data() as Form).filter(f => {
    if (category && f.category !== category) return false
    if (state && !f.allStates && !(f.states ?? []).includes(state)) return false
    if (coveragePart && !(f.coverageParts ?? []).includes(coveragePart)) return false
    if (searchLc && !`${f.number} ${f.name}`.toLowerCase().includes(searchLc)) return false
    return true
  }).slice(0, 25).map(projectForm)
  return { content: JSON.stringify(forms), summary: `${forms.length} form${forms.length === 1 ? '' : 's'}` }
}

async function getLdTable(refId: string): Promise<ToolOutput> {
  if (!refId) return { content: JSON.stringify({ error: 'refId required' }), summary: 'error' }
  const doc = await getFirestore().doc(`ldTables/${refId}`).get()
  if (!doc.exists) return { content: JSON.stringify({ found: false, refId }), summary: 'not found' }
  const t = doc.data() as LDTable
  return { content: JSON.stringify({ refId, name: t.name, defaultValue: t.defaultValue ?? null, rows: t.rows }), summary: `${t.rows?.length ?? 0} rows` }
}

async function runRating(programRef: string, partial: Partial<RatingInputMap>): Promise<ToolOutput> {
  const db = getFirestore()
  const progSnap = await db.collectionGroup('ratingPrograms').where('refId', '==', programRef).limit(1).get()
  if (progSnap.empty) return { content: JSON.stringify({ found: false, programRef }), summary: 'not found' }

  const program = progSnap.docs[0]!.data() as RatingProgram
  const [rtSnap, ldSnap] = await Promise.all([db.collection('rtTables').get(), db.collection('ldTables').get()])
  const rtTables: Record<string, RTTable> = {}
  for (const d of rtSnap.docs) rtTables[d.id] = d.data() as RTTable
  const ldTables: Record<string, LDTable> = {}
  for (const d of ldSnap.docs) ldTables[d.id] = d.data() as LDTable

  // Resolve the line's rating kit from the program refId (HO.RAT.1 → HO, PA.RAT.1 → PA)
  // so the getters + worked-example defaults match the product being priced.
  const kit = resolveRatingKit((resolveLobByRefId(programRef) ?? DEFAULT_LOB).prefix)
  const inputs: RatingInputMap = { ...kit.workedExample, ...partial }
  const { finalPremium, trace } = evaluate(program, inputs, kit.makeRtGetter(rtTables), kit.makeLdGetter(ldTables))
  const out = {
    programRef, finalPremium,
    trace: trace.map(t => ({ stepId: t.stepId, label: t.label, op: t.op, sourceRef: t.sourceRef, factorOrAmount: t.factorOrAmount, runningTotal: t.runningTotal })),
  }
  return { content: JSON.stringify(out), summary: `$${finalPremium.toLocaleString()}` }
}

async function getDictionary(name?: string, refId?: string): Promise<ToolOutput> {
  const wantedRef  = refId?.trim()
  const wantedName = name?.trim()
  if (!wantedRef && !wantedName) return { content: JSON.stringify({ error: 'Provide a dictionary refId or name.' }), summary: 'error' }

  const db = getFirestore()
  let entry: DictionaryEntry | undefined

  // refId is exact + authoritative → a targeted query (no full-collection scan).
  if (wantedRef) {
    const snap = await db.collection('dictionary').where('refId', '==', wantedRef).limit(1).get()
    entry = snap.empty ? undefined : (snap.docs[0]!.data() as DictionaryEntry)
  }

  // Name → semantic retrieval to find the right definition, then a targeted read of it.
  if (!entry && wantedName) {
    const hits   = await retrieve({ query: wantedName, topK: 3, filter: { types: ['dictionary'] }, voyageKey: voyageKey() })
    const hitRef = hits.map(h => h.chunk.metadata.refId).find((r): r is string => !!r)
    if (hitRef) {
      const snap = await db.collection('dictionary').where('refId', '==', hitRef).limit(1).get()
      entry = snap.empty ? undefined : (snap.docs[0]!.data() as DictionaryEntry)
    }
    if (!entry) {
      // Fallback (index not built): exact-then-contains over the collection.
      const all = (await db.collection('dictionary').get()).docs.map(d => d.data() as DictionaryEntry)
      const lc  = wantedName.toLowerCase()
      entry = all.find(e => e.name.toLowerCase() === lc) ?? all.find(e => e.name.toLowerCase().includes(lc))
    }
  }

  if (!entry) return { content: JSON.stringify({ found: false, query: refId ?? name ?? '' }), summary: 'not found' }

  // Recompute "used in" LIVE from the current corpus so a cited definition never points
  // at a stale reference. This back-reference list is deliberately EXHAUSTIVE (not a top-k
  // retrieval): completeness of "where a term is used" is a data-truth guarantee, so
  // loadUsageCorpus stays a bounded corpus read here rather than a lossy nearest-neighbour
  // query. (The definition LOOKUP above is what moved to indexed retrieval.)
  const usage = computeDictionaryUsage(entry, await loadUsageCorpus())
  return {
    content: JSON.stringify({
      found: true,
      refId: entry.refId, name: entry.name, type: entry.type,
      description: entry.description, allowedValues: entry.allowedValues,
      format: entry.format, tags: entry.tags, aliases: entry.aliases ?? [],
      usedIn: usage.map(u => ({ kind: u.kind, refId: u.refId, label: u.label })),
    }),
    summary: entry.refId ?? entry.name,
  }
}

// ─── Citation resolver — the live catalogue of every real refId + form number ───
// The "grounded + cited" invariant applied to free-prose answers: functions/src/ai.ts
// verifies each [refId] / [form number] the chat model cites against these sets and
// flags any that don't resolve, so a fabricated reference is never shown as if verified.
// Built from the SAME collections the grounding tools read — the live mirror of the
// eval's KNOWN_REF_IDS / KNOWN_FORM_NUMBERS. refIds are upper-cased; form numbers are
// normalised (compare with token.toUpperCase() / normalizeFormNumber(token)).
// NOTE (OBSERVATIONS B10): these are full-collection reads — cheap at seed scale, run
// once per chat request; swap for targeted lookups before portfolio scale.
export interface KnownCitations { refIds: Set<string>; formNumbers: Set<string> }

export async function loadKnownCitations(): Promise<KnownCitations> {
  const db = getFirestore()
  const [covG, ruleG, frG, rpG, ldSnap, rtSnap, dictSnap, prodSnap, formSnap] = await Promise.all([
    db.collectionGroup('coverages').get(),
    db.collectionGroup('rules').get(),
    db.collectionGroup('formRules').get(),
    db.collectionGroup('ratingPrograms').get(),
    db.collection('ldTables').get(),
    db.collection('rtTables').get(),
    db.collection('dictionary').get(),
    db.collection('products').get(),
    db.collection('forms').get(),
  ])

  const refIds = new Set<string>()
  const add = (v: unknown): void => { if (typeof v === 'string' && v.trim()) refIds.add(v.trim().toUpperCase()) }
  for (const d of covG.docs)   add((d.data() as Coverage).refId)
  for (const d of ruleG.docs)  add((d.data() as Rule).refId)
  for (const d of frG.docs)    add((d.data() as { refId?: string }).refId)
  for (const d of rpG.docs)    add((d.data() as RatingProgram).refId)
  for (const d of ldSnap.docs) add(d.id)     // ldTables / rtTables doc id IS the refId
  for (const d of rtSnap.docs) add(d.id)
  for (const d of dictSnap.docs) add((d.data() as DictionaryEntry).refId)
  for (const d of prodSnap.docs) { add(d.id); add((d.data() as Product).refId) }

  const formNumbers = new Set<string>()
  for (const d of formSnap.docs) {
    const n = (d.data() as Form).number
    if (n) formNumbers.add(normalizeFormNumber(n))
  }
  return { refIds, formNumbers }
}

/** Load the coverages + rules + forms + rating-step corpus for computing dictionary
 *  back-references. Uses collection-group reads so every product contributes; productId
 *  is parsed from the sub-collection path (products/{pid}/coverages/{cid}). */
async function loadUsageCorpus(): Promise<DictUsageCorpus> {
  const db = getFirestore()
  const [covSnap, ruleSnap, formSnap, rpSnap] = await Promise.all([
    db.collectionGroup('coverages').get(),
    db.collectionGroup('rules').get(),
    db.collection('forms').get(),
    db.collectionGroup('ratingPrograms').get(),
  ])
  const pidOf = (path: string) => path.split('/')[1]   // products/<pid>/...
  return {
    coverages: covSnap.docs.map(d => {
      const c = d.data() as Coverage
      return { refId: c.refId, name: c.name, terms: c.terms, productId: pidOf(d.ref.path), entityPath: d.ref.path }
    }),
    rules: ruleSnap.docs.map(d => {
      const r = d.data() as Rule
      return { refId: r.refId, condition: r.condition, outcome: r.outcome, subCategory: r.subCategory, productId: pidOf(d.ref.path), entityPath: d.ref.path }
    }),
    forms: formSnap.docs.map(d => {
      const f = d.data() as Form
      return { number: f.number, name: f.name, description: f.description, dynamicFields: f.dynamicFields, productRefIds: f.productRefIds, entityPath: d.ref.path }
    }),
    ratingSteps: rpSnap.docs.flatMap(d => {
      const rp = d.data() as RatingProgram
      const pid = pidOf(d.ref.path)
      return (rp.steps ?? []).map((s: { id: string; label: string }) => ({
        programRefId: rp.refId ?? d.id, stepId: s.id, label: s.label,
        productId: pid, entityPath: d.ref.path,
      }))
    }),
  }
}
