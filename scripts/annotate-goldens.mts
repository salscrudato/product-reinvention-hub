#!/usr/bin/env tsx
/**
 * scripts/annotate-goldens.mts — CE2 dual-family GOLDEN FACTORY.
 *
 * Builds cell-level golden2 truth from the REAL reference corpus by annotating each
 * substance window with TWO independent model families, reconciling deterministically,
 * adjudicating only genuine disagreements with a third family, and byte-verifying every
 * accepted citation with a cheap swarm. No family disagreement is ever auto-resolved by
 * the harness — it lands in the human review queue.
 *
 *   Annotator A : GROUNDED_CITED  (claude-opus-4-8, Anthropic forced-tool)
 *   Annotator B : VISION          (gpt-5.1,        OpenAI json_object)
 *   Adjudicator : DEEP_REASONER   (gpt-5.4-pro,    OpenAI /responses)   [disagreements only]
 *   Verifier    : BULK_VERIFY      (claude-haiku-4-5, Anthropic)         [citation byte-check]
 *
 * Model ids resolve through the fleet registry (@pf/shared) — never hardcoded. Spend is
 * metered through the same FLEET_PRICING and HARD-STOPPED at 250 USD (ledger-note BLOCKED).
 *
 * Modes:
 *   --probe <name>     annotate the first N substance windows of one file, report cost, write nothing durable
 *   --only <name,...>  restrict the run to named files
 *   --file <path>      annotate an arbitrary workbook (used by the mutation fuzz)
 *   (default)          annotate the 8-file corpus, budget-bounded, checkpointed, resumable
 *
 * Idempotent: per (file,window) checkpoints under samples/goldens2/.progress/. Re-running
 * skips completed windows. Costs logged per file; hard 250 USD stop.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { resolveDeployment, EXTENDED_DEPLOYMENTS, estimateCostUsd } from '@pf/shared'
import {
  readWorkbookCells, buildWindows, sheetDigest, classifySheet, distinctTotals,
  distinctRefIds, type EnumSheet, type EnumCell, type CellWindow,
} from './lib/cell-enum.mts'
import {
  DISPOSITIONS, KINDS, NOISE_RULES, EDGE_TYPES, EDGE_MECHANISMS, canonicalizeNumeric,
  validateGolden2File, type Golden2File, type Golden2Cell, type Golden2Entity, type Golden2Edge,
  type Golden2Sheet, type AnnotationCoverage,
} from './lib/golden2-schema.mts'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dir, '..')
const GOLDENS = resolve(REPO, 'samples/goldens2')
const PROGRESS = resolve(GOLDENS, '.progress')
const CORPUS_DIR = resolve(REPO, 'samples/corpus-2026-07')

// ─── Spend guard ────────────────────────────────────────────────────────────
const SPEND_TARGET = Number(process.env.CE2_SPEND_TARGET_USD) || 190   // stop starting new files past this
const SPEND_HARD = Number(process.env.CE2_SPEND_HARD_USD) || 250       // never exceed (ledger BLOCKED)
let spend = 0
const spendByFile: Record<string, number> = {}
class BudgetExceeded extends Error {}
function record(deployment: string, inTok: number, outTok: number, file: string) {
  const c = estimateCostUsd(deployment, inTok, outTok)
  spend += c
  spendByFile[file] = (spendByFile[file] ?? 0) + c
  if (spend >= SPEND_HARD) throw new BudgetExceeded(`hard stop: spend ${spend.toFixed(2)} >= ${SPEND_HARD}`)
}

// ─── Foundry creds (env first; gitignored keys.md fallback for local dev) ──────
function creds(): { endpoint: string; key: string } {
  let endpoint = (process.env.AZURE_FOUNDRY_ENDPOINT || '').replace(/\/+$/, '')
  let key = process.env.AZURE_FOUNDRY_KEY || ''
  if (!endpoint || !key) {
    // keys.md is gitignored, so a git worktree does NOT check it out — fall back to the
    // parent repo's copy (worktree lives at <repo>/.claude/worktrees/<lane>).
    const candidates = [resolve(REPO, 'keys.md'), resolve(REPO, '../../../keys.md'), resolve(REPO, '../../../../keys.md')]
    const km = candidates.find(p => existsSync(p))
    if (km) {
      const t = readFileSync(km, 'utf8')
      endpoint ||= ((t.match(/`AZURE_FOUNDRY_ENDPOINT`[^|]*\|\s*`([^`]+)`/) || [])[1] || '').replace(/\/+$/, '')
      key ||= (t.match(/AZURE_FOUNDRY_KEY[^|]*\|\s*`([^`]+)`/) || [])[1] || ''
    }
  }
  if (!endpoint || !key) { console.error('Set AZURE_FOUNDRY_ENDPOINT + AZURE_FOUNDRY_KEY (or keep keys.md in the repo root).'); process.exit(2) }
  return { endpoint, key }
}
const { endpoint: ENDPOINT, key: KEY } = creds()
const ANTHROPIC_VERSION = '2023-06-01'

const WINDOW_OPTS = { maxRows: 24, maxCols: 14, rowOverlap: 2 } as const

const OPUS = resolveDeployment('GROUNDED_CITED').deploymentName
const GPT_VISION = resolveDeployment('VISION').deploymentName
const HAIKU = resolveDeployment('BULK_VERIFY').deploymentName
const GPT_DEEP = EXTENDED_DEPLOYMENTS.DEEP_REASONER.deploymentName

// The Foundry endpoint throws sustained 500/503 overload spikes. For an unattended overnight
// run, be PATIENT — ride out a spike per-call (up to ~4 min) rather than skipping the window,
// so a resume does not have to re-attempt everything. Tunable via CE2_RETRIES / CE2_BACKOFF_CAP_MS.
const RETRIES = Number(process.env.CE2_RETRIES) || 7
const BACKOFF_CAP_MS = Number(process.env.CE2_BACKOFF_CAP_MS) || 45_000
async function withRetry<T>(fn: () => Promise<T>, label: string, tries = RETRIES): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try { return await fn() }
    catch (e) {
      lastErr = e
      if (e instanceof BudgetExceeded) throw e
      const msg = String((e as Error).message || e)
      const transient = /429|500|502|503|504|overloaded|timeout|ETIMEDOUT|ECONNRESET|fetch failed|aborted/i.test(msg)
      if (!transient || i === tries - 1) break
      const backoff = Math.min(BACKOFF_CAP_MS, Math.round(1800 * Math.pow(1.8, i) * (1 + (i * 7 % 5) / 10)))   // deterministic jitter
      console.log(`    ${label}: transient (${msg.slice(0, 70)}) — retry ${i + 1}/${tries - 1} in ${Math.round(backoff / 1000)}s`)
      await new Promise(r => setTimeout(r, backoff))
    }
  }
  throw lastErr
}

async function anthropicTool(deployment: string, system: string, userText: string, tool: unknown, file: string, maxTokens = 8000): Promise<Record<string, unknown>> {
  return withRetry(async () => {
    const body = {
      model: deployment, max_tokens: maxTokens, system,
      tools: [tool], tool_choice: { type: 'tool', name: (tool as { name: string }).name },
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    }
    const r = await fetch(`${ENDPOINT}/anthropic/v1/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(body), signal: AbortSignal.timeout(240_000),
    })
    const txt = await r.text()
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${txt.slice(0, 200)}`)
    const j = JSON.parse(txt) as { content?: { type: string; input?: Record<string, unknown> }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    record(deployment, j.usage?.input_tokens || 0, j.usage?.output_tokens || 0, file)
    const tu = (j.content || []).find(b => b.type === 'tool_use')
    return tu?.input ?? {}
  }, `anthropic:${deployment}`)
}

async function openaiJson(deployment: string, system: string, userText: string, file: string, maxTokens = 8000): Promise<Record<string, unknown>> {
  return withRetry(async () => {
    const body = {
      model: deployment,
      messages: [{ role: 'system', content: system }, { role: 'user', content: userText }],
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }
    const r = await fetch(`${ENDPOINT}/openai/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(240_000),
    })
    const txt = await r.text()
    if (!r.ok) throw new Error(`openai ${r.status}: ${txt.slice(0, 200)}`)
    const j = JSON.parse(txt) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    record(deployment, j.usage?.prompt_tokens || 0, j.usage?.completion_tokens || 0, file)
    return safeJson(j.choices?.[0]?.message?.content ?? '{}')
  }, `openai:${deployment}`)
}

async function openaiResponses(deployment: string, input: string, file: string, maxTokens = 6000, tries = RETRIES): Promise<Record<string, unknown>> {
  return withRetry(async () => {
    const body = { model: deployment, input, max_output_tokens: maxTokens }
    const r = await fetch(`${ENDPOINT}/openai/v1/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(300_000),
    })
    const txt = await r.text()
    if (!r.ok) throw new Error(`responses ${r.status}: ${txt.slice(0, 200)}`)
    const j = JSON.parse(txt) as { output?: { content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    record(deployment, j.usage?.input_tokens || 0, j.usage?.output_tokens || 0, file)
    const text = (j.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('')
    return safeJson(text)
  }, `responses:${deployment}`, tries)
}

function safeJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) } catch { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* */ } }
  return {}
}

