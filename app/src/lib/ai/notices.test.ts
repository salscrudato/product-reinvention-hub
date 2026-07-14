// notices.test.ts — regression lock for the shell ErrorBoundary crash:
// `Cannot destructure property 'level' of 'resolveNotice(...)' as it is undefined`.
// The server emits surface-specific notice kinds (citations-dropped, extract-empty,
// sanitize-note, iso-mapper, incomplete-product, mixed-upload, extract-error) that are
// NOT in the canonical map — resolveNotice must resolve EVERY frame, never undefined.
import { describe, expect, it } from 'vitest'
import { isCacheNotice, resolveNotice, type NoticeEvent } from './notices'

describe('resolveNotice is total', () => {
  it.each(['degrade', 'deny', 'breaker', 'cached'] as const)('canonical kind %s', kind => {
    const r = resolveNotice({ level: 'info', message: 'server copy', kind })
    expect(r).toBeDefined()
    expect(r.title.length).toBeGreaterThan(0)
    expect(['info', 'warn']).toContain(r.level)
  })

  it('unverified keeps the dynamic server message', () => {
    const r = resolveNotice({ level: 'warn', message: 'Unverified: IM.COV044.02', kind: 'unverified' })
    expect(r).toEqual({ level: 'warn', title: 'Unverified citation', detail: 'Unverified: IM.COV044.02' })
  })

  // The crash: filing-import kinds unknown to the canonical map returned undefined.
  it.each([
    'citations-dropped', 'extract-empty', 'extract-error', 'sanitize-note',
    'iso-mapper', 'incomplete-product', 'mixed-upload', 'some-future-kind',
  ])('unknown kind %s falls through to the neutral heading', kind => {
    const ev: NoticeEvent = { level: 'warn', message: 'rate-order: note', kind }
    const { level, title, detail } = resolveNotice(ev)
    expect(level).toBe('warn')
    expect(title).toBe('Heads up')
    expect(detail).toBe('rate-order: note')
  })

  it('info-level unknown kind renders as Note', () => {
    const { level, title } = resolveNotice({ level: 'info', message: 'm', kind: 'extract-empty' })
    expect(level).toBe('info')
    expect(title).toBe('Note')
  })

  it('survives malformed frames (missing level/message, null, undefined)', () => {
    expect(resolveNotice({} as NoticeEvent)).toEqual({ level: 'info', title: 'Note', detail: '' })
    expect(resolveNotice(null)).toEqual({ level: 'info', title: 'Note', detail: '' })
    expect(resolveNotice(undefined)).toEqual({ level: 'info', title: 'Note', detail: '' })
    const noMsg = resolveNotice({ level: 'warn', kind: 'unverified' } as unknown as NoticeEvent)
    expect(noMsg.detail).toBe('')
  })

  it('isCacheNotice still keys off cached', () => {
    expect(isCacheNotice({ level: 'info', message: '', kind: 'cached' })).toBe(true)
    expect(isCacheNotice({ level: 'info', message: '', kind: 'extract-empty' })).toBe(false)
    expect(isCacheNotice(undefined)).toBe(false)
  })
})
