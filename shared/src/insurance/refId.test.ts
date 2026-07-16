// refId.test.ts — lock for BACKLOG_SEED item 1 (R1): refIdToDocId is THE canonical
// refId -> docId mint, byte-equal to the historic mapper dashId over EVERY refId in
// the seed corpus. If anyone re-introduces a second mint (a lowercasing toDocId, a
// "sanitizing" variant), or the seed grows an id the mint would mangle, this suite
// goes red before the 422 INVALID_PARENT silent-child-drop can come back.
import { describe, it, expect } from 'vitest'
import { refIdToDocId, dashId } from './refId'
import {
  PH_PRODUCT, PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES,
  PH_COVERAGES, PH_RULES, PH_FORM_RULES, PH_DICTIONARY,
} from '../seed/personalHome'
import {
  PA_PRODUCT, PA_RATING_PROGRAM, PA_RT_TABLES, PA_LD_TABLES,
  PA_COVERAGES, PA_RULES, PA_FORM_RULES, PA_DICTIONARY,
} from '../seed/personalAuto'
import {
  GL_PRODUCT, GL_RATING_PROGRAM, GL_RT_TABLES, GL_LD_TABLES,
  GL_COVERAGES, GL_RULES, GL_FORM_RULES, GL_DICTIONARY,
} from '../seed/generalLiability'

// ── Walk the seed corpus ──────────────────────────────────────────────────────
// OWNED ids: ids the seed declares (entity refIds + RT/LD record KEYS — the table
// refIds live as Record keys, not fields; a .refId-only reflection walk misses 42).
// REFERENCED ids: refId-valued cross-references (parentId, ldTableRef,
// coverageRefIds, rating-step source.ref when the source type is RT/LD/SPP —
// INPUT refs are input keys like 'covA', CONST has no ref; neither is a refId).

interface SeedLine {
  product: { refId: string | null; lob: { refId: string } }
  program: { refId: string | null; steps: Array<{ source: { type: string; ref?: string } }> }
  rt: Record<string, unknown>
  ld: Record<string, unknown>
  coverages: Array<{ refId: string | null; parentId: string | null; terms?: Array<{ ldTableRef?: string }> }>
  rules: Array<{ refId: string | null; ldTableRef?: string; coverageRefIds?: string[] }>
  formRules: Array<{ refId: string | null }>
  dictionary: Array<{ refId: string | null }>
}

const LINES: Record<string, SeedLine> = {
  PH: { product: PH_PRODUCT, program: PH_RATING_PROGRAM, rt: PH_RT_TABLES, ld: PH_LD_TABLES, coverages: PH_COVERAGES, rules: PH_RULES, formRules: PH_FORM_RULES, dictionary: PH_DICTIONARY },
  PA: { product: PA_PRODUCT, program: PA_RATING_PROGRAM, rt: PA_RT_TABLES, ld: PA_LD_TABLES, coverages: PA_COVERAGES, rules: PA_RULES, formRules: PA_FORM_RULES, dictionary: PA_DICTIONARY },
  GL: { product: GL_PRODUCT, program: GL_RATING_PROGRAM, rt: GL_RT_TABLES, ld: GL_LD_TABLES, coverages: GL_COVERAGES, rules: GL_RULES, formRules: GL_FORM_RULES, dictionary: GL_DICTIONARY },
}

const REF_SOURCE_TYPES = new Set(['RT', 'LD', 'SPP'])

function walkLine(line: SeedLine): { owned: string[]; referenced: string[] } {
  const owned: string[] = []
  const referenced: string[] = []
  const own = (id: string | null | undefined) => { if (typeof id === 'string' && id) owned.push(id) }
  const ref = (id: string | null | undefined) => { if (typeof id === 'string' && id) referenced.push(id) }

  own(line.product.refId)
  own(line.product.lob.refId)
  own(line.program.refId)
  for (const s of line.program.steps) if (REF_SOURCE_TYPES.has(s.source.type)) ref(s.source.ref)
  for (const k of Object.keys(line.rt)) own(k)
  for (const k of Object.keys(line.ld)) own(k)
  for (const c of line.coverages) {
    own(c.refId)
    ref(c.parentId)
    for (const t of c.terms ?? []) ref(t.ldTableRef)
  }
  for (const r of line.rules) {
    own(r.refId)
    ref(r.ldTableRef)
    for (const cr of r.coverageRefIds ?? []) ref(cr)
  }
  for (const fr of line.formRules) own(fr.refId)
  for (const d of line.dictionary) own(d.refId)
  return { owned, referenced }
}

const walked = Object.values(LINES).map(walkLine)
const allOwned = walked.flatMap(w => w.owned)
const allReferenced = walked.flatMap(w => w.referenced)

describe('refIdToDocId — canonical mint over the whole seed corpus (BACKLOG_SEED item 1a)', () => {
  it('walks the full corpus (142 owned refIds at freeze; floor guards walker rot)', () => {
    // 142 = PH 55 + PA 55 + GL 32 at 0ad8689. A FLOOR, not an exact pin: seed
    // growth is legitimate; a walker that silently stops visiting a collection
    // is not.
    expect(allOwned.length).toBeGreaterThanOrEqual(142)
    expect(new Set(allOwned).size).toBe(allOwned.length) // owned ids are unique
  })

  it('dashId(x) === refIdToDocId(x) byte-equal for every seed refId (alias contract)', () => {
    for (const id of [...allOwned, ...allReferenced]) {
      expect(dashId(id)).toBe(refIdToDocId(id))
    }
  })

  it('mint semantics are EXACTLY dots->dashes, case preserved, nothing else', () => {
    for (const id of [...allOwned, ...allReferenced]) {
      const minted = refIdToDocId(id)
      expect(minted).toBe(id.replace(/\./g, '-'))       // the one allowed transform
      expect(minted.toUpperCase()).toBe(minted)          // seed ids are uppercase; case survives
      expect(minted).not.toMatch(/\./)                   // no dots remain
    }
  })

  it('the mint is injective over owned ids (no two entities collapse to one doc)', () => {
    const minted = allOwned.map(refIdToDocId)
    expect(new Set(minted).size).toBe(minted.length)
  })

  it('every cross-reference resolves through the validator convention (dot->dash candidate hits the owned docId)', () => {
    // This is the exact resolution data.js performs: parentId/ldTableRef arrive
    // dotted; the persisted doc lives under refIdToDocId(ownedRefId). The dot->dash
    // candidate of every reference must land on an owned mint.
    const ownedDocs = new Set(allOwned.map(refIdToDocId))
    for (const r of allReferenced) {
      expect(ownedDocs.has(refIdToDocId(r)), `dangling seed reference: ${r}`).toBe(true)
    }
  })
})
