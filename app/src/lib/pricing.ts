// pricing.ts — ILLUSTRATIVE - PENDING COMMERCIAL APPROVAL
//
// The single source of truth for every dollar figure, tier, band and ROI
// assumption rendered on the public /pricing page. NOTHING here is a committed
// price or a quote — the numbers model the shape of value for a category with no
// equivalent platform, and every one is subject to commercial approval.
//
// Public-safety rule (enforced by review): no client names, no pipeline data and
// no internal engagement names appear in this file or anywhere it renders. The
// figures are generic bands, not deal terms.

export const PRICING_STATUS = 'ILLUSTRATIVE — PENDING COMMERCIAL APPROVAL' as const
export const PRICING_DISCLAIMER =
  'Illustrative figures that model value, not a quote. Pricing is set per engagement and pending commercial approval.'

// ─── Positioning ──────────────────────────────────────────────────────────────

export const POSITIONING = {
  eyebrow: 'Pricing',
  headline: 'Priced on the value it creates — not the seats it fills.',
  sub:
    'The Product Reinvention Hub is a consulting-wrapped platform for a category that ' +
    'does not otherwise exist. So it is priced in layers: a platform license, metered ' +
    'AI, a services arc that stands it up and runs it, and program-priced transformation.',
} as const

// ─── Layer 1 · Platform license (annual subscription) ─────────────────────────
// Tiered by lines of business, users and connectors.

export interface PlatformTier {
  id: string
  name: string
  blurb: string
  linesOfBusiness: string
  users: string
  connectors: string
  aiTokenBudget: string
  /** Illustrative annual license band, USD. */
  annualLicenseUsd: [number, number]
  featured?: boolean
}

export const PLATFORM_TIERS: PlatformTier[] = [
  {
    id: 'launch',
    name: 'Launch',
    blurb: 'A first line of business, governed end to end.',
    linesOfBusiness: '1–2 lines of business',
    users: 'Up to 15 authors',
    connectors: '1 system connector',
    aiTokenBudget: '25M AI tokens / mo included',
    annualLicenseUsd: [120_000, 180_000],
  },
  {
    id: 'scale',
    name: 'Scale',
    blurb: 'A growing portfolio, live across states.',
    linesOfBusiness: '3–5 lines of business',
    users: 'Up to 50 authors',
    connectors: '3 system connectors',
    aiTokenBudget: '100M AI tokens / mo included',
    annualLicenseUsd: [240_000, 360_000],
    featured: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    blurb: 'The whole book, one reinvention platform.',
    linesOfBusiness: 'Unlimited lines of business',
    users: 'Unlimited authors',
    connectors: 'Unlimited connectors',
    aiTokenBudget: '400M AI tokens / mo included',
    annualLicenseUsd: [480_000, 900_000],
  },
]

// ─── Layer 2 · AI usage (token-metered on top of the tier budget) ─────────────

export const AI_USAGE = {
  name: 'AI usage',
  kind: 'Token-metered',
  blurb:
    'Every tier includes a monthly AI token budget. Usage beyond it is metered — ' +
    'you only pay for the reasoning you actually draw, routed across the model fleet ' +
    'at the right tier for each task.',
  /** Illustrative blended overage, USD per 1M tokens beyond the included budget. */
  overageUsdPerMillion: 9,
  points: [
    'Included budget scales with your platform tier',
    'Metered only on usage above the budget',
    'Fleet routing keeps bulk work on the economical model',
    'Grounded + cited on every call — no wasted tokens on free invention',
  ],
} as const

// ─── Layer 3 · Services arc (stand it up, then run it) ────────────────────────

export interface ServiceOffer {
  id: string
  name: string
  model: string
  duration: string
  blurb: string
  /** Illustrative headline figure. */
  figure: string
}

export const SERVICES: ServiceOffer[] = [
  {
    id: 'strategy',
    name: 'Strategy',
    model: 'Fixed-price phase',
    duration: '4–6 weeks',
    blurb: 'The value case, target operating model and a sequenced reinvention roadmap.',
    figure: 'from $85k',
  },
  {
    id: 'mobilize',
    name: 'Mobilize',
    model: 'Fixed-price phase',
    duration: '8–12 weeks',
    blurb: 'Stand up the platform, migrate a first line of business, and train the team to own it.',
    figure: 'from $220k',
  },
  {
    id: 'ai-run',
    name: 'AI Run',
    model: 'Monthly managed service',
    duration: 'Ongoing',
    blurb: 'We operate the AI fleet, its governance and its grounding as a managed service.',
    figure: 'from $18k / mo',
  },
]

// ─── Layer 4 · Transformation (program-priced) ────────────────────────────────

export const TRANSFORMATION = {
  name: 'Transformation',
  model: 'Program-priced',
  blurb:
    'Portfolio-wide reinvention — multiple lines, multiple states, new operating model. ' +
    'Scoped and priced to the outcome, as a multi-quarter program.',
  points: [
    'Priced to the business outcome, not to effort',
    'Blends platform, AI and services under one program',
    'Executive governance and a value-realization plan',
  ],
} as const

/** The four commercial layers, for the overview strip. */
export const COMMERCIAL_LAYERS = [
  { n: 1, name: 'Platform license', kind: 'Annual subscription', note: 'Tiered by lines of business, users and connectors.' },
  { n: 2, name: 'AI usage', kind: 'Token-metered', note: 'Metered on top of the tier’s included budget.' },
  { n: 3, name: 'Services', kind: 'Fixed-price + managed', note: 'Strategy & Mobilize as phases; AI Run as a managed service.' },
  { n: 4, name: 'Transformation', kind: 'Program-priced', note: 'Program-priced, portfolio-wide engagements.' },
] as const

