// @vitest-environment jsdom
// EX-01 (DEFAULTS_SPEC §1): product trees render COLLAPSED by default — every
// disclosure (product node + coverage branches) starts aria-expanded="false";
// toggling one node never expands a sibling; the toolbar's expand-all/collapse-all
// signal round-trips the whole tree. Expand state stays per-session (no persistence,
// deliberate). Includes an axe pass over both states.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import { PH_PRODUCT } from '@pf/shared'
import type { Product, Coverage, Form } from '@pf/shared'
import { ProductHierarchy } from './ProductHierarchy'
import type { WithId } from '../../context/ProductContext'
import type { ProductInventory } from '../../lib/usePortfolioInventory'

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

const productA = { ...PH_PRODUCT, id: 'PH.PROD.001', name: 'Personal Home' } as unknown as WithId<Product>
const productB = { ...PH_PRODUCT, id: 'PH.PROD.002', name: 'Second Home' } as unknown as WithId<Product>

const cov = (over: Partial<Coverage> & { refId: string; id: string }) =>
  ({ parentId: null, name: over.refId, order: 0, formNumbers: [], ...over }) as unknown as WithId<Coverage>

const inventory = (): ProductInventory => ({
  coverages: [
    cov({ id: 'c1', refId: 'PH.COV.001', name: 'Dwelling', order: 1 }),
    cov({ id: 'c2', refId: 'PH.COV.001.001', name: 'Ordinance or Law', parentId: 'PH.COV.001', order: 1 }),
    cov({ id: 'c3', refId: 'PH.COV.002', name: 'Personal Property', order: 2 }),
  ],
  forms: [] as WithId<Form>[],
}) as unknown as ProductInventory

const byProduct = new Map([['PH.PROD.001', inventory()], ['PH.PROD.002', inventory()]])

const expandedStates = () =>
  screen.getAllByRole('button').filter(b => b.hasAttribute('aria-expanded')).map(b => b.getAttribute('aria-expanded'))

function mount(bulk?: { mode: 'expand' | 'collapse'; epoch: number }) {
  return render(
    <MemoryRouter>
      <ProductHierarchy products={[productA, productB]} byProduct={byProduct}
        loading={false} error={null} groupBy="none" bulk={bulk} />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('ProductHierarchy — collapsed-by-default (EX-01)', () => {
  it('initial render shows EVERY disclosure collapsed (aria-expanded="false")', () => {
    mount()
    const states = expandedStates()
    expect(states.length).toBeGreaterThanOrEqual(2)          // the two product nodes
    expect(states.every(s => s === 'false')).toBe(true)
  })

  it('toggling one product expands it WITHOUT expanding its sibling', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Personal Home' }))
    expect(screen.getByRole('button', { name: 'Collapse Personal Home' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand Second Home' })).toBeTruthy()
    // The opened product's coverage branch is itself collapsed by default.
    expect(screen.getByRole('button', { name: 'Expand Dwelling' })).toBeTruthy()
  })

  it('expand-all / collapse-all round-trips the whole tree', () => {
    const { rerender } = mount()
    rerender(
      <MemoryRouter>
        <ProductHierarchy products={[productA, productB]} byProduct={byProduct}
          loading={false} error={null} groupBy="none" bulk={{ mode: 'expand', epoch: 1 }} />
      </MemoryRouter>,
    )
    expect(expandedStates().every(s => s === 'true')).toBe(true)
    rerender(
      <MemoryRouter>
        <ProductHierarchy products={[productA, productB]} byProduct={byProduct}
          loading={false} error={null} groupBy="none" bulk={{ mode: 'collapse', epoch: 2 }} />
      </MemoryRouter>,
    )
    expect(expandedStates().every(s => s === 'false')).toBe(true)
  })

  it('axe: no violations collapsed or fully expanded', async () => {
    const collapsed = mount()
    expect((await axe(collapsed.container, AXE_OPTS)).violations).toEqual([])
    cleanup()
    const expanded = mount({ mode: 'expand', epoch: 1 })
    expect((await axe(expanded.container, AXE_OPTS)).violations).toEqual([])
  })
})