// ─── The insurance glossary + annotation contract shared by BOTH families ──────
const GLOSSARY = `
INSURANCE PRODUCT MODEL (annotate against this, nothing else):
- Product: a sellable insurance product (a Line/LOB instance). kind="product".
- Coverage: a peril/benefit the product insures. kind="coverage".
- Sub-Coverage: a coverage nested UNDER a parent coverage (strict hierarchy Product > Coverage > Sub-Coverage). kind="subCoverage"; set parentRef to the parent coverage's id/name.
- Limit: a monetary/quantity cap tied to a coverage. kind="limit".
- Deductible: a retained amount tied to a coverage. kind="deductible".
- Form: an ISO/carrier form number attached to a coverage/product (e.g. "CG 00 01", "HO 00 03"). kind="form".
- Rule: an eligibility/underwriting/rating rule. kind="rule".
- Rating step / factor / table: a rating factor, base rate, or lookup table. kind="ratingStep" or "table".
- State: a jurisdiction a coverage/rule applies in. kind="state".

DISPOSITIONS (forced choice, exactly one per cell):
- ENTITY  a cell that ANCHORS one of the above (an id cell or the name cell of a product/coverage/rule/form/table).
- ATTR    a cell that is an ATTRIBUTE of an entity (a limit value, deductible, factor, state, effective date).
- HEADER  a column/section header that structures a table (load-bearing, not data).
- SCHEMA  definitions / data-validation / dropdown-authority MEANING (not an instance).
- LOG     revision/observation/question log content (process history).
- NOISE   decoration, blank labels, table-of-contents, contacts, archive copies. NOISE REQUIRES a noiseRule from:
          ${NOISE_RULES.join(', ')}.

LAWS:
- FLAG, DON'T INVENT: if a cell does not establish a value, classify what you SEE; never fabricate an entity the cells do not support.
- CITATIONS OR DISCARDED: every entity you return MUST carry >=1 citation "SheetName!A1" pointing at a cell in THIS window whose value grounds it.
- FORCED CHOICE + UNKNOWN: if you cannot confidently classify a cell, DO NOT guess — put its ref in "unclassified".
- Definitions and Data Validation are SCHEMA, never NOISE.
- refIds / form numbers are byte-load-bearing: copy them verbatim, never normalize.

Return ONLY the structured object: cells[], entities[], edges[], unclassified[].`

function annotationSystem(family: 'A' | 'B'): string {
  const lens = family === 'A'
    ? 'You are a meticulous insurance product data steward reasoning from first principles about the product hierarchy.'
    : 'You are a careful table-structure analyst reading the grid spatially: headers label columns, ids anchor rows, values fill cells.'
  return `${lens}\n${GLOSSARY}\n${COMPACT_INSTRUCTIONS}`
}

// Render a window into a compact prompt both families see identically.
function renderWindow(w: CellWindow, digest: ReturnType<typeof sheetDigest>): string {
  const clip = (v: EnumCell['value']) => { const s = v === null ? '' : String(v); return s.length > 220 ? s.slice(0, 220) + '…' : s }
  const header = w.headerRefs.length
    ? 'COLUMN HEADERS (carried from the header row):\n' + w.headerRefs.map(h => `  ${h.ref} = ${clip(h.value)}`).join('\n') + '\n'
    : ''
  const sample = digest.headerRow != null
    ? `HEADER ROW: ${digest.headerRow + 1}. Sample data rows: ${digest.sampleRows.map(r => `[r${r.row + 1}: ${r.values.map(v => clip(v)).join(' | ')}]`).join('  ')}\n`
    : ''
  const cells = w.cells.map(c => `${c.ref}${c.mergeRange ? `(merged ${c.mergeRange})` : ''} = ${clip(c.value)}`).join('\n')
  return `SHEET "${w.sheet}"${w.hidden ? ' [HIDDEN SHEET]' : ''}  window ${w.index + 1}/${w.total}  rows ${w.rowStart + 1}-${w.rowEnd + 1}, cols ${w.colStart + 1}-${w.colEnd + 1}\n`
    + `${sample}${header}\nNON-EMPTY CELLS (classify EVERY one):\n${cells}\n`
}

