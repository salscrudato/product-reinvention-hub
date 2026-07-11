// pdfText.ts — a lean, dependency-free, best-effort PDF→text extractor.
//
// Its purpose is NARROW: recover enough of an uploaded coverage form's text to VERIFY
// that the form numbers a model proposes actually appear in the source document
// (extract.ts → cleanForms). It is NOT a layout-faithful extractor and does not try to
// be — it inflates FlateDecode content streams (Node's zlib) and pulls the operands of
// the text-showing operators: literal strings `(…)` (Tj / TJ) and hex strings `<…>`.
//
// Crucially it FAILS SAFE. On anything it can't confidently read (an encrypted or
// glyph-subset PDF, a decode error, too little recovered text) it returns null, and the
// caller falls back to the citation + never-invent guarantees. That way a PDF we parse
// poorly never causes a REAL form number to be false-dropped; verification only tightens
// on documents whose text we actually recovered. Reused by the P11 cost work.
import { inflateSync, inflateRawSync } from 'zlib'

/** Extract best-effort text from a base64-encoded PDF, or null if it can't be read
 *  confidently. The result is whitespace-collapsed and capped for memory safety. */
export function extractPdfText(base64: string): string | null {
  try {
    const buf = Buffer.from(base64, 'base64')
    if (buf.length < 100) return null

    // latin1 keeps one char ⇄ one byte, so we can locate `stream … endstream` bodies by
    // index and slice their raw bytes back out for inflation.
    const raw = buf.toString('latin1')
    const chunks: string[] = []

    const streamStart = /stream\r?\n/g
    let m: RegExpExecArray | null
    while ((m = streamStart.exec(raw))) {
      const start = m.index + m[0].length
      const end = raw.indexOf('endstream', start)
      if (end < 0) continue
      // Trim the EOL that separates the data from the `endstream` keyword.
      const body = raw.slice(start, end).replace(/\r?\n$/, '')
      const dict = raw.slice(Math.max(0, m.index - 400), m.index)

      let content = body
      if (/\/FlateDecode/.test(dict)) {
        const bytes = Buffer.from(body, 'latin1')
        try { content = inflateSync(bytes).toString('latin1') }
        catch {
          try { content = inflateRawSync(bytes).toString('latin1') }
          catch { streamStart.lastIndex = end; continue }   // unreadable stream — skip it
        }
      }
      chunks.push(extractStringsFromContent(content))
      streamStart.lastIndex = end   // resume scanning past this stream body
    }

    const out = chunks.join(' ').replace(/\s+/g, ' ').trim()
    return looksLikeText(out) ? out.slice(0, 500_000) : null
  } catch {
    return null
  }
}

/** Pull the text operands out of a (decoded) PDF content stream: balanced, escape-aware
 *  literal strings `(…)` and hex strings `<…>`. Tokens are space-joined; downstream
 *  form-number matching normalises whitespace away, so join granularity is irrelevant. */
function extractStringsFromContent(s: string): string {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '(') {
      let depth = 1
      let j = i + 1
      let buf = ''
      while (j < s.length && depth > 0) {
        const c = s[j]!
        if (c === '\\') { const [dec, len] = readEscape(s, j); buf += dec; j += len; continue }
        if (c === '(') { depth++; buf += c; j++; continue }
        if (c === ')') { depth--; if (depth === 0) { j++; break } buf += c; j++; continue }
        buf += c; j++
      }
      out.push(buf)
      i = j
      continue
    }
    if (ch === '<' && s[i + 1] !== '<') {         // a hex string, not a `<<` dict opener
      const close = s.indexOf('>', i + 1)
      if (close > i) { out.push(hexToStr(s.slice(i + 1, close))); i = close + 1; continue }
    }
    i++
  }
  return out.join(' ')
}

/** Decode one PDF literal-string escape at s[j] (where s[j] === '\\').
 *  Returns [decoded, charsConsumed]. Whitespace escapes collapse to a space (we
 *  normalise whitespace anyway); octal \ddd is honoured; \CRLF is a line continuation. */
function readEscape(s: string, j: number): [string, number] {
  const n = s[j + 1]
  if (n === undefined) return ['', 1]
  if (n >= '0' && n <= '7') {
    let oct = n
    let len = 2
    for (let k = 2; k <= 3; k++) {
      const d = s[j + k]
      if (d && d >= '0' && d <= '7') { oct += d; len++ } else break
    }
    return [String.fromCharCode(parseInt(oct, 8) & 0xff), len]
  }
  switch (n) {
    case 'n': case 'r': case 't': case 'b': case 'f': return [' ', 2]
    case '(': return ['(', 2]
    case ')': return [')', 2]
    case '\\': return ['\\', 2]
    case '\r': return ['', s[j + 2] === '\n' ? 3 : 2]
    case '\n': return ['', 2]
    default:   return [n, 2]
  }
}

/** Decode a PDF hex string (`<48 4f>` → "HO"), ignoring internal whitespace. */
function hexToStr(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  let out = ''
  for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16))
  return out
}

/** Confidence gate: is the recovered string real, mostly-ASCII text (not glyph-index
 *  garbage from a subset font)? Requires a minimum of real letters/digits and a high
 *  printable ratio. Below the bar we return null upstream and skip verification. */
function looksLikeText(s: string): boolean {
  if (s.length < 24) return false
  let printable = 0
  let alnum = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) printable++
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) alnum++
  }
  return alnum >= 16 && printable / s.length >= 0.8
}
