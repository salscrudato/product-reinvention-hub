// DeterminationCard — the centerpiece of the Claims coverage copilot. A grounded coverage
// determination, read like a verdict: a custom verdict emblem (green = covered, red = not) and
// a one-line "this policy covers this / it doesn't" headline, then clean, subtly-divided
// sections — the coverage(s) that apply, 3 cited reasons why, the limits that apply, and the
// deductibles that apply. All colour comes from design tokens (verdict tints via color-mix);
// no hard hex (inline SVG is rendered in the browser, so it uses vars too).
import type { ReactNode } from 'react'
import { RefChip } from '../ui'
import { IconWarning, IconInfo } from '../ui/icons'
import type { Verdict, Determination } from '../../lib/claims/determination'

// The determination shape + verdict live in the platform-free claims lib (it is unit-
// tested there against the server guard). Re-exported here so the Claims route keeps
// importing the card's types from the card.
export type { Verdict, Determination } from '../../lib/claims/determination'

// Verdict presentation. One token per verdict drives the emblem, the top accent bar and the
// header wash (all via color-mix, never a duplicated hex). The headline states the outcome in
// plain coverage language; NOT_ADDRESSED stays neutral slate (never a coverage-implying colour).
const VERDICT: Record<Verdict, { label: string; headline: string; token: string }> = {
  COVERED:       { label: 'Covered',           headline: 'This policy covers this.',              token: 'var(--color-good)' },
  NOT_COVERED:   { label: 'Not covered',       headline: 'This policy does not cover this.',       token: 'var(--color-danger)' },
  PARTIAL:       { label: 'Partially covered', headline: 'This policy may cover this — it depends.', token: 'var(--color-warn)' },
  NOT_ADDRESSED: { label: 'Not addressed',     headline: 'This policy doesn’t address this.',      token: 'var(--color-dim)' },
}

// ─── Verdict emblem — a simple, elegant custom SVG (green check / red cross / …) ────
// The mark is drawn with rounded strokes in the verdict token; two faint rings + a soft disc
// and a drop-shadow glow give it depth. Purely decorative (aria-hidden); the headline carries
// the meaning for assistive tech.
function VerdictMark({ verdict, token }: { verdict: Verdict; token: string }) {
  const stroke = { stroke: token, strokeWidth: 3.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  if (verdict === 'COVERED')     return <path d="M23 34 L30 41 L44 23" {...stroke} />
  if (verdict === 'NOT_COVERED') return <path d="M25 25 L41 41 M41 25 L25 41" {...stroke} />
  if (verdict === 'PARTIAL')     return <><path d="M33 21 L33 35" {...stroke} /><circle cx="33" cy="42.5" r="2" fill={token} /></>
  return <path d="M24 33 L42 33" {...stroke} /> // NOT_ADDRESSED — a neutral dash
}

function VerdictEmblem({ verdict, token }: { verdict: Verdict; token: string }) {
  return (
    <div
      className="rise-in"
      style={{ filter: `drop-shadow(0 4px 16px color-mix(in srgb, ${token} 32%, transparent))` }}
      aria-hidden="true"
    >
      <svg width="66" height="66" viewBox="0 0 66 66" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="33" cy="33" r="31" stroke={token} strokeOpacity="0.14" strokeWidth="1.5" />
        <circle cx="33" cy="33" r="24" strokeWidth="1.5" stroke={token} strokeOpacity="0.4"
          fill={`color-mix(in srgb, ${token} 13%, var(--color-surface))`} />
        <VerdictMark verdict={verdict} token={token} />
      </svg>
    </div>
  )
}

// ─── Citation linkifying ────────────────────────────────────────────────────────
// Any [bracketed] token — refId, form number or form section — renders as a crisp
// mono chip so citations read as precise, scannable tokens throughout.
const CITE_RE = /\[([^\]]+)\]/g

/** Render text with its bracketed citations as inline mono chips. */
export function CitedText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  CITE_RE.lastIndex = 0
  while ((m = CITE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(
      <span key={`c${i++}`}
        className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-[5px] bg-accent-soft text-accent font-mono text-[11px] font-medium align-baseline">
        {m[1]!.trim()}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <span className="whitespace-pre-wrap leading-relaxed">{nodes}</span>
}

// ─── Section primitives ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-[.07em] text-faint">{title}</h4>
      {children}
    </section>
  )
}