// COMPACT structured-output contract. Per-cell objects blow past max_tokens on a 40x40
// window (~90 tok/cell -> truncation -> empty tool call). Instead the model returns REF
// LISTS grouped by disposition (~1-3 tok/ref), a few rich entities, and optional attr->entity
// links. Cell kind/ofEntity for ENTITY cells is DERIVED from the entities that cite them.
const REFS = { type: 'array', items: { type: 'string' } }
const ANNOTATE_SCHEMA = {
  type: 'object',
  properties: {
    dispositions: { type: 'object', properties: { ENTITY: REFS, ATTR: REFS, HEADER: REFS, SCHEMA: REFS, LOG: REFS } },
    noise: { type: 'array', items: { type: 'object', properties: { rule: { type: 'string', enum: [...NOISE_RULES] }, refs: REFS }, required: ['rule', 'refs'] } },
    entities: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string' }, refId: { type: ['string', 'null'] }, name: { type: 'string' },
      parentRef: { type: ['string', 'null'] }, citations: REFS,
    }, required: ['kind', 'name', 'citations'] } },
    edges: { type: 'array', items: { type: 'object', properties: {
      type: { type: 'string', enum: [...EDGE_TYPES] }, from: { type: 'string' }, to: { type: 'string' },
      mechanism: { type: 'string', enum: [...EDGE_MECHANISMS] },
    }, required: ['type', 'from', 'to', 'mechanism'] } },
    attrLinks: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' }, ofEntity: { type: 'string' } }, required: ['ref', 'ofEntity'] } },
    unclassified: REFS,
  },
  required: ['dispositions', 'entities', 'unclassified'],
}
const ANNOTATE_TOOL = { name: 'annotate_window', description: 'Return golden2 annotations: ref-lists per disposition, entities with cell-ref citations, edges.', input_schema: ANNOTATE_SCHEMA }
const COMPACT_INSTRUCTIONS = `\nOUTPUT SHAPE (compact — use CELL REFS like "A6", NOT full objects):\n`
  + `{ "dispositions": { "ENTITY":[refs], "ATTR":[refs], "HEADER":[refs], "SCHEMA":[refs], "LOG":[refs] },\n`
  + `  "noise": [ {"rule":"NOISE.TOC","refs":[...]} ],  "entities": [ {"kind","refId"|null,"name","parentRef"|null,"citations":[cell refs in THIS window]} ],\n`
  + `  "edges": [ {"type","from","to","mechanism"} ],  "attrLinks": [ {"ref","ofEntity": entity refId/name} ],  "unclassified": [refs] }\n`
  + `Every non-empty cell ref MUST appear in exactly ONE of: a dispositions list, a noise refs list, or unclassified. Citations are bare cell refs (e.g. "A6").`

interface WindowAnnotation { cells: Golden2Cell[]; entities: Golden2Entity[]; edges: Golden2Edge[]; unclassified: string[] }

function coerceAnnotation(raw: Record<string, unknown>, windowRefs: Set<string>): WindowAnnotation {
  // Entities first — they drive the derived kind/ofEntity for ENTITY cells.
  const entities: Golden2Entity[] = []
  for (const e of (Array.isArray(raw.entities) ? raw.entities : []) as Record<string, unknown>[]) {
    const citations = (Array.isArray(e.citations) ? e.citations : []).map(String).map(s => s.includes('!') ? s.slice(s.lastIndexOf('!') + 1) : s).filter(r => windowRefs.has(r))
    if (citations.length === 0) continue                     // citations-or-discarded
    entities.push({ kind: String(e.kind ?? ''), refId: e.refId == null ? null : String(e.refId), name: String(e.name ?? ''), parentRef: e.parentRef == null ? null : String(e.parentRef), citations })
  }
  const kindByRef = new Map<string, string>(); const entByRef = new Map<string, string>()
  for (const e of entities) for (const c of e.citations) { if (!kindByRef.has(c)) kindByRef.set(c, e.kind); if (!entByRef.has(c)) entByRef.set(c, e.refId ?? e.name) }
  const attrLink = new Map<string, string>()
  for (const l of (Array.isArray(raw.attrLinks) ? raw.attrLinks : []) as Record<string, unknown>[]) if (l.ref && l.ofEntity) attrLink.set(String(l.ref), String(l.ofEntity))

  const assigned = new Set<string>()
  const cells: Golden2Cell[] = []
  const push = (ref: string, disposition: Golden2Cell['disposition'], kind: Golden2Cell['kind'], ofEntity: string | null, noiseRule: Golden2Cell['noiseRule']) => {
    if (!windowRefs.has(ref) || assigned.has(ref)) return
    assigned.add(ref); cells.push({ ref, disposition, kind, ofEntity, noiseRule })
  }
  const disp = (raw.dispositions ?? {}) as Record<string, unknown>
  const kindOf = (k: string | undefined) => (k && (KINDS as readonly string[]).includes(k) ? k as Golden2Cell['kind'] : null)
  // Priority ENTITY > ATTR > HEADER > SCHEMA > LOG > NOISE (first assignment wins).
  for (const ref of (Array.isArray(disp.ENTITY) ? disp.ENTITY : []).map(String)) push(ref, 'ENTITY', kindOf(kindByRef.get(ref)), entByRef.get(ref) ?? null, null)
  for (const ref of (Array.isArray(disp.ATTR) ? disp.ATTR : []).map(String)) push(ref, 'ATTR', null, attrLink.get(ref) ?? null, null)
  for (const ref of (Array.isArray(disp.HEADER) ? disp.HEADER : []).map(String)) push(ref, 'HEADER', null, null, null)
  for (const ref of (Array.isArray(disp.SCHEMA) ? disp.SCHEMA : []).map(String)) push(ref, 'SCHEMA', null, null, null)
  for (const ref of (Array.isArray(disp.LOG) ? disp.LOG : []).map(String)) push(ref, 'LOG', null, null, null)
  for (const grp of (Array.isArray(raw.noise) ? raw.noise : []) as Record<string, unknown>[]) {
    let rule = String(grp.rule ?? '') as Golden2Cell['noiseRule']
    if (!rule || !(NOISE_RULES as readonly string[]).includes(rule)) rule = 'NOISE.DECORATION'
    for (const ref of (Array.isArray(grp.refs) ? grp.refs : []).map(String)) push(ref, 'NOISE', null, null, rule)
  }
  const edges: Golden2Edge[] = []
  for (const ed of (Array.isArray(raw.edges) ? raw.edges : []) as Record<string, unknown>[]) {
    const type = String(ed.type ?? '') as Golden2Edge['type']
    const mechanism = String(ed.mechanism ?? '') as Golden2Edge['mechanism']
    if (!(EDGE_TYPES as readonly string[]).includes(type) || !(EDGE_MECHANISMS as readonly string[]).includes(mechanism)) continue
    if (!ed.from || !ed.to) continue
    edges.push({ type, from: String(ed.from), to: String(ed.to), mechanism })
  }
  const unclassified = (Array.isArray(raw.unclassified) ? raw.unclassified : []).map(String).filter(r => windowRefs.has(r) && !assigned.has(r))
  return { cells, entities, edges, unclassified }
}

