// Per-project accent + card runway helpers (E1). The accent is a TOKEN REFERENCE
// (var(--color-proj-N)) resolved by index.css per theme — these helpers may never
// emit a raw color value.
import { describe, it, expect } from 'vitest'
import { PROJECT_ACCENT_STOPS, projectAccentIndex, projectAccentVars, elapsedFraction } from './gtm'

describe('projectAccentIndex — stable hash → 1..N', () => {
  it('is deterministic for the same project id', () => {
    expect(projectAccentIndex('prj-abc')).toBe(projectAccentIndex('prj-abc'))
  })
  it('always lands inside 1..PROJECT_ACCENT_STOPS', () => {
    for (let i = 0; i < 200; i++) {
      const idx = projectAccentIndex(`project-${i}`)
      expect(idx).toBeGreaterThanOrEqual(1)
      expect(idx).toBeLessThanOrEqual(PROJECT_ACCENT_STOPS)
    }
  })
  it('actually distributes across stops (≥3 distinct over a sample)', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => projectAccentIndex(`p${i}`)))
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })
})

describe('projectAccentVars — scoped custom properties, token references only', () => {
  it('emits exactly the three --proj-* vars, each a var(--color-proj-*) reference', () => {
    const vars = projectAccentVars('prj-abc') as Record<string, string>
    expect(Object.keys(vars).sort()).toEqual(['--proj-accent', '--proj-line', '--proj-soft'])
    for (const v of Object.values(vars)) expect(v).toMatch(/^var\(--color-proj-\d(-soft|-line)?\)$/)
  })
  it('the three vars agree on one stop index', () => {
    const vars = projectAccentVars('prj-xyz') as Record<string, string>
    const idx = vars['--proj-accent']!.match(/proj-(\d)/)![1]
    expect(vars['--proj-soft']).toContain(`proj-${idx}-soft`)
    expect(vars['--proj-line']).toContain(`proj-${idx}-line`)
  })
})

describe('elapsedFraction — the card runway read (start → due window)', () => {
  it('is null without both dates', () => {
    expect(elapsedFraction(null, '2026-07-20', '2026-07-15')).toBeNull()
    expect(elapsedFraction('2026-07-10', null, '2026-07-15')).toBeNull()
  })
  it('is null for a degenerate window (due ≤ start)', () => {
    expect(elapsedFraction('2026-07-20', '2026-07-20', '2026-07-21')).toBeNull()
    expect(elapsedFraction('2026-07-20', '2026-07-10', '2026-07-15')).toBeNull()
  })
  it('clamps to 0 before the window opens', () => {
    expect(elapsedFraction('2026-07-20', '2026-07-30', '2026-07-01')).toBe(0)
  })
  it('reads mid-window as the elapsed fraction', () => {
    expect(elapsedFraction('2026-07-10', '2026-07-20', '2026-07-15')).toBeCloseTo(0.5, 5)
  })
  it('clamps to 1 once overdue', () => {
    expect(elapsedFraction('2026-07-01', '2026-07-10', '2026-07-15')).toBe(1)
  })
})
