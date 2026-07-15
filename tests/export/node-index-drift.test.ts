// Drift lock: the emitted-vocabulary grammar subset in shared/src/export/duckcreek/
// nodeIndex.ts must stay byte-faithful to the canonical machine grammar in
// docs/export-templates/author-xml/author-xml-node-index.json (240 observed
// elements). If the corpus index is regenerated, this test forces the subset to
// be regenerated with it — the two cannot diverge silently.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NODE_INDEX_SUBSET } from '../../shared/src/export/duckcreek/nodeIndex'

interface CanonicalEntry {
  parents: string[]
  attributes: string[]
  supports_override: boolean
  supports_abstract: boolean
}

describe('node-index subset drift lock', () => {
  it('every subset entry byte-matches the canonical docs grammar', () => {
    const canonical = JSON.parse(readFileSync(
      path.resolve(process.cwd(), 'docs/export-templates/author-xml/author-xml-node-index.json'), 'utf8',
    )) as { elements: Record<string, CanonicalEntry> }

    for (const [name, entry] of Object.entries(NODE_INDEX_SUBSET)) {
      const c = canonical.elements[name]
      expect(c, `element "${name}" must exist in the canonical index`).toBeDefined()
      expect(entry.parents, `${name}.parents`).toEqual(c!.parents)
      expect(entry.attributes, `${name}.attributes`).toEqual(c!.attributes)
      expect(entry.supportsOverride, `${name}.supportsOverride`).toBe(!!c!.supports_override)
      expect(entry.supportsAbstract, `${name}.supportsAbstract`).toBe(!!c!.supports_abstract)
    }
  })
})