// ─── Reconcile A vs B deterministically ────────────────────────────────────────
interface Reconciled {
  cells: Golden2Cell[]; entities: Golden2Entity[]; edges: Golden2Edge[]
  disagreements: { kind: 'cell' | 'entity'; ref: string; a: unknown; b: unknown }[]
  queued: { ref: string; reason: string; a: unknown; b: unknown }[]
}
const normKind = (k: string | null) => (k ?? '').toLowerCase()
// Kind reconcile when the two families AGREE on disposition: agree -> that; one null -> the other;
// genuine kind conflict -> keep A's (GROUNDED_CITED opus is the stronger reader) and record it as
// a soft note, not a blocking disagreement. Disposition is the accounting-critical label; kind is
// secondary, so we do not pay the adjudicator for a kind-only difference.
function reconcileKind(ak: string | null, bk: string | null): string | null {
  if (normKind(ak) === normKind(bk)) return ak
  if (!ak) return bk
  if (!bk) return ak
  return ak
}
function reconcile(a: WindowAnnotation, b: WindowAnnotation): Reconciled {
  const out: Reconciled = { cells: [], entities: [], edges: [], disagreements: [], queued: [] }
  const aCell = new Map(a.cells.map(c => [c.ref, c]))
  const bCell = new Map(b.cells.map(c => [c.ref, c]))
  const aUn = new Set(a.unclassified); const bUn = new Set(b.unclassified)
  const refs = new Set([...aCell.keys(), ...bCell.keys(), ...aUn, ...bUn])
  for (const ref of refs) {
    const ca = aCell.get(ref); const cb = bCell.get(ref)
    // Both unclassified -> queue (never auto-resolved).
    if (aUn.has(ref) && bUn.has(ref)) { out.queued.push({ ref, reason: 'both-unclassified', a: 'UNKNOWN', b: 'UNKNOWN' }); continue }
    if (ca && cb) {
      if (ca.disposition === cb.disposition) {
        // DISPOSITION agreement (the substance-vs-not decision the accounting gate rides on).
        const kind = reconcileKind(ca.kind, cb.kind) as Golden2Cell['kind']
        const noiseRule = ca.disposition === 'NOISE' ? (ca.noiseRule ?? cb.noiseRule ?? 'NOISE.DECORATION') : null
        out.cells.push({ ref, disposition: ca.disposition, kind, ofEntity: ca.ofEntity ?? cb.ofEntity ?? null, noiseRule })
      } else {
        // A genuine disposition CONFLICT -> the adjudicator (never auto-resolved).
        out.disagreements.push({ kind: 'cell', ref, a: { d: ca.disposition, k: ca.kind }, b: { d: cb.disposition, k: cb.kind } })
      }
    } else {
      // Present for exactly one family (the other omitted it or marked UNKNOWN) -> disagreement.
      out.disagreements.push({ kind: 'cell', ref, a: ca ? { d: ca.disposition, k: ca.kind } : 'ABSENT', b: cb ? { d: cb.disposition, k: cb.kind } : 'ABSENT' })
    }
  }
  // Entities: accept those BOTH families list by refId (or by kind|name when no refId).
  const key = (e: Golden2Entity) => (e.refId ? `id:${e.refId.toLowerCase()}` : `nm:${normKind(e.kind)}|${e.name.toLowerCase()}`)
  const bByKey = new Map(b.entities.map(e => [key(e), e]))
  const aByKey = new Map(a.entities.map(e => [key(e), e]))
  for (const e of a.entities) {
    const m = bByKey.get(key(e))
    if (m) out.entities.push({ ...e, citations: Array.from(new Set([...e.citations, ...m.citations])) })
    else out.disagreements.push({ kind: 'entity', ref: e.refId ?? e.name, a: e, b: 'ABSENT' })
  }
  for (const e of b.entities) if (!aByKey.get(key(e))) out.disagreements.push({ kind: 'entity', ref: e.refId ?? e.name, a: 'ABSENT', b: e })
  // Edges: accept the intersection (both families agree on the relationship).
  const eKey = (x: Golden2Edge) => `${x.type}|${x.from.toLowerCase()}|${x.to.toLowerCase()}`
  const bEdges = new Set(b.edges.map(eKey))
  for (const x of a.edges) if (bEdges.has(eKey(x))) out.edges.push(x)
  return out
}

