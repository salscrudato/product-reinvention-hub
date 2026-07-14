// Pricing — the public value-based pricing page. Positions the Hub as a
// consulting-wrapped platform for a category with no equivalent, priced in four
// commercial layers, with an interactive ROI calculator as the centerpiece.
//
// Every dollar figure, tier and band comes from lib/pricing.ts (flagged
// ILLUSTRATIVE - PENDING COMMERCIAL APPROVAL). No client names, pipeline data or
// internal engagement names appear here. Pure CSS + inline SVG, zero chart libs,
// zero images; honours prefers-reduced-motion via the global guard in index.css.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/ui'
import { reportWebVitals } from '../lib/perf/reportWebVitals'
import {
  IconArrowRight, IconCheck, IconSparkle, IconLayers, IconSettings, IconChart, IconShield,
} from '../components/icons'
import {
  POSITIONING, PRICING_STATUS, PRICING_DISCLAIMER,
  PLATFORM_TIERS, AI_USAGE, SERVICES, TRANSFORMATION, COMMERCIAL_LAYERS,
  ROI_BANDS, ROI_DEFAULTS, ROI_SLIDERS, computeRoi,
  formatUsd, formatUsdBand, formatWeekBand, formatPctBand,
  type RoiInputs, type RoiSlider, type Band,
} from '../lib/pricing'

// ─── Aurora backdrop (shared visual language with the landing) ────────────────

function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="aurora-a absolute w-[720px] h-[520px] rounded-full opacity-25 -top-48 -left-40"
        style={{ background: 'var(--gradient-aurora-a)' }} />
      <div className="aurora-b absolute w-[620px] h-[460px] rounded-full opacity-20 top-1/3 -right-32"
        style={{ background: 'var(--gradient-aurora-b)' }} />
    </div>
  )
}

// ─── Illustrative-pricing badge ───────────────────────────────────────────────

function IllustrativePill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide uppercase"
      style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)', border: '1px solid var(--color-warn-line)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-warn)' }} aria-hidden="true" />
      {PRICING_STATUS}
    </span>
  )
}

// ─── ROI value bar (hand-rolled SVG, no chart lib) ────────────────────────────
// A single 0–40% comparable scale across the three levers; the concrete
// magnitude (weeks or dollars) is shown to the right in plain text.

const SCALE_MAX = 0.40
const TINT: Record<'accent' | 'good' | 'info', string> = {
  accent: 'var(--color-accent)',
  good: 'var(--color-good)',
  info: 'var(--color-accent-bright)',
}

function ValueBar({ band, tint }: { band: Band; tint: 'accent' | 'good' | 'info' }) {
  const hi = Math.min(1, band.high / SCALE_MAX) * 100
  const lo = Math.min(1, band.low / SCALE_MAX) * 100
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10" role="presentation" aria-hidden="true" className="block">
      {/* track */}
      <rect x="0" y="0" width="100" height="10" rx="5" fill="var(--color-page)" stroke="var(--color-border)" strokeWidth="0.5" />
      {/* fill to band high — width transitions with the sliders (reduced-motion collapses it) */}
      <rect x="0" y="0" width={hi} height="10" rx="5" fill={TINT[tint]}
        style={{ transition: 'width var(--duration-base) var(--ease-spring)' }} />
      {/* low tick within the fill (marks the band floor) */}
      <rect x={Math.max(0, lo - 0.5)} y="0" width="1" height="10" fill="var(--color-surface)" opacity="0.9"
        style={{ transition: 'x var(--duration-base) var(--ease-spring)' }} />
    </svg>
  )
}

interface Lever { key: string; label: string; tint: 'accent' | 'good' | 'info'; band: Band; magnitude: string; sub: string }

function RoiLever({ lever }: { lever: Lever }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-text">{lever.label}</span>
        <span className="text-sm font-semibold text-text tabular-nums">{lever.magnitude}</span>
      </div>
      <ValueBar band={lever.band} tint={lever.tint} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-faint">{formatPctBand(lever.band)} improvement</span>
        <span className="text-[11px] text-faint">{lever.sub}</span>
      </div>
    </div>
  )
}

