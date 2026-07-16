// @vitest-environment jsdom
// CoverageStack — the legible replacement for the Landing A–F coverage bubbles.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CoverageStack, type CoverageStackItem } from './CoverageStack'

const HO3: CoverageStackItem[] = [
  { id: 'a', code: 'A', label: 'Dwelling' },
  { id: 'b', code: 'B', label: 'Other structures' },
  { id: 'c', code: 'C', label: 'Personal property' },
  { id: 'd', code: 'D', label: 'Loss of use' },
  { id: 'e', code: 'E', label: 'Personal liability' },
  { id: 'f', code: 'F', label: 'Medical payments' },
]

afterEach(() => cleanup())

describe('CoverageStack', () => {
  it('renders a visible code chip and label for every coverage', () => {
    render(<CoverageStack items={HO3} title="HO-3 coverages" />)
    for (const item of HO3) {
      expect(screen.getByText(item.code)).toBeTruthy()
      expect(screen.getByText(item.label)).toBeTruthy()
    }
  })

  it('is one img with a summary label; rows are decorative', () => {
    render(<CoverageStack items={HO3} title="HO-3 coverages" />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(
      'HO-3 coverages: A Dwelling, B Other structures, C Personal property, D Loss of use, E Personal liability, F Medical payments',
    )
    for (const child of Array.from(img.children)) {
      expect(child.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('respects explicit weights and clamps them to 0..1', () => {
    const { container } = render(
      <CoverageStack items={[
        { id: 'a', code: 'A', label: 'Dwelling', weight: 2 },
        { id: 'b', code: 'B', label: 'Other structures', weight: 0.25 },
      ]} />,
    )
    const widths = Array.from(container.querySelectorAll('rect')).map((r) => r.getAttribute('width'))
    expect(widths).toEqual(['100%', '25%'])
  })
})