// ─── Adjudicate disagreements (DEEP_REASONER) — grounded-or-none ───────────────
// Circuit breaker: when the adjudicator (gpt-5.4-pro) fails repeatedly under Foundry
// overload it resolves nothing and just queues — so paying for it is pure waste. After 3
// consecutive failures the circuit OPENS: disagreements queue directly with no model call.
// Every 6th window it half-opens (one probe) to detect recovery.
let adjFailStreak = 0
let adjWindowsSinceProbe = 0
async function adjudicate(w: CellWindow, rec: Reconciled, file: string): Promise<{ resolvedCells: Golden2Cell[]; resolvedEntities: Golden2Entity[]; queued: Reconciled['queued'] }> {
  const out = { resolvedCells: [] as Golden2Cell[], resolvedEntities: [] as Golden2Entity[], queued: [] as Reconciled['queued'] }
  if (rec.disagreements.length === 0) return out
  const circuitOpen = adjFailStreak >= 3
  const halfOpenProbe = circuitOpen && (++adjWindowsSinceProbe % 6 === 0)
  if (circuitOpen && !halfOpenProbe) {
    for (const d of rec.disagreements) out.queued.push({ ref: d.ref, reason: 'adjudicator-circuit-open', a: d.a, b: d.b })
    return out
  }
  const clip = (v: EnumCell['value']) => { const s = v === null ? '' : String(v); return s.length > 160 ? s.slice(0, 160) + '…' : s }
  const rawCells = w.cells.map(c => `${c.ref} = ${clip(c.value)}`).join('\n')
  const input = `You are the ADJUDICATOR for insurance-workbook annotations. Two independent annotators (A, B) disagree on some cells/entities in this window. Decide ONLY what you can ground in the RAW cells below. If neither reading grounds, return it as "none" (it goes to human review). Never invent.\n\n${GLOSSARY}\n${COMPACT_INSTRUCTIONS}\n\nRAW WINDOW CELLS (sheet "${w.sheet}"):\n${rawCells}\n\nDISAGREEMENTS (JSON): ${JSON.stringify(rec.disagreements).slice(0, 6000)}\n\nReturn the compact JSON object (dispositions/noise/entities/edges/attrLinks/unclassified) for ONLY the disagreed refs you can ground, PLUS a "none" array of refs/names you cannot ground. Everything not grounded goes in "none".`
  let raw: Record<string, unknown>
  try { raw = await openaiResponses(GPT_DEEP, input, file, 4000, 3) }   // fewer retries: queueing is a fine fallback
  catch (e) {
    if (e instanceof BudgetExceeded) throw e
    // A persistent adjudicator failure must NOT crash the run — queue every disagreement for a human.
    adjFailStreak++
    console.log(`    adjudicator unavailable (${String((e as Error).message).slice(0, 60)}) fail#${adjFailStreak} — queueing ${rec.disagreements.length}`)
    for (const d of rec.disagreements) out.queued.push({ ref: d.ref, reason: 'adjudicator-unavailable', a: d.a, b: d.b })
    return out
  }
  // A 200 with an empty body is an overload-degraded response, not a real adjudication.
  if (Object.keys(raw).length === 0) { adjFailStreak++; for (const d of rec.disagreements) out.queued.push({ ref: d.ref, reason: 'adjudicator-empty', a: d.a, b: d.b }); return out }
  adjFailStreak = 0   // a real response resets the breaker
  const windowRefs = new Set(w.cells.map(c => c.ref))
  const coerced = coerceAnnotation(raw, windowRefs)
  // The adjudicator may ONLY resolve the DISPUTED refs — never override a cell A and B already
  // agreed on, and never promote a both-unclassified cell (hostile review #12). Restrict its
  // output to the disagreement set.
  const disCellRefs = new Set(rec.disagreements.filter(d => d.kind === 'cell').map(d => d.ref))
  const disEntityRefs = new Set(rec.disagreements.filter(d => d.kind === 'entity').map(d => d.ref))
  out.resolvedCells = coerced.cells.filter(c => disCellRefs.has(c.ref))
  out.resolvedEntities = coerced.entities.filter(e => disEntityRefs.has(e.refId ?? e.name))
  const none = (Array.isArray(raw.none) ? raw.none : []).map(String)
  const resolvedRefs = new Set([...out.resolvedCells.map(c => c.ref), ...out.resolvedEntities.map(e => e.refId ?? e.name)])
  for (const d of rec.disagreements) {
    const id = d.ref
    if (none.includes(id) || !resolvedRefs.has(id)) out.queued.push({ ref: id, reason: 'adjudicator-none-or-unresolved', a: d.a, b: d.b })
  }
  return out
}

// ─── Haiku citation byte-verify swarm ──────────────────────────────────────────
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
function citationResolvesLocally(cit: string, w: CellWindow, name: string, refId: string | null): boolean {
  const i = cit.lastIndexOf('!'); const ref = i >= 0 ? cit.slice(i + 1) : cit   // window citations are bare refs
  const cell = w.cells.find(c => c.ref === ref)
  if (!cell) return false
  const val = fold(String(cell.value ?? ''))
  const targets = [fold(name), refId ? fold(refId) : ''].filter(Boolean)
  return targets.some(t => val === t || val.includes(t) || t.includes(val))
}
// A tiny Haiku confirmation for entities whose local resolve is ambiguous (the swarm).
async function haikuVerifyBatch(pairs: { entity: Golden2Entity; cellText: string }[], file: string): Promise<boolean[]> {
  if (pairs.length === 0) return []
  const tool = { name: 'verify_citations', description: 'For each item, does the cell text support the entity name/refId?', input_schema: {
    type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, supported: { type: 'boolean' } }, required: ['index', 'supported'] } } }, required: ['results'],
  } }
  const list = pairs.map((p, i) => `${i}. entity="${p.entity.name}" refId=${p.entity.refId ?? 'null'} | cell="${p.cellText.slice(0, 120)}"`).join('\n')
  const raw = await anthropicTool(HAIKU, 'You byte-verify citations. supported=true iff the cell text contains or equals the entity name or refId.', `Items:\n${list}`, tool, file, 2000)
  const results = (Array.isArray((raw as { results?: unknown[] }).results) ? (raw as { results: { index: number; supported: boolean }[] }).results : [])
  const map = new Map(results.map(r => [r.index, r.supported]))
  return pairs.map((_, i) => map.get(i) ?? false)
}

// ─── Per-file annotation ────────────────────────────────────────────────────────
interface FileSpec { name: string; path: string; coverage: AnnotationCoverage; windowBudget?: number }

