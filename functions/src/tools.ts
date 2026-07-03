// tools.ts — Firestore-backed grounding tools + the shared system prompt.
// The AI never answers from memory: every specific claim must come from a tool
// result and cite its refId / form number. Tool results are compact JSON so the
// model spends its context on reasoning, not boilerplate.
import { getFirestore } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import {
  evaluate, makeHO3RtGetter, makeHO3LdGetter, HO3_WORKED_EXAMPLE,
} from '@pf/shared'
import type {
  RatingInputs, RatingProgram, RTTable, LDTable, Coverage, Rule, Form,
  Product, DictionaryEntry, SearchIndexEntry,
} from '@pf/shared'

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
      'Execute the rating algorithm and return the final premium with a step-by-step trace. Pass programRef (e.g. HO.RAT.1) and any subset of inputs; unspecified inputs default to the standard $1,528 worked example. Use to trace or re-price a premium.',
    input_schema: {
      type: 'object',
      properties: {
        programRef: { type: 'string', description: 'Rating program refId, e.g. HO.RAT.1.' },
        inputs:     { type: 'object', description: 'Partial RatingInputs (territory, pc, construction, covA, allPerilDed, covCPct, covELimit, covFLimit, tier, deviceCredit, rcElected, windHailElected/windHailPct, waterBackupElected/waterBackupLimit, sppElected/sppItems). Merged over the worked example.' },
      },
      required: ['programRef'],
    },
  },
  {
    name: 'get_dictionary',
    description: 'Return a data-dictionary term by name (type, description, allowed values, format). Use for canonical field definitions.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Dictionary term name, e.g. "Coverage A" or "Protection Class".' } },
      required: ['name'],
    },
  },
]

// ─── System prompt (cacheable) ─────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are Product Factory's portfolio analyst for P&C insurance product managers. The reference product is an ISO-style Homeowners HO-3.

DATA MODEL (Firestore, all reachable via the tools):
- products → coverages (Coverage A–F plus endorsements; each has terms of kind LIMIT | DEDUCTIBLE | OPTION), rules (category PRODUCT | RATING | FORMS, each a condition → outcome), formRules, and ratingPrograms (ordered SET/MUL/ADD/MIN_FLOOR steps).
- forms — policy documents keyed by number (e.g. "HO 04 61"), with category, attachment condition and coverage parts.
- ldTables — Limit/Deductible option tables (refIds like HO.LD.002). rtTables — rate tables (refIds like HO.RT.003). dictionary — canonical field definitions.

REFERENCE IDs are the traceability backbone and must be preserved and cited exactly: coverage refIds (HO.COV.003.002), rule refIds (HO.RU.006), form-rule refIds (HO.FORM.RU.003), table refIds (HO.LD.002, HO.RT.003) and form numbers (HO 04 61, HO 04 90).

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
      case 'run_rating':       return await runRating(String(input.programRef ?? ''), (input.inputs as Partial<RatingInputs>) ?? {})
      case 'get_dictionary':   return await getDictionary(String(input.name ?? ''))
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