// ─── ROI model ────────────────────────────────────────────────────────────────
// Three independent value levers, each a published band. The dollar HEADLINE
// counts the OpEx-efficiency lever only (hard dollars); the speed and onboarding
// levers are reported in WEEKS, deliberately NOT converted to dollars and summed,
// so the headline can never be accused of double-counting the same OpEx pool.

export interface Band { low: number; high: number }

export const ROI_BANDS = {
  /** Speed-to-market gain (a launch completes this much faster). */
  speedToMarket: { low: 0.25, high: 0.35 } as Band,
  /** Annual product OpEx reduction. */
  opex: { low: 0.10, high: 0.15 } as Band,
  /** Onboarding compression (a new author/line ramps this much faster). */
  onboarding: { low: 0.15, high: 0.20 } as Band,
} as const

export interface RoiInputs {
  productsPerYear: number
  speedToMarketWeeks: number
  annualOpexUsd: number
  onboardingWeeks: number
}

export const ROI_DEFAULTS: RoiInputs = {
  productsPerYear: 6,
  speedToMarketWeeks: 32,
  annualOpexUsd: 4_000_000,
  onboardingWeeks: 12,
}

export interface RoiSlider {
  key: keyof RoiInputs
  label: string
  min: number
  max: number
  step: number
  unit: 'count' | 'weeks' | 'usd'
  help: string
}

export const ROI_SLIDERS: RoiSlider[] = [
  { key: 'productsPerYear', label: 'Products launched per year', min: 1, max: 24, step: 1, unit: 'count', help: 'New or materially revised products you take to market annually.' },
  { key: 'speedToMarketWeeks', label: 'Current speed to market', min: 8, max: 52, step: 1, unit: 'weeks', help: 'Weeks from concept to a filed, sellable product today.' },
  { key: 'annualOpexUsd', label: 'Annual product OpEx', min: 500_000, max: 20_000_000, step: 250_000, unit: 'usd', help: 'People and tooling spend to build, file and maintain products.' },
  { key: 'onboardingWeeks', label: 'Onboarding time', min: 2, max: 24, step: 1, unit: 'weeks', help: 'Weeks to bring a new author or line of business fully productive.' },
]

export interface RoiResult {
  /** Weeks shaved off a single launch. */
  weeksSavedPerLaunch: Band
  /** Launch-weeks reclaimed across the year (per-launch × products/yr). */
  productWeeksReclaimed: Band
  /** Hard-dollar annual OpEx savings — the headline figure. */
  opexSavingsUsd: Band
  /** Weeks shaved off each onboarding. */
  onboardingWeeksSaved: Band
  /** Headline annual value = OpEx efficiency only (no double-count). */
  annualValueUsd: Band
}

const clampInput = (n: number, s: RoiSlider) =>
  Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : s.min

/** Coerce arbitrary input into the valid slider ranges (defends the ROI math). */
export function normalizeRoiInputs(inputs: RoiInputs): RoiInputs {
  const by = (k: keyof RoiInputs) => ROI_SLIDERS.find((s) => s.key === k)!
  return {
    productsPerYear: clampInput(inputs.productsPerYear, by('productsPerYear')),
    speedToMarketWeeks: clampInput(inputs.speedToMarketWeeks, by('speedToMarketWeeks')),
    annualOpexUsd: clampInput(inputs.annualOpexUsd, by('annualOpexUsd')),
    onboardingWeeks: clampInput(inputs.onboardingWeeks, by('onboardingWeeks')),
  }
}

const scale = (v: number, b: Band): Band => ({ low: v * b.low, high: v * b.high })

/** Pure ROI computation. Every output is a band derived directly from ROI_BANDS. */
export function computeRoi(rawInputs: RoiInputs): RoiResult {
  const i = normalizeRoiInputs(rawInputs)

  const weeksSavedPerLaunch = scale(i.speedToMarketWeeks, ROI_BANDS.speedToMarket)
  const productWeeksReclaimed = {
    low: weeksSavedPerLaunch.low * i.productsPerYear,
    high: weeksSavedPerLaunch.high * i.productsPerYear,
  }
  const opexSavingsUsd = scale(i.annualOpexUsd, ROI_BANDS.opex)
  const onboardingWeeksSaved = scale(i.onboardingWeeks, ROI_BANDS.onboarding)

  return {
    weeksSavedPerLaunch,
    productWeeksReclaimed,
    opexSavingsUsd,
    onboardingWeeksSaved,
    // Headline is the hard-dollar lever only — speed/onboarding stay in weeks.
    annualValueUsd: opexSavingsUsd,
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Compact USD: 4_000_000 → "$4.0M", 180_000 → "$180k", 900 → "$900". */
export function formatUsd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

export function formatUsdBand(b: Band | [number, number]): string {
  const lo = Array.isArray(b) ? b[0] : b.low
  const hi = Array.isArray(b) ? b[1] : b.high
  return `${formatUsd(lo)}–${formatUsd(hi)}`
}

/** Round a week band to whole weeks for display. */
export function formatWeekBand(b: Band): string {
  const lo = Math.round(b.low)
  const hi = Math.round(b.high)
  return lo === hi ? `${lo} wks` : `${lo}–${hi} wks`
}

export function formatPctBand(b: Band): string {
  return `${Math.round(b.low * 100)}–${Math.round(b.high * 100)}%`
}
