// chunk.test.ts — the chunker preserves the traceability anchors (refId / form number)
// that the "grounded + cited" invariant depends on, and hashing is deterministic +
// change-sensitive so the incremental indexer diffs correctly.
import { describe, it, expect } from 'vitest'
import {
  PH_PRODUCT, PH_COVERAGES, PH_RULES, PH_FORMS, PH_DICTIONARY,
  PH_RATING_PROGRAM, PH_LD_TABLES, PH_RT_TABLES, PH_FORM_RULES,
} from '../seed/personalHome'
import type { Product, Coverage, Rule, Form, DictionaryEntry, RatingProgram, FormRule, LDTable, RTTable } from '../types'
import {
  chunkCoverage, chunkForm, chunkDictionary, chunkBaseFormText, contentHash,
  chunkRule, chunkFormRule, chunkLdTable, chunkRtTable,
  buildBundleChunks, dedupeChunks,
} from './chunk'

const asBundle = () => ({
  product:       PH_PRODUCT as unknown as Product,
  coverages:     PH_COVERAGES as unknown as Coverage[],
  rules:         PH_RULES as unknown as Rule[],
  formRules:     PH_FORM_RULES as unknown as FormRule[],
  forms:         PH_FORMS as unknown as Form[],
  dictionary:    PH_DICTIONARY as unknown as DictionaryEntry[],
  ratingProgram: PH_RATING_PROGRAM as unknown as RatingProgram,
  ldTables:      PH_LD_TABLES,
  rtTables:      PH_RT_TABLES,
})

describe('contentHash', () => {
  it('is deterministic and change-sensitive', () => {
    expect(contentHash('hello world')).toBe(contentHash('hello world'))
    expect(contentHash('hello world')).not.toBe(contentHash('hello worlx'))
    expect(contentHash('')).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('chunk builders carry the citation anchor', () => {
  it('coverage chunk keeps its refId, form number and terms', () => {
    const cov = PH_COVERAGES.find(c => c.refId === 'PH.COV.001.001')! as unknown as Coverage
    const ch = chunkCoverage(cov, 'PH.PROD.001')
    expect(ch.metadata.refId).toBe('PH.COV.001.001')
    expect(ch.metadata.type).toBe('coverage')
    expect(ch.metadata.formNumber).toBe('HO 04 95')
    expect(ch.text).toContain('PH.COV.001.001')
    expect(ch.text).toContain('Water Back-Up')
    expect(ch.id).toBe('coverage:PH.COV.001.001')
  })

  it('form chunk keeps its ISO number as the anchor', () => {
    const form = PH_FORMS.find(f => f.number === 'HO 00 03')! as unknown as Form
    const ch = chunkForm(form)
    expect(ch.metadata.formNumber).toBe('HO 00 03')
    expect(ch.metadata.refId).toBeNull()
    expect(ch.text).toContain('HO 00 03')
  })

  it('dictionary chunk keeps its DEF refId + aliases', () => {
    const def = PH_DICTIONARY.find(d => d.refId === 'PH.DEF.003')! as unknown as DictionaryEntry
    const ch = chunkDictionary(def)
    expect(ch.metadata.refId).toBe('PH.DEF.003')
    expect(ch.text.toLowerCase()).toContain('dwelling')
  })

  it('rule chunk carries bracketed refId so the system-prompt citation anchor is present', () => {
    const rule = PH_RULES[0] as unknown as Rule
    const ch = chunkRule(rule, 'PH.PROD.001')
    expect(ch.text).toContain(`[${rule.refId}]`)
    expect(ch.metadata.refId).toBe(rule.refId)
  })

  it('formRule chunk carries bracketed refId', () => {
    const fr = PH_FORM_RULES[0] as unknown as FormRule
    const ch = chunkFormRule(fr, 'PH.PROD.001')
    expect(ch.text).toContain(`[${fr.refId}]`)
    expect(ch.metadata.refId).toBe(fr.refId)
  })

  it('ldTable chunk carries bracketed refId', () => {
    const firstEntry = Object.entries(PH_LD_TABLES)[0]!
    const [refId, tbl] = firstEntry
    const ch = chunkLdTable(refId, tbl as unknown as LDTable)
    expect(ch.text).toContain(`[${refId}]`)
    expect(ch.metadata.refId).toBe(refId)
  })

  it('rtTable chunk carries bracketed refId', () => {
    const firstEntry = Object.entries(PH_RT_TABLES)[0]!
    const [refId, tbl] = firstEntry
    const ch = chunkRtTable(refId, tbl as unknown as RTTable)
    expect(ch.text).toContain(`[${refId}]`)
    expect(ch.metadata.refId).toBe(refId)
  })

  it('base-form prose splits into anchored section chunks', () => {
    const text = [
      'SECTION I — PROPERTY COVERAGES',
      '',
      'COVERAGE A — DWELLING',
      '',
      'We cover the dwelling on the residence premises shown in the Declarations.',
      '',
      'COVERAGE B — OTHER STRUCTURES',
      '',
      'We cover other structures on the residence premises set apart by clear space.',
    ].join('\n')
    const chunks = chunkBaseFormText('HO 00 03', text, 200)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.metadata.formNumber).toBe('HO 00 03')
      expect(c.metadata.type).toBe('baseForm')
      expect(c.id.startsWith('baseForm:HO0003:')).toBe(true)
    }
  })
})

describe('buildBundleChunks', () => {
  it('covers every coverage refId with a unique, stable id', () => {
    const chunks = dedupeChunks(buildBundleChunks(asBundle()))
    const covChunkRefIds = new Set(chunks.filter(c => c.metadata.type === 'coverage').map(c => c.metadata.refId))
    for (const c of PH_COVERAGES) expect(covChunkRefIds.has(c.refId)).toBe(true)
    // Ids are unique across the whole bundle.
    expect(new Set(chunks.map(c => c.id)).size).toBe(chunks.length)
    // Every chunk keeps a hash + non-empty body.
    for (const c of chunks) { expect(c.contentHash).toMatch(/^[0-9a-f]{8}$/); expect(c.text.length).toBeGreaterThan(0) }
  })
})
