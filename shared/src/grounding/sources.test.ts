// Guards the news-source URL grounding: the shape gate rejects fabricated/non-URL
// sources, and verifyItems drops URLs that don't resolve (probe injected so the drop
// behaviour is deterministic offline). Mirror of functions/src/news.ts.
import { describe, it, expect } from 'vitest'
import { sanitizeNewsUrl, verifyItems, extractOgImage } from './sources'

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