async function annotateFile(spec: FileSpec, probeWindows = 0): Promise<Golden2File | null> {
  const label = spec.name
  console.log(`\n══ ${label} [${spec.coverage}] ══`)
  const wb = await readWorkbookCells(spec.path)
  const sha = createHash('sha256').update(readFileSync(spec.path)).digest('hex')
  const progDir = join(PROGRESS, label)
  if (!probeWindows) mkdirSync(progDir, { recursive: true })

  // Deterministic sheets (NOISE/SCHEMA/LOG) — labelled without models.
  const detSheets: Golden2Sheet[] = []
  const substanceSheets: EnumSheet[] = []
  for (const sh of wb.sheets) {
    const cls = classifySheet(sh.name)
    if (cls) {
      detSheets.push({
        name: sh.name, hidden: sh.hidden,
        cells: sh.cells.map(c => ({ ref: c.ref, disposition: cls.disposition, kind: null, ofEntity: null, noiseRule: cls.noiseRule })),
        entities: [], edges: [],
      })
    } else substanceSheets.push(sh)
  }

  // Build + select windows. SMALL windows (<=24x14 ~= <=336 cells) so BOTH families emit a
  // COMPLETE annotation within token limits — a 40x40 dense window (1370 cells) truncates the
  // model output to empty. Smaller windows also cost less per call and improve local reasoning.
  const allWindows: CellWindow[] = []
  for (const sh of substanceSheets) allWindows.push(...buildWindows(sh, WINDOW_OPTS))
  let selected = allWindows
  if (spec.coverage === 'sampled' && spec.windowBudget && allWindows.length > spec.windowBudget) {
    // Keep the FIRST window of every sheet (headers/structure) + a stratified stride sample.
    const firstOfSheet = new Set<number>()
    const seen = new Set<string>()
    allWindows.forEach((w, i) => { if (!seen.has(w.sheet)) { seen.add(w.sheet); firstOfSheet.add(i) } })
    const keep = new Set<number>(firstOfSheet)
    const remaining = Math.max(0, spec.windowBudget - keep.size)
    const pool = allWindows.map((_, i) => i).filter(i => !keep.has(i))
    const stride = remaining > 0 ? Math.max(1, Math.floor(pool.length / remaining)) : pool.length + 1
    for (let k = 0; k < pool.length; k += stride) keep.add(pool[k]!)
    selected = allWindows.filter((_, i) => keep.has(i))
    console.log(`  sampled: ${selected.length}/${allWindows.length} windows (first-of-sheet + stride ${stride})`)
  } else {
    console.log(`  full: ${selected.length} substance windows`)
  }
  if (probeWindows) selected = selected.slice(0, probeWindows)

  // Annotate window by window (checkpointed).
  const perSheet = new Map<string, { cells: Map<string, Golden2Cell>; entities: Golden2Entity[]; edges: Golden2Edge[]; hidden: boolean }>()
  const ensure = (name: string, hidden: boolean) => { if (!perSheet.has(name)) perSheet.set(name, { cells: new Map(), entities: [], edges: [], hidden }); return perSheet.get(name)! }
  let queuedTotal = 0, adjudicatedTotal = 0, agreedCells = 0, totalCells = 0

  for (const w of selected) {
    const ckpt = join(progDir, `${sanitize(w.sheet)}__${w.index}.json`)
    let result: { cells: Golden2Cell[]; entities: Golden2Entity[]; edges: Golden2Edge[]; queued: Reconciled['queued']; agreed: number; total: number; adjudicated: number }
    if (!probeWindows && existsSync(ckpt)) {
      result = JSON.parse(readFileSync(ckpt, 'utf8'))
    } else {
      if (spend >= SPEND_TARGET) { console.log(`  reached spend target ${SPEND_TARGET} (spent ${spend.toFixed(2)}) — stopping this file`); break }
      try {
      const digest = sheetDigest(substanceSheets.find(s => s.name === w.sheet)!)
      const prompt = renderWindow(w, digest)
      const windowRefs = new Set(w.cells.map(c => c.ref))
      const [aRaw, bRaw] = await Promise.all([
        anthropicTool(OPUS, annotationSystem('A'), prompt, ANNOTATE_TOOL, label, 12000),
        openaiJson(GPT_VISION, annotationSystem('B'), prompt + '\nReturn the compact JSON object described above (dispositions/noise/entities/edges/attrLinks/unclassified).', label, 12000),
      ])
      const a = coerceAnnotation(aRaw, windowRefs)
      const b = coerceAnnotation(bRaw, windowRefs)
      // Guard against a degraded checkpoint during a Foundry overload: if one family returned
      // a COMPLETE annotation and the other returned NOTHING for a non-trivial window, that is a
      // silent 200-with-empty failure, not a real disagreement. Throw so the window skips WITHOUT
      // a checkpoint and a later resume re-attempts it once the endpoint recovers (dual-family
      // truth is never manufactured from a single family).
      // Symmetric degradation test: on a non-trivial window, EITHER family returning nothing
      // (one-empty OR both-empty) is an overload-degraded 200, never a legitimate annotation —
      // skip WITHOUT a checkpoint so a resume re-attempts it. (An exact-zero XOR let both-empty
      // slip through and bake a 0-cell window as legitimate — hostile review #14.)
      if (windowRefs.size >= 4 && (a.cells.length === 0 || b.cells.length === 0)) {
        throw new Error(`degraded: family empty (A=${a.cells.length} B=${b.cells.length}) — skip to retry on resume`)
      }
      const rec = reconcile(a, b)
      const adj = await adjudicate(w, rec, label)
      // Assemble accepted set: agreed + adjudicator-resolved.
      const acceptedCells = new Map<string, Golden2Cell>()
      for (const c of rec.cells) acceptedCells.set(c.ref, c)
      for (const c of adj.resolvedCells) acceptedCells.set(c.ref, c)
      let entities = [...rec.entities, ...adj.resolvedEntities]
      // Citation byte-verify: local resolve first; ambiguous ones go to the Haiku swarm.
      const kept: Golden2Entity[] = []
      const ambiguous: { entity: Golden2Entity; cellText: string }[] = []
      for (const e of entities) {
        const anyLocal = e.citations.some(c => citationResolvesLocally(c, w, e.name, e.refId))
        if (anyLocal) kept.push(e)
        else {
          const c0 = e.citations[0] ?? ''; const ref = c0.slice(c0.lastIndexOf('!') + 1)
          const cell = w.cells.find(x => x.ref === ref)
          if (cell) ambiguous.push({ entity: e, cellText: String(cell.value ?? '') })
          else rec.queued.push({ ref: e.refId ?? e.name, reason: 'citation-unresolvable', a: e, b: null })
        }
      }
      if (ambiguous.length) {
        let verdicts: boolean[] = []
        try { verdicts = await haikuVerifyBatch(ambiguous, label) }
        catch (e) { if (e instanceof BudgetExceeded) throw e /* else: swarm down -> queue all ambiguous */ }
        ambiguous.forEach((p, i) => { if (verdicts[i]) kept.push(p.entity); else rec.queued.push({ ref: p.entity.refId ?? p.entity.name, reason: verdicts.length ? 'citation-byte-verify-failed' : 'verify-swarm-unavailable', a: p.entity, b: null }) })
      }
      // Sheet-qualify every surviving citation for the assembled golden ("Sheet!A6").
      entities = kept.map(e => ({ ...e, citations: e.citations.map(c => c.includes('!') ? c : `${w.sheet}!${c}`) }))
      const allQueued = [...rec.queued, ...adj.queued]
      // CORRELATED OMISSION (hostile review #5, critical): a non-empty cell that BOTH families
      // silently omitted — never in a disposition list, never unclassified, never queued — would
      // vanish without a trace. Force every such leftover ref into the queue so it surfaces for a
      // human and is never counted as "accounted for" by silence.
      const touched = new Set<string>([...acceptedCells.keys(), ...allQueued.map(q => String(q.ref))])
      for (const ref of windowRefs) if (!touched.has(ref)) allQueued.push({ ref, reason: 'omitted-by-both', a: 'ABSENT', b: 'ABSENT' })
      result = { cells: [...acceptedCells.values()], entities, edges: rec.edges, queued: allQueued, agreed: rec.cells.length, total: windowRefs.size, adjudicated: adj.resolvedCells.length + adj.resolvedEntities.length }
      if (!probeWindows) writeFileSync(ckpt, JSON.stringify(result))
      console.log(`  ${w.sheet} w${w.index + 1}/${w.total}: ${windowRefs.size} cells | agreed ${rec.cells.length} | adj ${result.adjudicated} | queued ${allQueued.length} | ents ${entities.length} | $${spend.toFixed(2)}`)
      } catch (e) {
        if (e instanceof BudgetExceeded) throw e
        // Both annotators (or a write) failed after retries — skip this window WITHOUT a checkpoint
        // so a later resume re-attempts it. The run continues (unattended-safe).
        console.log(`  ${w.sheet} w${w.index + 1}/${w.total}: SKIPPED (${String((e as Error).message).slice(0, 90)})`)
        continue
      }
    }
    const s = ensure(w.sheet, w.hidden)
    for (const c of result.cells) s.cells.set(c.ref, c)
    s.entities.push(...result.entities)
    s.edges.push(...result.edges)
    queuedTotal += result.queued.length; adjudicatedTotal += result.adjudicated
    agreedCells += result.agreed; totalCells += result.total
    // Persist the queue rows for REVIEW_QUEUE.md.
    if (!probeWindows && result.queued.length) appendQueue(label, w.sheet, result.queued)
  }

  if (probeWindows) { console.log(`  PROBE done: spent $${(spendByFile[label] ?? 0).toFixed(2)} across ${selected.length} window(s)`); return null }

  // Assemble the golden2 file.
  const sheets: Golden2Sheet[] = [...detSheets]
  for (const [name, s] of perSheet) {
    // Dedupe entities by (refId|kind|name).
    const seen = new Set<string>(); const ents: Golden2Entity[] = []
    for (const e of s.entities) { const k = e.refId ? `id:${e.refId.toLowerCase()}` : `nm:${e.kind}|${e.name.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); ents.push(e) } }
    sheets.push({ name, hidden: s.hidden, cells: [...s.cells.values()], entities: ents, edges: dedupeEdges(s.edges) })
  }
  const totals = distinctTotals(wb)
  const allEntities = sheets.flatMap(s => s.entities)
  const byKind = (k: string) => allEntities.filter(e => e.kind === k).length
  const distinctRefIdsByKind = countRefIdsByKind(wb.sheets)
  const golden: Golden2File = {
    file: basename(spec.path), sha256: sha, annotatedAt: new Date().toISOString(),
    annotators: { a: 'GROUNDED_CITED', b: 'VISION', adjudicator: 'DEEP_REASONER' },
    sheets,
    counts: { products: byKind('product'), coverages: byKind('coverage') + byKind('subCoverage'), forms: byKind('form'), distinctFormTokens: totals.forms.size, distinctRefIds: totals.refIds.size },
    coverage: spec.coverage, sampledWindows: selected.length, totalWindows: allWindows.length,
    distinctRefIdsByKind, spendUsd: Number((spendByFile[label] ?? 0).toFixed(2)),
    agreement: { windows: selected.length, cellExactRate: totalCells > 0 ? agreedCells / totalCells : 1, adjudicated: adjudicatedTotal, queued: queuedTotal },
  }
  const v = validateGolden2File(golden)
  if (!v.ok) console.log(`  ⚠ validation issues (${v.errors.length}): ${v.errors.slice(0, 5).join(' | ')}`)
  mkdirSync(GOLDENS, { recursive: true })
  writeFileSync(join(GOLDENS, `${label}.golden2.json`), JSON.stringify(golden, null, 2))
  console.log(`  ✓ ${label}: ${allEntities.length} entities, cellExact ${(golden.agreement!.cellExactRate * 100).toFixed(1)}%, queued ${queuedTotal}, $${(spendByFile[label] ?? 0).toFixed(2)} → samples/goldens2/${label}.golden2.json`)
  return golden
}

// ─── small helpers ──────────────────────────────────────────────────────────
function sanitize(s: string): string { return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) }
function dedupeEdges(edges: Golden2Edge[]): Golden2Edge[] {
  const seen = new Set<string>(); const out: Golden2Edge[] = []
  for (const e of edges) { const k = `${e.type}|${e.from.toLowerCase()}|${e.to.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); out.push(e) } }
  return out
}
function countRefIdsByKind(sheets: EnumSheet[]): Record<string, number> {
  // A coarse deterministic split of the distinct-refId floor by the id's type token.
  const buckets: Record<string, Set<string>> = {}
  const put = (kind: string, id: string) => { (buckets[kind] ??= new Set()).add(id) }
  for (const sh of sheets) for (const id of distinctRefIds(sh)) {
    const seg = id.toUpperCase()
    if (/PROD/.test(seg)) put('product', id)
    else if (/\.RU|RULE/.test(seg)) put('rule', id)
    else if (/FORM/.test(seg)) put('form', id)
    else if (/LDTABLE|RTTABLE|TABLE/.test(seg)) put('table', id)
    else if (/COV/.test(seg)) put('coverage', id)
    else put('other', id)
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(buckets)) out[k] = v.size
  return out
}
function appendQueue(file: string, sheet: string, rows: Reconciled['queued']) {
  mkdirSync(resolve(REPO, 'docs/import-census'), { recursive: true })
  const p = resolve(REPO, 'docs/import-census/.queue.jsonl')
  const lines = rows.map(r => JSON.stringify({ file, sheet, ...r })).join('\n') + '\n'
  writeFileSync(p, (existsSync(p) ? readFileSync(p, 'utf8') : '') + lines)
}

