// @vitest-environment jsdom
// TenantProfileTab (BR-03): the carrier-profile editor writes ONE audited envelope
// mutate to tenantProfile/main with normalized arrays and the optimistic-lock rev;
// VIEWER sees the identical form read-only (server's product:write guard is the real
// gate). Includes an axe pass over both role states.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'

const mutate = vi.fn().mockResolvedValue(undefined)
let deliveredDoc: unknown = null
vi.mock('../../lib/backend', () => {
  class MutationConflictError extends Error {}
  return {
    MutationConflictError,
    adapter: {
      db: {
        mutate: (...a: unknown[]) => mutate(...a),
        subscribe: (_path: string, cb: (d: unknown) => void) => { cb(deliveredDoc); return () => {} },
      },
    },
  }
})

let role = 'EDITOR'
vi.mock('../../context/useUser', () => ({
  useUser: () => ({
    user: { uid: 'u1', name: 'Pat', email: 'pat@example.com', role },
    profile: { role },
  }),
}))

import { TenantProfileTab } from './TenantProfileTab'

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

afterEach(() => { cleanup(); mutate.mockClear(); deliveredDoc = null; role = 'EDITOR' })

describe('TenantProfileTab', () => {
  it('EDITOR creates the profile through one audited envelope mutate (normalized arrays)', async () => {
    render(<TenantProfileTab />)
    fireEvent.change(screen.getByLabelText(/carrier name/i), { target: { value: '  Accenture Test Mutual ' } })
    fireEvent.change(screen.getByLabelText(/also known as/i), { target: { value: 'ATM Insurance, ' } })
    fireEvent.change(screen.getByLabelText(/operating states/i), { target: { value: 'oh, nj, bogus' } })
    fireEvent.change(screen.getByLabelText(/watch topics/i), { target: { value: 'telematics' } })
    fireEvent.click(screen.getByText('Personal Home'))
    fireEvent.click(screen.getByRole('button', { name: /create profile/i }))
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate).toHaveBeenCalledWith({
      op: 'create', path: 'tenantProfile/main', entityType: 'tenantProfile',
      actor: { uid: 'u1', name: 'Pat' }, expectedRev: undefined,
      data: {
        carrierName: 'Accenture Test Mutual',
        aliases: ['ATM Insurance'],
        lobs: ['PH'],
        market: null,
        states: ['OH', 'NJ'],   // 'bogus' fails the 2-letter gate
        watchTopics: ['telematics'],
        competitors: [],
      },
    })
  })

  it('an existing profile saves as an UPDATE guarded by the delivered rev', async () => {
    deliveredDoc = { carrierName: 'Old Name', rev: 7 }
    render(<TenantProfileTab />)
    fireEvent.change(screen.getByLabelText(/carrier name/i), { target: { value: 'New Name' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    const call = mutate.mock.calls[0]![0] as { op: string; expectedRev?: number }
    expect(call.op).toBe('update')
    expect(call.expectedRev).toBe(7)
  })

  it('VIEWER sees the form read-only: inputs disabled, no save affordance', () => {
    role = 'VIEWER'
    deliveredDoc = { carrierName: 'Accenture Test Mutual', rev: 1 }
    render(<TenantProfileTab />)
    expect((screen.getByLabelText(/carrier name/i) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /save|create/i })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('axe: no violations in editor or read-only state', async () => {
    const a = render(<TenantProfileTab />)
    expect((await axe(a.container, AXE_OPTS)).violations).toEqual([])
    cleanup()
    role = 'VIEWER'
    const b = render(<TenantProfileTab />)
    expect((await axe(b.container, AXE_OPTS)).violations).toEqual([])
  })
})
