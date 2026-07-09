// Cross-entity query engine for the global command bar. Deterministic first: named
// join intents ("optional coverages with no attached form") compute over the shared join
// keys (Rule.coverageRefIds -> Coverage.refId, Rule.formNumbers / Coverage.formNumbers ->
// Form.number). Then a grouped free-text + universal-token search across all three. Only
// when a query resolves to neither does the caller offer the AI fallback.
//
// No fuzzy matching and no invention: every hit is a real entity reached through a real
// key, and every join reports the exact rule it applied.

import type { Coverage, Form, Rule, SearchEntityType } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import { US_JURISDICTIONS } from './universalDimensions'

export interface CrossData {
  rules:     WithId<Rule>[]
  coverages: WithId<Coverage>[]
  forms:     WithId<Form>[]
}

export interface CrossHit {
  entityType: SearchEntityType   // 'rule' | 'coverage' | 'form'
  id:         string
  refId:      string | null      // refId, or the form number
  title:      string
  subtitle?:  string
  note?:      string             // join annotation, e.g. "no attached form", "broken link: HO 99 99"
}

export interface CrossGroup { entityType: SearchEntityType; label: string; hits: CrossHit[] }

export interface CrossResult {
  kind:            'join' | 'search' | 'empty'
  interpretation?: string        // shown as "Interpreted as: …" for a join
  groups:          CrossGroup[]
  total:           number
  canInterpret:    boolean       // empty + a non-trivial query -> offer the AI fallback
}

// ─── Entity -> hit projection ──────────────────────────────────────────────────
const ruleHit = (r: WithId<Rule>, note?: string): CrossHit => ({ entityType: 'rule', id: r.id, refId: r.refId, title: r.refId ?? 'Rule', subtitle: r.condition, note })
const covHit  = (c: WithId<Coverage>, note?: string): CrossHit => ({ entityType: 'coverage', id: c.id, refId: c.refId, title: c.name, subtitle: c.refId ?? undefined, note })
const formHit = (f: WithId<Form>, note?: string): CrossHit => ({ entityType: 'form', id: f.id, refId: f.number, title: f.name, subtitle: f.edition ? `Ed. ${f.edition}` : undefined, note })

const group = (entityType: SearchEntityType, label: string, hits: CrossHit[]): CrossGroup[] => (hits.length ? [{ entityType, label, hits }] : [])

// ─── Join intents ─────────────────────────────────────────────────────────────
interface JoinDef {
  id:             string
  test:           RegExp
  interpretation: string
  run:            (d: CrossData) => CrossGroup[]
}

const JOINS: JoinDef[] = [
  {
    id: 'optional-coverages-no-form',
    test: /optional.*coverage.*(no|without|missing|lack).*form|coverage.*(no|without|missing).*form/,
    interpretation: 'Optional coverages with no attached form',
    run: (d) => group('coverage', 'Coverages', d.coverages.filter((c) => c.requirement === 'OPTIONAL' && (c.formNumbers?.length ?? 0) === 0).map((c) => covHit(c, 'no attached form'))),
  },
  {
    id: 'coverages-no-rule',
    test: /coverage.*(no|without|missing|not).*(rule|referenced)|unreferenced coverage/,
    interpretation: 'Coverages not referenced by any rule',
    run: (d) => {
      const ruled = new Set(d.rules.flatMap((r) => r.coverageRefIds ?? []))
      return group('coverage', 'Coverages', d.coverages.filter((c) => c.refId && !ruled.has(c.refId)).map((c) => covHit(c, 'no rule references it')))
    },
  },
  {
    id: 'unused-forms',
    test: /(unused|orphan|unreferenced).*form|form.*(not|no).*(used|referenced|attached)/,
    interpretation: 'Forms not attached by any coverage or rule',
    run: (d) => {
      const used = new Set<string>([...d.coverages.flatMap((c) => c.formNumbers ?? []), ...d.rules.flatMap((r) => r.formNumbers ?? [])])
      return group('form', 'Forms', d.forms.filter((f) => !used.has(f.number)).map((f) => formHit(f, 'not attached anywhere')))
    },
  },
  {
    id: 'broken-links',
    test: /broken link|broken ref|dangling|missing (coverage|form)|invalid ref/,
    interpretation: 'Rules that reference a coverage or form that no longer exists',
    run: (d) => {
      const covIds = new Set(d.coverages.map((c) => c.refId).filter(Boolean) as string[])
      const formNos = new Set(d.forms.map((f) => f.number))
      const hits: CrossHit[] = []
      for (const r of d.rules) {
        const missing = [
          ...(r.coverageRefIds ?? []).filter((id) => !covIds.has(id)),
          ...(r.formNumbers ?? []).filter((n) => !formNos.has(n)),
        ]
        if (missing.length) hits.push(ruleHit(r, `broken link: ${missing.join(', ')}`))
      }
      return group('rule', 'Rules', hits)
    },
  },
  {
    id: 'mandatory-coverages',
    test: /mandatory.*coverage.*form|coverage.*mandatory.*form|base coverage.*form/,
    interpretation: 'Mandatory (included) coverages and their attached forms',
    run: (d) => group('coverage', 'Coverages', d.coverages.filter((c) => c.requirement === 'MANDATORY').map((c) => covHit(c, c.formNumbers?.length ? `${c.formNumbers.length} form(s)` : 'no form'))),
  },
]

