// shared/src/import/structure/definitionsParser.ts — Definitions/Glossary sheet parser.
// Every shipped ISO workbook includes a Definitions sheet that maps column names to
// descriptions and examples. Parsing it produces a grounding asset for the model
// pipeline. Fully deterministic, LLM-free.

import type { NormalizedCell, DefinitionsEntry } from './types'

/** Returns true when the sheet name indicates a Definitions or Glossary sheet. */
export function isDefinitionsSheetName(name: string): boolean {
  return /definition|glossary/i.test(name)
}

// Column header labels that identify the "term / column name" column.
const TERM_LABELS = new Set([
  'COLUMN NAME', 'COLUMN HEADER', 'FIELD NAME', 'DATA ELEMENT', 'TERM', 'FIELD',
  'COLUMN', 'NAME', 'ITEM', 'ATTRIBUTE',
])

// Column header labels that identify the "definition / description" column.
const DESC_LABELS = new Set([
  'DEFINITION', 'DESCRIPTION', 'MEANING', 'NOTES', 'NOTE', 'EXPLANATION',
  'COLUMN DESCRIPTION',
])

// Column header labels that identify the optional "example" column.
const EXAMPLE_LABELS = new Set([
  'EXAMPLE', 'EXAMPLES', 'SAMPLE', 'SAMPLE VALUES', 'POSSIBLE VALUES', 'VALUES',
])

/** Parse a Definitions/Glossary sheet into an array of DefinitionsEntry.
 *  Returns an empty array when the sheet structure is unrecognizable.
 *
 *  Typical structure:
 *    row R:   COLUMN NAME | DEFINITION | EXAMPLE      (header)
 *    row R+1: "STATUS"    | "Active/Inactive/Future"  | "Active"
 *    …
 */
export function parseDefinitionsSheet(cells: NormalizedCell[][]): DefinitionsEntry[] {
  if (cells.length === 0) return []

  let termCol    = -1
  let descCol    = -1
  let exampleCol = -1
  let headerRow  = -1

  // Scan the first 10 rows for a row containing both a term column and a desc column.
  for (let r = 0; r < Math.min(10, cells.length); r++) {
    const row = cells[r] ?? []
    let ft = -1, fd = -1, fe = -1

    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v !== 'string') continue
      const upper = v.trim().toUpperCase()
      if (TERM_LABELS.has(upper)    && ft < 0) ft = c
      if (DESC_LABELS.has(upper)    && fd < 0) fd = c
      if (EXAMPLE_LABELS.has(upper) && fe < 0) fe = c
    }

    // Positional fallback: some workbooks use a blank/space header for the
    // description column (e.g., GL Framework "Definitions-Product Framework"
    // where col 1 header is " "). If we found TERM + EXAMPLE but no DESC,
    // use the first column that is neither TERM nor EXAMPLE as the description.
    if (ft >= 0 && fd < 0 && fe >= 0) {
      for (let c = 0; c < row.length; c++) {
        if (c !== ft && c !== fe) { fd = c; break }
      }
    }

    if (ft >= 0 && fd >= 0) {
      headerRow  = r
      termCol    = ft
      descCol    = fd
      exampleCol = fe
      break
    }
  }

  if (headerRow < 0) return []

  const entries: DefinitionsEntry[] = []

  for (let r = headerRow + 1; r < cells.length; r++) {
    const row  = cells[r] ?? []
    const term = row[termCol]
    const desc = row[descCol]

    if (typeof term !== 'string' || !term.trim()) continue
    if (typeof desc !== 'string' || !desc.trim()) continue

    const entry: DefinitionsEntry = {
      columnName: term.trim(),
      description: desc.trim(),
    }

    if (exampleCol >= 0) {
      const ex = row[exampleCol]
      if (typeof ex === 'string' && ex.trim()) {
        entry.example = ex.trim()
      } else if (typeof ex === 'number') {
        entry.example = String(ex)
      }
    }

    entries.push(entry)
  }

  return entries
}
