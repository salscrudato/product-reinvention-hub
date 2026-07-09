// Forms facet schema. Category and mandatory/optional are fixed enums; edition date is a
// range facet. Forms are keyed by `number` (there is no separate refId), so the form
// number is the load-bearing chip.

import type { Form } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import type { FacetSchema } from '../search/facetTypes'
import { reviewFacet, stateFacet, statusFacet } from '../search/universalDimensions'

// ─── Edition-date parsing ─────────────────────────────────────────────────────────
// Editions read as ISO shorthand "MM YY" ("05 11" = May 2011). The panel's month input
// emits "YYYY-MM"; both are accepted. A 2-digit year < 70 is 20xx, otherwise 19xx (old
// bureau forms). All dates normalize to the first of the month (UTC) so an entity's
// edition and a range bound compare on the same footing.
export function parseEdition(raw: string): number | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})$/.exec(s)                 // YYYY-MM (month input)
  if (m) { const y = +m[1]!, mo = +m[2]!; return mo >= 1 && mo <= 12 ? Date.UTC(y, mo - 1, 1) : null }
  m = /^(\d{1,2})[\s/-](\d{2,4})$/.exec(s)              // "MM YY" / "MM/YY" / "MM-YYYY"
  if (m) {
    const mo = +m[1]!; let y = +m[2]!
    if (y < 100) y = y < 70 ? 2000 + y : 1900 + y
    return mo >= 1 && mo <= 12 ? Date.UTC(y, mo - 1, 1) : null
  }
  return null
}

export function formatEdition(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCFullYear()).slice(2)}`
}

export const formsSchema: FacetSchema<WithId<Form>> = {
  entityType: 'form',
  facets: [
    {
      kind: 'enum', id: 'category', label: 'Category', param: 'cat', token: 'category',
      options: [
        { value: 'BASE_COVERAGE', label: 'Base coverage', token: 'Base coverage', aliases: ['base', 'coverage form'] },
        { value: 'DECLARATIONS',  label: 'Declarations',  token: 'Declarations',  aliases: ['dec', 'decs'] },
        { value: 'ENDORSEMENT',   label: 'Endorsement',   token: 'Endorsement',   aliases: ['endt', 'endorse'] },
        { value: 'EXCLUSION',     label: 'Exclusion',     token: 'Exclusion',     aliases: ['excl'] },
        { value: 'AMENDATORY',    label: 'Amendatory',    token: 'Amendatory',    aliases: ['amend', 'state amendatory'] },
        { value: 'POLICY_NOTICE', label: 'Policy notice', token: 'Policy notice', aliases: ['notice', 'pn'] },
      ],
      accessor: (f) => f.category,
    },
    {
      kind: 'enum', id: 'requirement', label: 'Requirement', param: 'req', token: 'requirement',
      options: [
        { value: 'mandatory', label: 'Mandatory', token: 'Mandatory', aliases: ['required', 'always'] },
        { value: 'optional',  label: 'Optional',  token: 'Optional',  aliases: ['conditional', 'rule-driven'] },
      ],
      // mandatoryDefault is the "attached by default" flag; RULE-driven forms read optional.
      accessor: (f) => (f.mandatoryDefault ? 'mandatory' : 'optional'),
    },
    {
      kind: 'dateRange', id: 'edition', label: 'Edition date', param: 'ed', token: 'edition',
      accessor: (f) => (f.edition ? parseEdition(f.edition) : null),
      parse: parseEdition,
      format: formatEdition,
    },
    statusFacet<WithId<Form>>(),
    reviewFacet<WithId<Form>>(),
    stateFacet<WithId<Form>>(),
  ],
  getText: (f) => [f.number, f.name, f.edition, f.category, f.description].join(' '),
  identify: (f) => ({ id: f.id, refId: f.number, title: f.name, subtitle: f.edition ? `Ed. ${f.edition}` : undefined }),
}