// ─── Universal-token + free-text grouped search ─────────────────────────────────
const STATE_CODES = new Set(US_JURISDICTIONS.map((o) => o.value))
const STATUS_TOKENS: Record<string, string> = { active: 'ACTIVE', inactive: 'INACTIVE', future: 'FUTURE' }

interface ParsedUniversal { statuses: Set<string>; states: Set<string>; text: string }

/** Pull status:/state: tokens (shared by all three entities) out of a query; the rest is
 *  free text. Deterministic and schema-independent, so there is no cross-schema id clash. */
function parseUniversal(query: string): ParsedUniversal {
  const statuses = new Set<string>()
  const states = new Set<string>()
  const consumed: [number, number][] = []
  for (const m of query.matchAll(/(status|state):("([^"]*)"|(\S+))/gi)) {
    const key = m[1]!.toLowerCase()
    const raw = (m[3] ?? m[4] ?? '').trim()
    if (key === 'status' && STATUS_TOKENS[raw.toLowerCase()]) { statuses.add(STATUS_TOKENS[raw.toLowerCase()]!); consumed.push([m.index!, m.index! + m[0].length]) }
    else if (key === 'state' && STATE_CODES.has(raw.toUpperCase())) { states.add(raw.toUpperCase()); consumed.push([m.index!, m.index! + m[0].length]) }
  }
  let text = ''; let cursor = 0
  for (const [s, e] of consumed) { text += query.slice(cursor, s); cursor = e }
  text += query.slice(cursor)
  return { statuses, states, text: text.trim().replace(/\s+/g, ' ').toLowerCase() }
}

const inScope = (e: { allStates: boolean; states: string[] }, states: Set<string>): boolean =>
  states.size === 0 || e.allStates || e.states.some((s) => states.has(s))

const textHit = (haystack: string, terms: string[]): boolean => terms.every((t) => haystack.includes(t))

function ruleText(r: WithId<Rule>): string { return [r.refId, r.category, r.subCategory, r.condition, r.outcome, ...(r.coverageRefIds ?? []), ...(r.formNumbers ?? [])].join(' ').toLowerCase() }
function covText(c: WithId<Coverage>): string { return [c.refId, c.name, c.claimsBasis, ...(c.formNumbers ?? [])].join(' ').toLowerCase() }
function formText(f: WithId<Form>): string { return [f.number, f.name, f.edition, f.category, f.description].join(' ').toLowerCase() }

function search(d: CrossData, p: ParsedUniversal): CrossGroup[] {
  const terms = p.text ? p.text.split(/\s+/).filter(Boolean) : []
  const active = terms.length > 0 || p.statuses.size > 0 || p.states.size > 0
  if (!active) return []

  const rules = d.rules.filter((r) => (p.statuses.size === 0 || p.statuses.has(r.status)) && inScope(r, p.states) && textHit(ruleText(r), terms))
  const coverages = d.coverages.filter((c) => (p.statuses.size === 0 || p.statuses.has(c.status)) && inScope(c, p.states) && textHit(covText(c), terms))
  const forms = d.forms.filter((f) => (p.statuses.size === 0 || p.statuses.has(f.status)) && inScope(f, p.states) && textHit(formText(f), terms))

  return [
    ...group('coverage', 'Coverages', coverages.map((c) => covHit(c))),
    ...group('form', 'Forms', forms.map((f) => formHit(f))),
    ...group('rule', 'Rules', rules.map((r) => ruleHit(r))),
  ]
}

// ─── Orchestrator ────────────────────────────────────────────────────────────────
export function runGlobalQuery(query: string, data: CrossData): CrossResult {
  const q = query.trim()
  if (!q) return { kind: 'empty', groups: [], total: 0, canInterpret: false }

  const lower = q.toLowerCase()
  for (const join of JOINS) {
    if (join.test.test(lower)) {
      const groups = join.run(data)
      return { kind: 'join', interpretation: join.interpretation, groups, total: groups.reduce((n, g) => n + g.hits.length, 0), canInterpret: false }
    }
  }

  const groups = search(data, parseUniversal(q))
  const total = groups.reduce((n, g) => n + g.hits.length, 0)
  if (total === 0) return { kind: 'empty', groups: [], total: 0, canInterpret: q.length >= 3 }
  return { kind: 'search', groups, total, canInterpret: false }
}
