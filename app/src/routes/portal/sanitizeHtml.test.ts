// @vitest-environment jsdom
// sanitizeHtml.test.ts — the portal renders server HTML only through this sanitizer,
// so these tests are the client-side XSS/injection contract for the policyholder portal.
import { describe, it, expect } from 'vitest'
import { sanitizePortalHtml } from './sanitizeHtml'

describe('sanitizePortalHtml — allowlist contract', () => {
  it('keeps the allowed structural tags and their text', () => {
    const html = '<section class="ph-card"><h2>Coverage</h2><p>Dwelling <strong>$300,000</strong></p><ul class="ph-upsell"><li>Flood <span class="ph-refid">PH.COV.FLD</span></li></ul></section>'
    expect(sanitizePortalHtml(html)).toBe(html)
  })

  it('keeps details/summary (native interactivity, no JS)', () => {
    const html = '<details><summary>Dwelling</summary><p>Covers your home.</p></details>'
    expect(sanitizePortalHtml(html)).toBe(html)
  })

  it('drops <script> INCLUDING its content', () => {
    const out = sanitizePortalHtml('<p>ok</p><script>document.title="pwned"</script>')
    expect(out).toBe('<p>ok</p>')
    expect(out).not.toContain('pwned')
  })

  it('drops <style> and <iframe> including content', () => {
    expect(sanitizePortalHtml('<style>p{display:none}</style><iframe src="https://evil"></iframe><p>ok</p>')).toBe('<p>ok</p>')
  })

  it('strips every event-handler attribute', () => {
    const out = sanitizePortalHtml('<div class="ph-card" onclick="steal()" onmouseover="x()">hi</div>')
    expect(out).toBe('<div class="ph-card">hi</div>')
  })

  it('strips style/id/data-* attributes — only class survives', () => {
    const out = sanitizePortalHtml('<p style="position:fixed" id="x" data-token="secret">hi</p>')
    expect(out).toBe('<p>hi</p>')
  })

  it('drops class values outside the safe charset', () => {
    const out = sanitizePortalHtml('<p class="a&quot;onload=x">hi</p>')
    expect(out).toBe('<p>hi</p>')
  })

  it('unwraps unknown-but-harmless elements, keeping safe children', () => {
    expect(sanitizePortalHtml('<article><p>kept</p></article>')).toBe('<p>kept</p>')
  })

  it('removes <a>/<img> so no URLs (javascript:, exfil beacons) can ride along', () => {
    const out = sanitizePortalHtml('<p><a href="javascript:alert(1)">click</a><img src="https://evil/beacon.png"></p>')
    expect(out).toBe('<p>click</p>')
    expect(out).not.toContain('javascript')
    expect(out).not.toContain('evil')
  })

  it('drops SVG/MathML vectors entirely', () => {
    expect(sanitizePortalHtml('<svg onload="x()"><script>y()</script></svg><p>ok</p>')).toBe('<p>ok</p>')
  })

  it('discards comments and template content', () => {
    expect(sanitizePortalHtml('<!-- secret --><template><script>z()</script></template><p>ok</p>')).toBe('<p>ok</p>')
  })

  it('survives malformed nesting without leaking raw markup', () => {
    const out = sanitizePortalHtml('<div class="ph-card"><p>ok<div>tail')
    expect(out).toContain('ok')
    expect(out).not.toContain('<script')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizePortalHtml('')).toBe('')
  })
})