function RoiCalculator() {
  const [inputs, setInputs] = useState<RoiInputs>(ROI_DEFAULTS)
  const roi = useMemo(() => computeRoi(inputs), [inputs])

  const set = (key: keyof RoiInputs, value: number) => setInputs((p) => ({ ...p, [key]: value }))

  const fmtSlider = (s: RoiSlider, v: number) =>
    s.unit === 'usd' ? formatUsd(v) : s.unit === 'weeks' ? `${v} weeks` : `${v}`

  const levers: Lever[] = [
    {
      key: 'speed', label: 'Speed to market', tint: 'accent', band: ROI_BANDS.speedToMarket,
      magnitude: `${formatWeekBand(roi.weeksSavedPerLaunch)} faster`,
      sub: `${formatWeekBand(roi.productWeeksReclaimed)} reclaimed / yr`,
    },
    {
      key: 'opex', label: 'Product OpEx', tint: 'good', band: ROI_BANDS.opex,
      magnitude: `${formatUsdBand(roi.opexSavingsUsd)} / yr`,
      sub: 'hard-dollar efficiency',
    },
    {
      key: 'onboarding', label: 'Onboarding', tint: 'info', band: ROI_BANDS.onboarding,
      magnitude: `${formatWeekBand(roi.onboardingWeeksSaved)} faster`,
      sub: 'per new author or line',
    },
  ]

  return (
    <div
      className="rounded-[22px] p-6 sm:p-8 grid gap-8 lg:grid-cols-2"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Inputs */}
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-[10px] flex items-center justify-center" style={{ background: 'var(--gradient-accent-soft)' }}>
            <IconSettings size={17} className="text-accent" />
          </span>
          <h3 className="text-[15px] font-semibold text-text">Your portfolio today</h3>
        </div>
        {ROI_SLIDERS.map((s) => (
          <label key={s.key} className="flex flex-col gap-2">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-text">{s.label}</span>
              <span className="text-sm font-semibold text-accent tabular-nums">{fmtSlider(s, inputs[s.key])}</span>
            </span>
            <input
              type="range"
              min={s.min} max={s.max} step={s.step}
              value={inputs[s.key]}
              onChange={(e) => set(s.key, Number(e.target.value))}
              className="w-full h-1.5 cursor-pointer"
              style={{ accentColor: 'var(--color-accent)' }}
              aria-label={s.label}
              aria-valuetext={fmtSlider(s, inputs[s.key])}
            />
            <span className="text-[11px] text-faint">{s.help}</span>
          </label>
        ))}
      </div>

      {/* Results */}
      <div className="flex flex-col gap-5 lg:pl-8 lg:border-l" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint font-semibold">Illustrative annual value</span>
          <span className="text-4xl sm:text-5xl font-bold gradient-text tabular-nums leading-none"
            style={{ transition: 'opacity var(--duration-fast) var(--ease-spring)' }}>
            {formatUsdBand(roi.annualValueUsd)}
          </span>
          <span className="text-sm text-dim">
            OpEx efficiency per year. Speed and onboarding gains are shown in weeks — never
            converted to dollars and summed, so this figure can’t double-count.
          </span>
        </div>

        <div className="flex flex-col gap-4">
          {levers.map((l) => <RoiLever key={l.key} lever={l} />)}
        </div>
      </div>
    </div>
  )
}

// ─── Platform tier card ───────────────────────────────────────────────────────

