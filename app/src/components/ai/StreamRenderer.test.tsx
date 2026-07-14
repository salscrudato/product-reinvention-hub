// @vitest-environment jsdom
// Locks the R0 stream-format upgrades: the waveform wait state (replacing the
// old block-cursor spinner), the lead-sentence typographic hierarchy, and the
// collapsible sections settling closed once the stream completes (unless the
// reader has toggled them).
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(cleanup)
import { StreamRenderer } from './StreamRenderer'
import { WaveformLoader } from './WaveformLoader'

describe('WaveformLoader', () => {
  it('renders an accessible status with oscillating bars while active', () => {
    const { container } = render(<WaveformLoader label="Generating answer…" />)
    expect(screen.getByRole('status', { name: 'Generating answer…' })).toBeTruthy()
    expect(container.querySelectorAll('.wf-bar').length).toBeGreaterThanOrEqual(5)
    expect(container.querySelector('.wf-rest')).toBeNull()
  })

  it('settles to rest when inactive and is decorative without a label', () => {
    const { container } = render(<WaveformLoader active={false} label="" />)
    expect(container.querySelector('.wf-rest')).toBeTruthy()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })
})

describe('StreamRenderer', () => {
  it('shows the waveform (not a cursor) while streaming with no content yet', () => {
    const { container } = render(<StreamRenderer text="" streaming />)
    expect(screen.getByRole('status', { name: 'Generating answer…' })).toBeTruthy()
    expect(container.textContent).not.toContain('▍')
  })

  it('gives the opening paragraph the lead-sentence treatment, later ones the body style', () => {
    render(<StreamRenderer text={'The HO-3 covers this loss. [PH.COV.001]\n\nMore detail follows here.'} streaming={false} />)
    const lead = screen.getByText(/The HO-3 covers this loss/).closest('p')!
    const body = screen.getByText(/More detail follows here/).closest('p')!
    expect(lead.className).toContain('font-medium')
    expect(lead.className).toContain('text-[15px]')
    expect(body.className).not.toContain('font-medium')
  })

  it('settles collapsible sections closed when the stream ends, unless the reader toggled them', () => {
    const text = 'Verdict first.\n\n## Things to consider\n\n- item one\n- item two'
    const { rerender } = render(<StreamRenderer text={text} streaming />)
    const toggle = () => screen.getByRole('button', { name: /Things to consider/i })
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    // Stream completes → section settles closed.
    rerender(<StreamRenderer text={text} streaming={false} />)
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    // Reader opens it, a new stream runs and completes → their choice sticks.
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    rerender(<StreamRenderer text={text} streaming />)
    rerender(<StreamRenderer text={text} streaming={false} />)
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
  })
})
