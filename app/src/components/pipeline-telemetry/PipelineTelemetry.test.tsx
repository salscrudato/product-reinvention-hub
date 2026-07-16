// @vitest-environment jsdom
// PipelineTelemetry — semantics-first tests (aria-label truth, mode behavior,
// reduced-motion, ambient pause). No markup snapshots: the component's public
// contract is its accessible summary plus what is/isn't visible per mode.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PipelineTelemetry, type PipelineStage } from './PipelineTelemetry'

function sixStages(overrides: Partial<Record<number, PipelineStage['status']>> = {}): PipelineStage[] {
  const base: PipelineStage[] = [
    { id: 'queue', label: 'Queued', status: 'done', modelBadge: 'haiku', count: '1 doc' },
    { id: 'parse', label: 'Parsing', status: 'done', modelBadge: 'haiku', count: '412 rows' },
    { id: 'extract', label: 'Extracting', status: 'active', modelBadge: 'sonnet', count: '128 terms' },
    { id: 'link', label: 'Linking', status: 'pending', modelBadge: 'sonnet' },
    { id: 'verify', label: 'Verifying', status: 'pending', modelBadge: 'opus' },
    { id: 'persist', label: 'Persisting', status: 'pending' },
  ]
  return base.map((s, i) => (overrides[i] ? { ...s, status: overrides[i]! } : s))
}

/** Install a controllable matchMedia; jsdom's own is not configurable enough. */
function stubMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

beforeEach(() => stubMatchMedia(false))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('live mode', () => {
  it('summarises stage state in the aria-label and shows badges + counts', () => {
    render(<PipelineTelemetry mode="live" title="Import pipeline" stages={sixStages()} />)
    expect(screen.getByRole('img', { name: 'Import pipeline: 2 of 6 stages complete, extracting' })).toBeTruthy()
    expect(screen.getAllByText('sonnet').length).toBe(2) // extract + link stages
    expect(screen.getByText('412 rows')).toBeTruthy()
    expect(screen.getByText('Extracting')).toBeTruthy()
  })

  it('updates the aria-label when a status transition arrives', () => {
    const { rerender } = render(<PipelineTelemetry mode="live" title="Import pipeline" stages={sixStages()} />)
    rerender(<PipelineTelemetry mode="live" title="Import pipeline" stages={sixStages({ 2: 'done', 3: 'active' })} />)
    expect(screen.getByRole('img', { name: 'Import pipeline: 3 of 6 stages complete, linking' })).toBeTruthy()
  })

  it('surfaces errored stages in the summary', () => {
    render(<PipelineTelemetry mode="live" title="Import pipeline" stages={sixStages({ 2: 'error' })} />)
    expect(screen.getByRole('img', { name: 'Import pipeline: 2 of 6 stages complete, error in extracting' })).toBeTruthy()
  })

  it('keeps every internal element decorative (single accessible node)', () => {
    const { container } = render(<PipelineTelemetry mode="live" stages={sixStages()} />)
    const img = screen.getByRole('img')
    for (const child of Array.from(img.children)) {
      expect(child.getAttribute('aria-hidden')).toBe('true')
    }
    expect(container.querySelectorAll('[role="button"], button').length).toBe(0) // no controls in live mode
  })
})

describe('compact mode', () => {
  it('renders the strip without labels, badges or counts but keeps the full summary', () => {
    render(<PipelineTelemetry mode="compact" title="Import pipeline" stages={sixStages()} />)
    expect(screen.getByRole('img', { name: 'Import pipeline: 2 of 6 stages complete, extracting' })).toBeTruthy()
    expect(screen.queryByText('Extracting')).toBeNull()
    expect(screen.queryByText('sonnet')).toBeNull()
    expect(screen.queryByText('412 rows')).toBeNull()
  })
})

describe('ambient mode', () => {
  it('advances the loop autonomously on the 12s cycle', () => {
    vi.useFakeTimers()
    render(<PipelineTelemetry mode="ambient" title="Import pipeline" stages={sixStages()} />)
    // tick 0: first stage active, nothing complete (props statuses are ignored).
    expect(screen.getByRole('img', { name: 'Import pipeline: 0 of 6 stages complete, queued' })).toBeTruthy()
    // 12s / (6 stages + 1 rest step) ≈ 1714ms per step.
    act(() => vi.advanceTimersByTime(1800))
    expect(screen.getByRole('img', { name: 'Import pipeline: 1 of 6 stages complete, parsing' })).toBeTruthy()
  })

  it('is pausable and resumable', () => {
    vi.useFakeTimers()
    render(<PipelineTelemetry mode="ambient" title="Import pipeline" stages={sixStages()} />)
    const pause = screen.getByRole('button', { name: 'Pause animation' })
    fireEvent.click(pause)
    expect(pause.getAttribute('aria-pressed')).toBe('true')
    act(() => vi.advanceTimersByTime(6000))
    expect(screen.getByRole('img', { name: 'Import pipeline: 0 of 6 stages complete, queued' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Play animation' }))
    act(() => vi.advanceTimersByTime(1800))
    expect(screen.getByRole('img', { name: 'Import pipeline: 1 of 6 stages complete, parsing' })).toBeTruthy()
  })

  it('renders a static completed state under prefers-reduced-motion', () => {
    stubMatchMedia(true)
    vi.useFakeTimers()
    render(<PipelineTelemetry mode="ambient" title="Import pipeline" stages={sixStages()} />)
    expect(screen.getByRole('img', { name: 'Import pipeline: 6 of 6 stages complete' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull() // nothing to pause
    act(() => vi.advanceTimersByTime(20_000))
    expect(screen.getByRole('img', { name: 'Import pipeline: 6 of 6 stages complete' })).toBeTruthy()
  })
})