/** A value row — used by both Limits and Deductibles for a consistent, tabular read. */
function ValueRow({ label, value, source, note, first }: { label: string; value: string; source?: string; note?: string; first: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2" style={{ borderTop: first ? 'none' : '1px solid var(--color-border)' }}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] text-text">{label}</span>
        {note && <span className="text-[11px] text-faint leading-snug">{note}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono tnum text-[13px] text-text">{value}</span>
        {source && <RefChip id={source} />}
      </div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function DeterminationCard({ d }: { d: Determination }) {
  const v = VERDICT[d.verdict] ?? VERDICT.PARTIAL
  const wash = `color-mix(in srgb, ${v.token} 8%, var(--color-surface))`
  // Defensive: the structured payload comes from the model — default the arrays so a
  // partial determination renders cleanly instead of crashing the message.
  const coverages  = d.coverages ?? []
  const exclusions = d.exclusions ?? []
  const reasoning  = d.reasoning ?? []
  const openItems  = d.openItems ?? []
  const gap        = d.coverageGap
  const covered    = d.verdict === 'COVERED' || d.verdict === 'PARTIAL'

  // Split the flat limits array into the two sections the card presents separately.
  const isDeductible = (label: string) => /deduct/i.test(label)
  const allLimits    = d.limits ?? []
  const limits       = allLimits.filter(l => !isDeductible(l.label))
  const deductibles  = allLimits.filter(l => isDeductible(l.label))

  // Build the divided body from only the sections that have content, in reading order.
  const sections: ReactNode[] = []

  if (coverages.length > 0) {
    sections.push(
      <Section key="cov" title={covered ? 'Covered under' : 'Coverages named'}>
        <ul className="flex flex-col gap-2.5">
          {coverages.map((c, i) => (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-[13px] text-text">{c.name}</span>
                {c.refId && <RefChip id={c.refId} tone="accent" />}
                {c.formNumber && <RefChip id={c.formNumber} tone="accent" />}
              </div>
              <p className="text-[13px] text-dim leading-relaxed">{c.definition}</p>
            </li>
          ))}
        </ul>
      </Section>,
    )
  }

  if (exclusions.length > 0) {
    sections.push(
      <Section key="exc" title="What’s not covered">
        <ul className="flex flex-col gap-2.5">
          {exclusions.map((e, i) => (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-danger)' }} aria-hidden="true" />
                <span className="font-semibold text-[13px] text-text">{e.name}</span>
                {e.refId && <RefChip id={e.refId} />}
                {e.formNumber && <RefChip id={e.formNumber} />}
              </div>
              {e.note && <p className="text-[13px] text-dim leading-relaxed"><CitedText text={e.note} /></p>}
            </li>
          ))}
        </ul>
      </Section>,
    )
  }

  if (reasoning.length > 0) {
    sections.push(
      <Section key="why" title="Why">
        <ul className="flex flex-col gap-2">
          {reasoning.map((r, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-dim leading-relaxed">
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: v.token }} aria-hidden="true" />
              <span className="min-w-0"><CitedText text={r} /></span>
            </li>
          ))}
        </ul>
      </Section>,
    )
  }

  if (limits.length > 0) {
    sections.push(
      <Section key="lim" title="Limits that apply">
        <div className="flex flex-col">
          {limits.map((l, i) => <ValueRow key={i} first={i === 0} label={l.label} value={l.value} source={l.source} note={l.note} />)}
        </div>
      </Section>,
    )
  }

  if (deductibles.length > 0) {
    sections.push(
      <Section key="ded" title="Deductibles that apply">
        <div className="flex flex-col">
          {deductibles.map((l, i) => <ValueRow key={i} first={i === 0} label={l.label} value={l.value} source={l.source} note={l.note} />)}
        </div>
      </Section>,
    )
  }

  return (
    <article
      className="rounded-[16px] bg-surface overflow-hidden rise-in"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      aria-label={`Coverage determination: ${v.label}`}
    >
      {/* Slim verdict accent bar */}
      <div style={{ height: 3, background: v.token }} aria-hidden="true" />

      {/* Hero — emblem + plain-language verdict headline + one-line summary */}
      <div className="flex flex-col items-center text-center gap-3 px-5 pt-6 pb-5"
        style={{ background: wash, borderBottom: `1px solid color-mix(in srgb, ${v.token} 16%, transparent)` }}>
        <VerdictEmblem verdict={d.verdict} token={v.token} />
        <div className="flex flex-col gap-1 items-center">
          <span className="inline-flex items-center h-6 px-2.5 rounded-full text-white text-[11px] font-semibold tracking-[.02em]" style={{ background: v.token }}>
            {v.label}
          </span>
          <h3 className="text-[17px] font-bold text-text tracking-tight leading-snug">{v.headline}</h3>
          {d.summary && <p className="text-[13px] text-dim max-w-md leading-relaxed">{d.summary}</p>}
        </div>
      </div>

      {/* Clean, subtly-divided sections */}
      {sections.length > 0 && (
        <div className="flex flex-col">
          {sections.map((node, i) => (
            <div key={i} className="px-5 py-4" style={i > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}>
              {node}
            </div>
          ))}
        </div>
      )}

      {/* What the form doesn't determine (subtle) */}
      {openItems.length > 0 && (
        <div className="mx-5 mb-4 flex gap-2.5 rounded-[12px] p-3" style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
          <IconWarning size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[12px] font-semibold text-text">Not determined by the form</span>
            <ul className="flex flex-col gap-1">
              {openItems.map((o, i) => <li key={i} className="text-[12px] text-dim leading-relaxed"><CitedText text={o} /></li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Coverage gap — product-QA signal, only for the ambiguous verdicts it is meant for. */}
      {(d.verdict === 'NOT_ADDRESSED' || d.verdict === 'PARTIAL') && gap?.note?.trim() && (
        <div className="mx-5 mb-4 flex gap-2.5 rounded-[12px] p-3" style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
          <IconInfo size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--color-warn)' }} aria-hidden="true" />
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--color-warn)' }}>Coverage gap</span>
            <p className="text-[12px] text-dim leading-relaxed"><CitedText text={gap.note} /></p>
            {gap.sources && gap.sources.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                {gap.sources.map((s, i) => <RefChip key={i} id={s} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2.5 text-[11px] text-faint leading-relaxed" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-raised)' }}>
        Grounded in {d.formNumber ? <span className="font-mono text-dim">{d.formNumber}</span> : 'the base form'} + product data. This is a coverage-analysis aid, not a claims decision.
      </div>
    </article>
  )
}
