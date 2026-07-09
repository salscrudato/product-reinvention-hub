// pdfText.test.ts — locks the C3 payoff: the server-side PDF→text step recovers a
// form's text (raw AND FlateDecode) well enough to verify form numbers, and fails safe
// (returns null) on garbage so a real number is never false-dropped.
import { describe, it, expect } from 'vitest'
import { deflateSync } from 'zlib'
import { extractPdfText } from './pdfText'

// Local mirror of shared's normalizeFormNumber (avoid a cross-package import in the
// functions vitest, which has no @pf/shared alias): compact to a comparison key.
const normalizeFormNumber = (s: string): string => s.toUpperCase().replace(/[\s-]+/g, '')

// Build a minimal one-object PDF whose single stream carries `content`, optionally
// FlateDecode-compressed. Enough structure for the extractor's stream walker.
function makePdf(content: string, compress: boolean): string {
  const bytes = compress ? deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1')
  const filter = compress ? '/Filter /FlateDecode ' : ''
  const head = `%PDF-1.7\n1 0 obj\n<< ${filter}/Length ${bytes.length} >>\nstream\n`
  const tail = `\nendstream\nendobj\n%%EOF\n`
  return Buffer.concat([Buffer.from(head, 'latin1'), bytes, Buffer.from(tail, 'latin1')]).toString('base64')
}

// A realistic-looking content stream showing a form header with its ISO number.
const CONTENT =
  'BT /F1 12 Tf (HOMEOWNERS 3 - SPECIAL FORM  HO 00 03 10 00) Tj ' +
  '(This policy provides coverage for the dwelling and personal property.) Tj ' +
  '[(Water Back-Up endorsement )-278(HO 04 95)] TJ ET'

describe('extractPdfText', () => {
  it('recovers text (and the form number) from an uncompressed stream', () => {
    const text = extractPdfText(makePdf(CONTENT, false))
    expect(text).not.toBeNull()
    expect(normalizeFormNumber(text!)).toContain(normalizeFormNumber('HO 00 03'))
    expect(normalizeFormNumber(text!)).toContain(normalizeFormNumber('HO 04 95'))
  })

  it('recovers text from a FlateDecode-compressed stream', () => {
    const text = extractPdfText(makePdf(CONTENT, true))
    expect(text).not.toBeNull()
    expect(normalizeFormNumber(text!)).toContain(normalizeFormNumber('HO 00 03'))
  })

  it('does NOT report a form number that is absent from the source', () => {
    const text = extractPdfText(makePdf(CONTENT, true))
    expect(normalizeFormNumber(text!)).not.toContain(normalizeFormNumber('HO 99 99'))
  })

  it('fails safe (null) on non-PDF garbage and on tiny input', () => {
    expect(extractPdfText(Buffer.from('not a pdf, just noise'.repeat(20), 'utf8').toString('base64'))).toBeNull()
    expect(extractPdfText('AAAA')).toBeNull()
  })
})
