// Guards the news-source URL grounding: the shape gate rejects fabricated/non-URL
// sources, and verifyItems drops URLs that don't resolve (probe injected so the drop
// behaviour is deterministic offline). Mirror of functions/src/news.ts.
import { describe, it, expect } from 'vitest'
import {
  sanitizeNewsUrl,
  verifyItems,
  extractOgImage,
  extractInlineImage,
  resolveImageUrl,
  deterministicColor,
} from './sources'

describe('sanitizeNewsUrl', () => {
  it('accepts well-formed http(s) URLs', () => {
    expect(sanitizeNewsUrl('https://www.iii.org/article/x')).toBe('https://www.iii.org/article/x')
    expect(sanitizeNewsUrl('  http://naic.org/news  ')).toBe('http://naic.org/news')
  })

  it('rejects bare schemes, non-http schemes, whitespace and non-URLs', () => {
    for (const bad of ['', 'http://', 'https://', 'not-a-url', 'ftp://x.com', 'javascript:alert(1)', 'https://no space.com', 'localhost']) {
      expect(sanitizeNewsUrl(bad)).toBeNull()
    }
  })
})

describe('verifyItems', () => {
  it('drops dead + malformed URLs and keeps the live one', async () => {
    const items = [
      { url: 'https://www.iii.org/live', title: 'live' },
      { url: 'https://hallucinated.example.test/nope', title: 'dead' },
      { url: 'not-a-real-url', title: 'malformed' },
    ]
    const kept = await verifyItems(items, async (u) => u.includes('iii.org'))
    expect(kept.map(k => k.url)).toEqual(['https://www.iii.org/live'])
  })
})

describe('extractOgImage', () => {
  it('returns og:image URL when property precedes content', () => {
    const html = '<meta property="og:image" content="https://example.com/hero.jpg"/>'
    expect(extractOgImage(html)).toBe('https://example.com/hero.jpg')
  })

  it('returns og:image URL when content precedes property', () => {
    const html = '<meta content="https://example.com/og.jpg" property="og:image"/>'
    expect(extractOgImage(html)).toBe('https://example.com/og.jpg')
  })

  it('falls back to twitter:image when og:image is absent', () => {
    const html = '<meta name="twitter:image" content="https://example.com/card.png"/>'
    expect(extractOgImage(html)).toBe('https://example.com/card.png')
  })

  it('returns null when neither og:image nor twitter:image is present', () => {
    expect(extractOgImage('<html><head><title>No OG tags</title></head></html>')).toBeNull()
    expect(extractOgImage('')).toBeNull()
  })

  it('returns the raw relative URL so the caller can reject it via sanitizeNewsUrl', () => {
    const html = '<meta property="og:image" content="/images/local.jpg"/>'
    expect(extractOgImage(html)).toBe('/images/local.jpg')
  })

  it('returns null for empty content attribute (no false empty-string result)', () => {
    const html = '<meta property="og:image" content=""/>'
    expect(extractOgImage(html)).toBeNull()
  })

  it('handles extra attributes between property and content', () => {
    const html = '<meta property="og:image" data-x="foo" content="https://cdn.example.com/img.jpg" />'
    expect(extractOgImage(html)).toBe('https://cdn.example.com/img.jpg')
  })

  it('og:image takes priority over twitter:image when both present', () => {
    const html = [
      '<meta property="og:image" content="https://example.com/og.jpg"/>',
      '<meta name="twitter:image" content="https://example.com/tw.jpg"/>',
    ].join('\n')
    expect(extractOgImage(html)).toBe('https://example.com/og.jpg')
  })
})

describe('extractInlineImage', () => {
  it('returns the first img src with plausible dimensions (width >= 200)', () => {
    const html = '<img src="/hero.jpg" width="800" height="600"/>'
    expect(extractInlineImage(html)).toBe('/hero.jpg')
  })

  it('returns img with height >= 200', () => {
    const html = '<img src="https://cdn.example.com/tall.png" width="100" height="400"/>'
    expect(extractInlineImage(html)).toBe('https://cdn.example.com/tall.png')
  })

  it('skips tracking pixels (dimension < 10)', () => {
    const html = '<img src="pixel.gif" width="1" height="1"/><img src="real.jpg" width="500"/>'
    expect(extractInlineImage(html)).toBe('real.jpg')
  })

  it('returns img with no dimension attributes', () => {
    const html = '<img src="/content.jpg" alt="Hero"/>'
    expect(extractInlineImage(html)).toBe('/content.jpg')
  })

  it('skips small images and returns the first large one', () => {
    const html = '<img src="icon.png" width="50" height="50"/><img src="hero.jpg" width="1200"/>'
    expect(extractInlineImage(html)).toBe('hero.jpg')
  })

  it('returns null when no plausible images found', () => {
    const html = '<img src="pixel.gif" width="1" height="1"/>'
    expect(extractInlineImage(html)).toBeNull()
  })

  it('returns null when no img tags present', () => {
    expect(extractInlineImage('<html><body>No images here</body></html>')).toBeNull()
  })
})

describe('resolveImageUrl', () => {
  it('resolves a relative URL against the base', () => {
    expect(resolveImageUrl('/images/hero.jpg', 'https://example.com/article'))
      .toBe('https://example.com/images/hero.jpg')
  })

  it('keeps an absolute URL unchanged', () => {
    expect(resolveImageUrl('https://cdn.example.com/img.png', 'https://example.com'))
      .toBe('https://cdn.example.com/img.png')
  })

  it('resolves a protocol-relative URL', () => {
    expect(resolveImageUrl('//cdn.example.com/hero.jpg', 'https://example.com'))
      .toBe('https://cdn.example.com/hero.jpg')
  })

  it('returns null for invalid URLs', () => {
    expect(resolveImageUrl('not a url', 'https://example.com')).toBeNull()
  })

  it('returns null when base URL is invalid', () => {
    expect(resolveImageUrl('/hero.jpg', 'not-a-url')).toBeNull()
  })
})

describe('deterministicColor', () => {
  it('produces a consistent hex color for the same seed', () => {
    const c1 = deterministicColor('Insurance Journal')
    const c2 = deterministicColor('Insurance Journal')
    expect(c1).toBe(c2)
    expect(c1).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('produces different colors for different seeds', () => {
    const c1 = deterministicColor('Source A')
    const c2 = deterministicColor('Source B')
    expect(c1).not.toBe(c2)
  })

  it('produces a valid hex color', () => {
    const color = deterministicColor('NAIC')
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })
})