async function searchEntities(query: string, type?: string): Promise<ToolOutput> {
  const snap    = await getFirestore().collection('searchIndex').get()
  const tokens  = query.toLowerCase().split(/\W+/).filter(t => t.length > 1)
  const scored: Array<{ score: number; e: SearchIndexEntry }> = []

  for (const d of snap.docs) {
    const e = d.data() as SearchIndexEntry
    if (type && e.type !== type) continue
    const hay = `${e.title} ${e.subtitle} ${e.refId ?? ''} ${(e.keywords ?? []).join(' ')}`.toLowerCase()
    let score = 0
    for (const t of tokens) if (hay.includes(t)) score++
    if (score > 0 || tokens.length === 0) scored.push({ score, e })
  }
  scored.sort((a, b) => b.score - a.score)

  const hits = scored.slice(0, 15).map(({ e }) => ({ type: e.type, refId: e.refId ?? null, title: e.title, subtitle: e.subtitle, path: e.path }))
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

async function getForms(filter: Record<string, unknown>): Promise<ToolOutput> {
  const snap    = await getFirestore().collection('forms').get()
  const category     = filter.category as string | undefined
  const state        = (filter.state as string | undefined)?.toUpperCase()
  const formNumber   = (filter.formNumber as string | undefined)?.replace(/\s+/g, ' ').trim().toLowerCase()
  const coveragePart = (filter.coveragePart as string | undefined)?.toUpperCase()
  const search       = (filter.search as string | undefined)?.toLowerCase()

  const forms = snap.docs.map(d => d.data() as Form).filter(f => {
    if (category && f.category !== category) return false
    if (state && !f.allStates && !(f.states ?? []).includes(state)) return false
    if (formNumber && f.number.toLowerCase() !== formNumber) return false
    if (coveragePart && !(f.coverageParts ?? []).includes(coveragePart)) return false
    if (search && !`${f.number} ${f.name}`.toLowerCase().includes(search)) return false
    return true
  }).slice(0, 25).map(f => ({
    number: f.number, name: f.name, edition: f.edition, category: f.category,
    mandatoryDefault: f.mandatoryDefault, attachmentCondition: f.attachmentCondition,
    coverageParts: f.coverageParts, description: f.description || null,
  }))
  return { content: JSON.stringify(forms), summary: `${forms.length} form${forms.length === 1 ? '' : 's'}` }
}

async function getLdTable(refId: string): Promise<ToolOutput> {
  if (!refId) return { content: JSON.stringify({ error: 'refId required' }), summary: 'error' }
  const doc = await getFirestore().doc(`ldTables/${refId}`).get()
  if (!doc.exists) return { content: JSON.stringify({ found: false, refId }), summary: 'not found' }
  const t = doc.data() as LDTable
  return { content: JSON.stringify({ refId, name: t.name, defaultValue: t.defaultValue ?? null, rows: t.rows }), summary: `${t.rows?.length ?? 0} rows` }
}

async function runRating(programRef: string, partial: Partial<RatingInputs>): Promise<ToolOutput> {
  const db = getFirestore()
  const progSnap = await db.collectionGroup('ratingPrograms').where('refId', '==', programRef).limit(1).get()
  if (progSnap.empty) return { content: JSON.stringify({ found: false, programRef }), summary: 'not found' }

  const program = progSnap.docs[0]!.data() as RatingProgram
  const [rtSnap, ldSnap] = await Promise.all([db.collection('rtTables').get(), db.collection('ldTables').get()])
  const rtTables: Record<string, RTTable> = {}
  for (const d of rtSnap.docs) rtTables[d.id] = d.data() as RTTable
  const ldTables: Record<string, LDTable> = {}
  for (const d of ldSnap.docs) ldTables[d.id] = d.data() as LDTable

  const inputs: RatingInputs = { ...HO3_WORKED_EXAMPLE, ...partial }
  const { finalPremium, trace } = evaluate(program, inputs, makeHO3RtGetter(rtTables), makeHO3LdGetter(ldTables))
  const out = {
    programRef, finalPremium,
    trace: trace.map(t => ({ stepId: t.stepId, label: t.label, op: t.op, sourceRef: t.sourceRef, factorOrAmount: t.factorOrAmount, runningTotal: t.runningTotal })),
  }
  return { content: JSON.stringify(out), summary: `$${finalPremium.toLocaleString()}` }
}

async function getDictionary(name: string): Promise<ToolOutput> {
  if (!name) return { content: JSON.stringify({ error: 'name required' }), summary: 'error' }
  const db   = getFirestore()
  const snap = await db.collection('dictionary').get()
  const wanted = name.toLowerCase()
  const entry =
    snap.docs.map(d => d.data() as DictionaryEntry).find(e => e.name.toLowerCase() === wanted) ??
    snap.docs.map(d => d.data() as DictionaryEntry).find(e => e.name.toLowerCase().includes(wanted))
  if (!entry) return { content: JSON.stringify({ found: false, name }), summary: 'not found' }
  return {
    content: JSON.stringify({ name: entry.name, type: entry.type, description: entry.description, allowedValues: entry.allowedValues, format: entry.format }),
    summary: entry.name,
  }
}
