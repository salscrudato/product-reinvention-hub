// shapeFeedback.test.ts — unit tests for the likelyFiles allowlist grounding.
//
// The `likelyFiles` field on an ISSUE story is the one model output that maps to
// real repo paths. The server-side sanitizer enforces that ONLY paths in the
// SURFACE_FILES allowlist survive; anything else the model invents is silently
// dropped. These tests prove that invariant without a live model call.
import { describe, it, expect } from 'vitest'
import { sanitizeStory, candidateFiles } from './shapeFeedback'

// ─── candidateFiles ──────────────────────────────────────────────────────────

describe('candidateFiles — maps route/label to the SURFACE_FILES allowlist', () => {
  it('matches the coverages surface by route segment', () => {
    const files = candidateFiles('/app/products/abc/coverages', 'Coverages')
    expect(files).toContain('app/src/routes/product/ProductCoverages.tsx')
  })

  it('matches rules by routeLabel', () => {
    const files = candidateFiles('/app/products/abc/rules', 'Product Rules')
    expect(files).toContain('app/src/routes/product/ProductRules.tsx')
  })

  it('matches the task board by label (handles alias)', () => {
    const files = candidateFiles('/app/tasks', 'task board')
    expect(files).toContain('app/src/routes/Tasks.tsx')
  })

  it('returns [] for an unrecognised surface (so likelyFiles is empty)', () => {
    expect(candidateFiles('/app/some/unknown/path', 'Unknown')).toEqual([])
  })

  it('returns [] when both route and routeLabel are absent', () => {
    expect(candidateFiles()).toEqual([])
    expect(candidateFiles(undefined, undefined)).toEqual([])
  })
})

// ─── sanitizeStory — likelyFiles allowlist enforcement ───────────────────────

const BASE_RAW: Record<string, unknown> = {
  type: 'ISSUE',
  title: 'Test issue',
  userStory: 'As a product manager, I want X, so that Y.',
  summary: 'Test.',
  affectedSurface: 'Coverages',
  acceptanceCriteria: ['Criterion A', 'Criterion B'],
  impact: 2,
  effort: 1,
  implementationPrompt: 'Fix this.',
  reproSteps: ['Step 1', 'Step 2'],
}

const BASE_INPUT = {
  rawTitle: 'Test issue',
  route: '/app/products/abc/coverages',
  routeLabel: 'Coverages',
}

describe('sanitizeStory — likelyFiles strict intersection with the allowlist', () => {
  it('keeps only files that are in the candidate set', () => {
    const candidates = candidateFiles(BASE_INPUT.route, BASE_INPUT.routeLabel)
    const raw = {
      ...BASE_RAW,
      likelyFiles: [
        'app/src/routes/product/ProductCoverages.tsx',   // in allowlist
        'app/src/INVENTED_PATH.tsx',                     // not in allowlist → dropped
        'app/src/routes/product/ProductRules.tsx',       // not a candidate for this surface
      ],
    }
    const story = sanitizeStory(raw, BASE_INPUT, candidates)
    expect(story.likelyFiles).toEqual(['app/src/routes/product/ProductCoverages.tsx'])
  })

  it('returns [] when the model returns paths not in the candidate set', () => {
    const candidates = candidateFiles(BASE_INPUT.route, BASE_INPUT.routeLabel)
    const raw = { ...BASE_RAW, likelyFiles: ['app/src/routes/Admin.tsx', 'app/src/SomethingMadeUp.tsx'] }
    const story = sanitizeStory(raw, BASE_INPUT, candidates)
    expect(story.likelyFiles).toEqual([])
  })

  it('returns [] when candidates is empty (unknown surface)', () => {
    const raw = { ...BASE_RAW, likelyFiles: ['app/src/routes/product/ProductCoverages.tsx'] }
    const story = sanitizeStory(raw, { rawTitle: 'Test', route: '/unknown', routeLabel: 'Unknown' }, [])
    expect(story.likelyFiles).toEqual([])
  })

  it('de-duplicates paths from the model before intersecting', () => {
    const candidates = candidateFiles(BASE_INPUT.route, BASE_INPUT.routeLabel)
    const raw = {
      ...BASE_RAW,
      likelyFiles: [
        'app/src/routes/product/ProductCoverages.tsx',
        'app/src/routes/product/ProductCoverages.tsx',   // duplicate
      ],
    }
    const story = sanitizeStory(raw, BASE_INPUT, candidates)
    expect(story.likelyFiles).toHaveLength(1)
  })

  it('likelyFiles is only set on ISSUE type, not IDEA or PRAISE', () => {
    const candidates = candidateFiles(BASE_INPUT.route, BASE_INPUT.routeLabel)
    const ideaRaw = { ...BASE_RAW, type: 'IDEA', likelyFiles: ['app/src/routes/product/ProductCoverages.tsx'] }
    const story = sanitizeStory(ideaRaw, BASE_INPUT, candidates)
    expect(story.likelyFiles).toBeUndefined()
  })
})

// ─── sanitizeStory — refId echo (never model-generated) ──────────────────────

describe('sanitizeStory — refId is echoed from caller, never from the model', () => {
  it('echoes the caller refId when provided', () => {
    const candidates = candidateFiles(BASE_INPUT.route, BASE_INPUT.routeLabel)
    const story = sanitizeStory(BASE_RAW, { ...BASE_INPUT, refId: 'PH.COV.001' }, candidates)
    expect(story.refId).toBe('PH.COV.001')
  })

  it('omits refId when the caller did not supply one', () => {
    const candidates = candidateFiles(BASE_INPUT.route, BASE_INPUT.routeLabel)
    const story = sanitizeStory(BASE_RAW, BASE_INPUT, candidates)
    expect(story.refId).toBeUndefined()
  })
})

// ─── sanitizeStory — title truncation ────────────────────────────────────────

describe('sanitizeStory — title clamped to 80 chars', () => {
  it('truncates a model title that exceeds 80 chars and appends ellipsis', () => {
    const candidates = candidateFiles(BASE_INPUT.route, BASE_INPUT.routeLabel)
    const longTitle = 'A'.repeat(100)
    const story = sanitizeStory({ ...BASE_RAW, title: longTitle }, BASE_INPUT, candidates)
    expect(story.title.length).toBeLessThanOrEqual(80)
    expect(story.title.endsWith('…')).toBe(true)
  })
})