// ─── Corpus definition ────────────────────────────────────────────────────────
// The 6 reference masters are UNTRACKED in main (working-tree-only, read-only input), so a
// git worktree does not check them out — resolve across candidate bases (worktree, parent repo).
const CORPUS_BASES = [CORPUS_DIR, resolve(REPO, '../../../samples/corpus-2026-07'), resolve(REPO, '../../../../samples/corpus-2026-07')]
function findCorpus(sub: string, f: string): string {
  for (const base of CORPUS_BASES) { const p = join(base, sub, f); if (existsSync(p)) return p }
  return join(CORPUS_DIR, sub, f)   // report the worktree path in the not-found error
}
const REF = (f: string) => findCorpus('reference', f)
const HAG = (f: string) => findCorpus('hagerty', f)
const CORPUS: FileSpec[] = [
  { name: 'client-master',      path: REF('Product_Framework_Client_Master.xlsx'),                coverage: 'full' },
  { name: 'gl-base',            path: REF('Product_Framework_General_Liability.xlsx'),             coverage: 'full' },
  { name: 'gl-2026-example',    path: REF('Product_Framework_General_Liability_2026_Example.xlsx'), coverage: 'full' },
  { name: 'hagerty-co-enthusiast', path: HAG('CO_EnthusiastPlus_Config_Template_Final.xlsx'),      coverage: 'full' },
  { name: 'pcm-coverages',      path: REF('Product_Component_Model_Coverages.xlsx'),               coverage: 'sampled', windowBudget: 26 },
  { name: 'secura-property',    path: REF('Product_Framework_SECURA_Property.xlsx'),               coverage: 'sampled', windowBudget: 30 },
  { name: 'all-lines-master',   path: REF('Product_Framework_All_Lines_Master.xlsm'),              coverage: 'sampled', windowBudget: 40 },
  { name: 'hagerty-co-rv125',   path: HAG('CO_RV125_Rating_Config_Template.xlsm'),                coverage: 'sampled', windowBudget: 34 },
]

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2)
  const arg = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const probeName = arg('--probe')
  const onlyCsv = arg('--only')
  const filePath = arg('--file')
  const only = onlyCsv ? new Set(onlyCsv.split(',').map(s => s.trim())) : null
  mkdirSync(GOLDENS, { recursive: true })

  const dumpName = arg('--dump')
  try {
    if (dumpName) {
      const spec = CORPUS.find(c => c.name === dumpName)!
      const wb = await readWorkbookCells(spec.path)
      const sub = wb.sheets.filter(s => !classifySheet(s.name))
      const w = buildWindows(sub.find(s => s.cells.length > 8) ?? sub[0]!, WINDOW_OPTS)[0]!
      const digest = sheetDigest(sub.find(s => s.name === w.sheet)!)
      const prompt = renderWindow(w, digest)
      console.log('=== PROMPT ===\n' + prompt.slice(0, 1400))
      const aRaw = await anthropicTool(OPUS, annotationSystem('A'), prompt, ANNOTATE_TOOL, dumpName)
      const bRaw = await openaiJson(GPT_VISION, annotationSystem('B'), prompt + '\nReturn a JSON object with keys cells, entities, edges, unclassified.', dumpName)
      const windowRefs = new Set(w.cells.map(c => c.ref))
      const dcount = (r: Record<string, unknown>) => { const d = (r.dispositions ?? {}) as Record<string, unknown[]>; return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])) }
      console.log('=== window has', windowRefs.size, 'cells ===')
      console.log('=== A dispositions:', JSON.stringify(dcount(aRaw)), 'entities:', (aRaw.entities as unknown[])?.length, '===')
      console.log(JSON.stringify(aRaw).slice(0, 500))
      console.log('=== B dispositions:', JSON.stringify(dcount(bRaw)), 'entities:', (bRaw.entities as unknown[])?.length, '===')
      console.log(JSON.stringify(bRaw).slice(0, 500))
      const a = coerceAnnotation(aRaw, windowRefs); const b = coerceAnnotation(bRaw, windowRefs)
      const rec = reconcile(a, b)
      console.log(`=== coerced A cells ${a.cells.length} B cells ${b.cells.length} | reconciled agreed ${rec.cells.length} disagreements ${rec.disagreements.length} ===`)
      console.log('sample disagreements:', JSON.stringify(rec.disagreements.slice(0, 5)))
      writeSpendSummary(); return
    }
    if (filePath) {
      const name = arg('--name') || basename(filePath).replace(/\.[^.]+$/, '')
      await annotateFile({ name, path: filePath, coverage: (arg('--coverage') as AnnotationCoverage) || 'full', windowBudget: Number(arg('--budget')) || undefined })
    } else if (probeName) {
      const spec = CORPUS.find(c => c.name === probeName)
      if (!spec) { console.error(`no such file "${probeName}"`); process.exit(2) }
      await annotateFile(spec, Number(arg('--windows')) || 2)
    } else {
      const list = only ? CORPUS.filter(c => only.has(c.name)) : CORPUS
      for (const spec of list) {
        if (spend >= SPEND_TARGET) { console.log(`\nspend target ${SPEND_TARGET} reached (${spend.toFixed(2)}) — skipping remaining files (resume later; checkpoints kept)`); break }
        await annotateFile(spec)
      }
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) { console.error(`\n★ BUDGET HARD-STOP: ${e.message}. Ledger-note BLOCKED. Checkpoints kept — resume after review.`); writeSpendSummary(); process.exit(3) }
    throw e
  }
  writeSpendSummary()
}
function writeSpendSummary() {
  const p = resolve(REPO, 'docs/import-census/spend.json')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ total: Number(spend.toFixed(2)), byFile: Object.fromEntries(Object.entries(spendByFile).map(([k, v]) => [k, Number(v.toFixed(2))])), at: new Date().toISOString() }, null, 2))
  console.log(`\nTOTAL SPEND $${spend.toFixed(2)} → docs/import-census/spend.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
