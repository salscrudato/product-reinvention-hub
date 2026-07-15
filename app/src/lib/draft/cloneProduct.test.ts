/**
 * cloneProduct.test.ts — regression lock for ledger F21.
 *
 * Form identity is (number, edition) — F12. Pre-fix, cloneProductToDraft minted
 * the draft-namespaced form copy id from form.number ONLY, and envelope writes
 * are upserts: cloning a product that carries two editions of one form number
 * silently overwrote the first edition with the second IN THE CLONE (the same
 * SILENT_LOSS class F12 fixed in the importer, in an untouched mechanism).
 *
 * Two structurally different fixtures: two dated editions of one number, and
 * an edition-carrying form sharing a number with a blank-edition form (blank
 * degrades to the number-only id, per the F12 convention).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mutations: Array<{ op: string; path: string; entityType: string; data: Record<string, unknown> }> = []

vi.mock('../backend', () => ({
  adapter: {
    db: {
      list: vi.fn(async (path: string) => {
        if (path === 'forms') return FORMS
        return []   // coverages / rules / formRules / ratingPrograms
      }),
      mutate: vi.fn(async (m: { op: string; path: string; entityType: string; data: Record<string, unknown> }) => {
        mutations.push(m)
      }),
    },
  },
}))

// Assigned per-test before calling the clone.
let FORMS: Array<Record<string, unknown>> = []

import { cloneProductToDraft } from './cloneProduct'

const SOURCE = {
  id: 'PH.PROD.001', refId: 'PH.PROD.001', name: 'Homeowners', lob: { refId: 'PH.LOB.001', name: 'Personal Home' },
  description: '', marketSegment: '', allStates: true, states: [],
} as unknown as Parameters<typeof cloneProductToDraft>[0]

const ACTOR = { uid: 'u1', name: 'Test' }

function form(number: string, edition: string): Record<string, unknown> {
  return {
    id: `${number}${edition ? '__' + edition : ''}`.replace(/\s+/g, '-'),
    number, edition, name: `Form ${number}`, category: 'BASE_COVERAGE',
    productRefIds: ['PH.PROD.001'],
  }
}

beforeEach(() => { mutations.length = 0 })

describe('F21: cloned form copies keep the (number, edition) identity', () => {
  it('two editions of one form number BOTH survive the clone', async () => {
    FORMS = [form('HO 00 03', '10 00'), form('HO 00 03', '05 11')]
    await cloneProductToDraft(SOURCE, ACTOR)
    const formWrites = mutations.filter(m => m.entityType === 'form')
    expect(formWrites.length).toBe(2)
    // The write PATHS must be distinct — an upsert to the same path keeps only the last edition.
    const paths = new Set(formWrites.map(m => m.path))
    expect(paths.size).toBe(2)
    // Both editions are present in the written copies.
    const editions = formWrites.map(m => m.data['edition']).sort()
    expect(editions).toEqual(['05 11', '10 00'])
  })

  it('an edition-carrying form and a blank-edition form sharing a number stay distinct (F12 degradation)', async () => {
    FORMS = [form('LEM 03', '05 23'), form('LEM 03', '')]
    await cloneProductToDraft(SOURCE, ACTOR)
    const formWrites = mutations.filter(m => m.entityType === 'form')
    expect(formWrites.length).toBe(2)
    const paths = [...new Set(formWrites.map(m => m.path))]
    expect(paths.length).toBe(2)
    // The blank-edition copy keeps the number-only id shape; the dated one carries the edition.
    const blankPath = formWrites.find(m => m.data['edition'] === '')!.path
    const datedPath = formWrites.find(m => m.data['edition'] === '05 23')!.path
    expect(blankPath.endsWith('LEM-03')).toBe(true)
    expect(datedPath.endsWith('LEM-03__05-23')).toBe(true)
  })
})
