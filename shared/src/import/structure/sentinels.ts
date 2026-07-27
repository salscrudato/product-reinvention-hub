// shared/src/import/structure/sentinels.ts — central sentinel normalization.
// Maps placeholder strings / date extremes to typed nulls or 'NO_EXPIRY'.
// Fully deterministic, LLM-free. Called by every source reader.

import type { NormalizedCell } from './types'

// Case-insensitive lowercase set of strings that map to null.
const NULL_STRINGS = new Set([
  '<placeholder>',
  '<intentionally left blank>',
  // THE string these workbooks actually use — 1,154 cells across the two sample
  // books (564 Core / 590 E+), appearing as *data* in key and state columns. It
  // was absent from this list purely because the list guessed at the wording, so
  // every one of those cells burned stage-4 extraction tokens, a stage-4.5 sweep
  // cap slot, and reviewer attention, in every run, forever.
  '<intentionally blank>',
  'n/a',
  'na',
  'tbd',
  '(none)',
  'none',
  '-',
  '--',
  '',
])

// General bracketed placeholder: <anything>. These workbooks use angle brackets
// as their placeholder convention exclusively — a cell whose ENTIRE content is
// bracketed is the sheet saying nothing at that position, never a value. Listing
// wordings one at a time is how the list missed the one string that mattered.
const BRACKETED_PLACEHOLDER = /^<[^<>]*>$/

/** True when a cell's own text is a placeholder sentinel — the workbook SAYING
 *  NOTHING at that cell. Distinct from an EMPTY cell: a sentinel occupies a cell,
 *  costs extraction tokens and sweep slots, and is worth counting. Exported so the
 *  reader can record how many cells the exclusion removed instead of assuming. */
export function isSentinelText(text: string): boolean {
  const t = text.trim()
  if (t === '') return false                      // empty is not a sentinel — it is empty
  const lower = t.toLowerCase()
  return NULL_STRINGS.has(lower) || BRACKETED_PLACEHOLDER.test(t)
}

/** Normalize a raw cell value coming out of ExcelJS (or any source reader).
 *  Sentinels are mapped to null or 'NO_EXPIRY'; complex ExcelJS shapes
 *  (richText, formula result, hyperlink) are flattened first. */
export function normalizeCellValue(value: unknown): NormalizedCell {
  if (value === null || value === undefined) return null

  // ExcelJS Date objects — check for 9999-12-31 and convert the rest to ISO strings
  if (value instanceof Date) {
    if (value.getFullYear() >= 9999) return 'NO_EXPIRY'
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    // Exact date sentinel (also captured as Date above, but handle string form)
    if (trimmed === '9999-12-31') return 'NO_EXPIRY'
    if (NULL_STRINGS.has(trimmed.toLowerCase()) || BRACKETED_PLACEHOLDER.test(trimmed)) return null
    return trimmed || null
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value

  // ExcelJS complex value shapes (richText, formula, hyperlink)
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (Array.isArray(o['richText'])) {
      const text = (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
      return normalizeCellValue(text)
    }
    if ('result' in o) return normalizeCellValue(o['result'])
    if ('text' in o && o['text'] !== undefined) return normalizeCellValue(String(o['text']))
    if ('hyperlink' in o) return normalizeCellValue(String(o['text'] ?? o['hyperlink'] ?? ''))
    if ('error' in o) return null
  }

  return null
}

/** True when the normalized value is a sentinel (null or 'NO_EXPIRY'). */
export function isSentinelValue(v: NormalizedCell): v is null | 'NO_EXPIRY' {
  return v === null || v === 'NO_EXPIRY'
}
