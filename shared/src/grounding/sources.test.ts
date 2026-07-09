// Guards the news-source URL grounding: the shape gate rejects fabricated/non-URL
// sources, and verifyItems drops URLs that don't resolve (probe injected so the drop
// behaviour is deterministic offline). Mirror of functions/src/news.ts.
import { describe, it, expect } from 'vitest'
import { sanitizeNewsUrl, verifyItems } from './sources'

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