function TierCard({ tier, delay }: { tier: typeof PLATFORM_TIERS[number]; delay: number }) {
  return (
    <div
      className="rise-in relative rounded-[18px] p-6 flex flex-col gap-4"
      style={{
        background: tier.featured ? 'var(--gradient-accent-soft)' : 'var(--color-surface)',
        border: `1px solid ${tier.featured ? 'var(--color-accent-line)' : 'var(--color-border)'}`,
        boxShadow: 'var(--shadow-card)',
        '--rise-delay': `${delay}ms`,
      } as React.CSSProperties}
    >
      {tier.featured && (
        <span className="absolute -top-2.5 right-5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full text-white"
          style={{ background: 'var(--gradient-accent-vivid)' }}>Most chosen</span>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-text">{tier.name}</h3>
        <p className="text-sm text-dim">{tier.blurb}</p>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-text tabular-nums">{formatUsdBand(tier.annualLicenseUsd)}</span>
        <span className="text-xs text-faint">/ year</span>
      </div>
      <ul className="flex flex-col gap-2 mt-1">
        {[tier.linesOfBusiness, tier.users, tier.connectors, tier.aiTokenBudget].map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-dim">
            <IconCheck size={16} className="text-accent shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-2 max-w-2xl">
      <span className="text-xs font-semibold uppercase tracking-wider text-accent">{eyebrow}</span>
      <h2 className="text-2xl sm:text-3xl font-bold text-text leading-tight">{title}</h2>
      {sub && <p className="text-base text-dim leading-relaxed">{sub}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Pricing() {
  useEffect(() => { reportWebVitals('pricing') }, [])

  const layerIcons = [IconLayers, IconSparkle, IconSettings, IconChart]

  return (
    <div className="relative min-h-svh flex flex-col overflow-hidden bg-page">
      <Aurora />

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <Link to="/" className="flex items-center gap-2.5 group focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent rounded-[8px]">
          <Logo size={30} />
          <span className="font-semibold text-text text-[15px] tracking-tight">Product Reinvention Hub</span>
        </Link>
        <nav className="flex items-center gap-1.5 sm:gap-3">
          <span className="hidden sm:inline text-sm font-medium text-accent px-3 py-2">Pricing</span>
          <Link to="/"
            className="btn-wave-shine inline-flex items-center gap-1.5 text-sm font-semibold text-white px-4 py-2 rounded-[10px] transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 4px 14px var(--glow-accent)' }}>
            Sign in <IconArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-6 sm:px-10 pb-20 flex flex-col gap-20">

        {/* Hero */}
        <section className="pt-8 flex flex-col items-start gap-5 max-w-3xl">
          <div className="rise-in" style={{ '--rise-delay': '0ms' } as React.CSSProperties}>
            <IllustrativePill />
          </div>
          <span className="rise-in text-xs font-semibold uppercase tracking-wider text-accent" style={{ '--rise-delay': '40ms' } as React.CSSProperties}>{POSITIONING.eyebrow}</span>
          <h1 className="rise-in text-[2.25rem] sm:text-5xl font-bold text-text leading-[1.06]" style={{ '--rise-delay': '80ms' } as React.CSSProperties}>
            {POSITIONING.headline.split('—')[0]}—<br className="hidden sm:block" />
            <span className="gradient-text">{POSITIONING.headline.split('—')[1]}</span>
          </h1>
          <p className="rise-in text-base sm:text-lg text-dim leading-relaxed max-w-2xl" style={{ '--rise-delay': '140ms' } as React.CSSProperties}>
            {POSITIONING.sub}
          </p>
        </section>

        {/* Four commercial layers overview */}
        <section className="flex flex-col gap-6" aria-label="Commercial layers">
          <SectionHead eyebrow="How it’s priced" title="Four layers, one commercial model" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COMMERCIAL_LAYERS.map((l, i) => {
              const Icon = layerIcons[i]
              return (
                <div key={l.n} className="rise-in rounded-[16px] p-5 flex flex-col gap-3"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)', '--rise-delay': `${i * 70}ms` } as React.CSSProperties}>
                  <div className="flex items-center justify-between">
                    <span className="w-9 h-9 rounded-[11px] flex items-center justify-center" style={{ background: 'var(--gradient-accent-soft)' }}>
                      <Icon size={18} className="text-accent" />
                    </span>
                    <span className="text-xs font-mono text-faint">0{l.n}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold text-text">{l.name}</span>
                    <span className="text-xs font-medium text-accent">{l.kind}</span>
                  </div>
                  <p className="text-sm text-dim leading-relaxed">{l.note}</p>
                </div>
              )
            })}
          </div>
        </section>

        {/* ROI calculator — centerpiece */}
        <section className="flex flex-col gap-6" aria-label="ROI calculator">
          <SectionHead
            eyebrow="The value case"
            title="Model the value, live"
            sub="Move the sliders to your portfolio. The bands below are published assumptions — speed-to-market 25–35%, product OpEx 10–15%, onboarding 15–20% — applied to what you enter."
          />
          <RoiCalculator />
          <p className="text-xs text-faint max-w-3xl">{PRICING_DISCLAIMER}</p>
        </section>

        {/* Layer 1 — Platform tiers */}
        <section className="flex flex-col gap-6" aria-label="Platform license">
          <SectionHead eyebrow="Layer 1 · Platform license" title="Annual subscription, tiered to your book"
            sub="Priced on lines of business, authors and connectors — not per seat. Every tier includes a monthly AI token budget." />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLATFORM_TIERS.map((t, i) => <TierCard key={t.id} tier={t} delay={i * 80} />)}
          </div>
        </section>

        {/* Layer 2 — AI usage */}
        <section className="flex flex-col gap-6" aria-label="AI usage">
          <SectionHead eyebrow="Layer 2 · AI usage" title={AI_USAGE.name + ' — metered on top of the budget'} sub={AI_USAGE.blurb} />
          <div className="rounded-[18px] p-6 flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
            <ul className="grid sm:grid-cols-2 gap-2.5 flex-1">
              {AI_USAGE.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-dim">
                  <IconCheck size={16} className="text-accent shrink-0 mt-0.5" /><span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col items-start sm:items-end shrink-0">
              <span className="text-2xl font-bold text-text tabular-nums">{formatUsd(AI_USAGE.overageUsdPerMillion)}</span>
              <span className="text-xs text-faint">per 1M tokens over budget</span>
            </div>
          </div>
        </section>

        {/* Layer 3 — Services */}
        <section className="flex flex-col gap-6" aria-label="Services">
          <SectionHead eyebrow="Layer 3 · Services" title="Stand it up, then run it"
            sub="A consulting arc that de-risks the platform: fixed-price phases to launch, then AI Run as a managed service." />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SERVICES.map((s, i) => (
              <div key={s.id} className="rise-in rounded-[18px] p-6 flex flex-col gap-3"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)', '--rise-delay': `${i * 80}ms` } as React.CSSProperties}>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-text">{s.name}</h3>
                  <span className="text-sm font-semibold text-accent tabular-nums">{s.figure}</span>
                </div>
                <span className="inline-flex self-start items-center gap-1.5 text-[11px] font-medium text-dim px-2.5 py-1 rounded-full"
                  style={{ background: 'var(--color-page)', border: '1px solid var(--color-border)' }}>
                  {s.model} · {s.duration}
                </span>
                <p className="text-sm text-dim leading-relaxed">{s.blurb}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Layer 4 — Transformation */}
        <section className="flex flex-col gap-6" aria-label="Transformation">
          <SectionHead eyebrow="Layer 4 · Transformation" title={TRANSFORMATION.name + ' — priced to the outcome'} sub={TRANSFORMATION.blurb} />
          <div className="rounded-[18px] p-6 sm:p-8 flex flex-col md:flex-row gap-6 items-start"
            style={{ background: 'var(--gradient-accent-soft)', border: '1px solid var(--color-accent-line)' }}>
            <span className="w-11 h-11 rounded-[13px] flex items-center justify-center shrink-0" style={{ background: 'var(--color-surface)' }}>
              <IconShield size={22} className="text-accent" />
            </span>
            <ul className="grid sm:grid-cols-3 gap-3 flex-1">
              {TRANSFORMATION.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-text">
                  <IconCheck size={16} className="text-accent shrink-0 mt-0.5" /><span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-[22px] p-8 sm:p-12 flex flex-col items-center text-center gap-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <h2 className="text-2xl sm:text-3xl font-bold text-text max-w-xl leading-tight">Bring your portfolio. We’ll model the rest.</h2>
          <p className="text-base text-dim max-w-lg">Sign in to explore the platform, or start a Strategy phase to build the value case against your own numbers.</p>
          <Link to="/"
            className="btn-wave-shine inline-flex items-center gap-2 h-12 px-7 rounded-[13px] text-white text-[15px] font-semibold transition-transform duration-200 hover:scale-[1.02] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 8px 24px var(--glow-accent)' }}>
            Get started <IconArrowRight size={18} />
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-3 py-6 text-xs text-faint text-center px-6" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span>Product Reinvention Hub · P&amp;C Insurance Product Management</span>
        <span className="hidden sm:inline">·</span>
        <span>{PRICING_STATUS}</span>
      </footer>
    </div>
  )
}
