// @vitest-environment jsdom
// EX-02 client half: the Sidebar hides the Data Dictionary nav item when the server
// resolves page.dictionary to false (the registry default) and reveals it when the
// tenant override flips it true. "Survives reload" is pinned by construction: flags
// are NEVER persisted client-side — the nav derives PURELY from the flags map the
// server serves on /auth/me, so a remount with fresh server flags is exactly a
// reload. (The durable store is the Cosmos tenant override P3's export hook writes.)
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

let flags: Record<string, boolean> | null = { 'page.dictionary': false }
vi.mock('../../context/useUser', () => ({
  useUser: () => ({
    user: { uid: 'u1', name: 'Pat', email: 'pat@example.com', role: 'EDITOR', flags },
    profile: { role: 'EDITOR' },
  }),
}))
vi.mock('../../lib/prefetch', () => ({ prefetchRoute: () => {} }))

import { Sidebar } from './Sidebar'

const mount = () =>
  render(<MemoryRouter><Sidebar collapsed={false} onToggle={() => {}} /></MemoryRouter>)

afterEach(() => { cleanup(); flags = { 'page.dictionary': false } })

describe('Sidebar — Data Dictionary hidden until the export flag flips (EX-02)', () => {
  it('hides the Dictionary when the served flags resolve it false (registry default)', () => {
    mount()
    expect(screen.queryByText('Data Dictionary')).toBeNull()
    expect(screen.getByText('Tasks')).toBeTruthy()          // siblings unaffected
  })

  it('reveals the Dictionary when the tenant override serves true', () => {
    flags = { 'page.dictionary': true }
    mount()
    expect(screen.getByText('Data Dictionary')).toBeTruthy()
  })

  it('survives reload by construction: a remount with fresh server flags IS the state', () => {
    // Session 1 — flag off. Nothing client-side may remember otherwise.
    mount()
    expect(screen.queryByText('Data Dictionary')).toBeNull()
    expect(localStorage.length + sessionStorage.length).toBe(0)   // no client persistence of flags
    cleanup()
    // "Reload": the server (Cosmos tenant override via /auth/me) now serves true.
    flags = { 'page.dictionary': true }
    mount()
    expect(screen.getByText('Data Dictionary')).toBeTruthy()
    cleanup()
    // And back: revoking the override hides it again on the next load.
    flags = { 'page.dictionary': false }
    mount()
    expect(screen.queryByText('Data Dictionary')).toBeNull()
  })
})
