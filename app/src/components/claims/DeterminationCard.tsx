// DeterminationCard — the centerpiece of the Claims coverage copilot. Renders a
// grounded coverage determination as one scannable card: a bold verdict pill +
// plain-English summary, the coverages/endorsements that apply (name + refId chip +
// definition), the limits & deductibles with source chips, cited reasoning, an
// honest "what the form doesn't determine" callout, and the aid-not-a-decision
// footer. All colour comes from tokens (verdict tints via color-mix); no hard hex.
import type { ReactNode } from 'react'
import { RefChip } from '../ui'
import { IconCheckCircle, IconAlertCircle, IconWarning, IconInfo, type IconType } from '../ui/icons'
import type { Verdict, Determination } from '../../lib/claims/determination'

// The determination shape + verdict live in the platform-free claims lib (it is unit-
// tested there against the server guard). Re-exported here so the Claims route keeps
// importing the card's types from the card.
export type { Verdict, Determination } from '../../lib/claims/determination'

// Verdict presentation. Solid token for the bold pill; a color-mixed wash for the
// header so the tint is always derived from the same token (never a duplicated hex).
// NOT_ADDRESSED gets a neutral slate (never a coverage-implying green/red) so an
// "the form is silent" answer reads as exactly that.
const VERDICT: Record<Verdict, { label: string; token: string; Icon: IconType }> = {
  COVERED:       { label: 'Covered',                     token: 'var(--color-good)',   Icon: IconCheckCircle },
  NOT_COVERED:   { label: 'Not covered',                 token: 'var(--color-danger)', Icon: IconAlertCircle },
  PARTIAL:       { label: 'Partially covered · depends', token: 'var(--color-warn)',   Icon: IconWarning },
  NOT_ADDRESSED: { label: 'Not addressed by this form',  token: 'var(--color-dim)',    Icon: IconInfo },
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

// ─── Section wrapper ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">{title}</h4>
      {children}
    </section>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function DeterminationCard({ d }: { d: Determination }) {
  const v = VERDICT[d.verdict] ?? VERDICT.PARTIAL
  const wash = `color-mix(in srgb, ${v.token} 9%, var(--color-surface))`
  // Defensive: the structured payload comes from the model — default the arrays so a
  // partial determination renders cleanly instead of crashing the message.
  const coverages  = d.coverages ?? []
  const exclusions = d.exclusions ?? []
  const limits     = d.limits ?? []
  const reasoning  = d.reasoning ?? []
  const openItems  = d.openItems ?? []

  return (
    <article
      className="rounded-[16px] bg-surface overflow-hidden rise-in"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      aria-label={`Coverage determination: ${v.label}`}
    >
      {/* Verdict + one-line summary */}
      <div className="flex items-start gap-3 p-4" style={{ background: wash, borderBottom: `1px solid color-mix(in srgb, ${v.token} 18%, transparent)` }}>
        <span
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-white text-[12px] font-semibold tracking-[.01em] shrink-0"
          style={{ background: v.token }}
        >
          <v.Icon size={14} aria-hidden="true" />
          {v.label}
        </span>
        <p className="text-[14px] text-text font-medium leading-snug pt-0.5">{d.summary}</p>
      </div>

      <div className="flex flex-col gap-5 p-4">
        {/* Coverages that apply */}
        <Section title="Coverages that apply">
          {coverages.length === 0 ? (
            <p className="text-[13px] text-dim italic">
              {d.verdict === 'NOT_ADDRESSED'
                ? "This form doesn't address the described scenario — nothing in it applies."
                : 'No coverages apply to this loss under the base form.'}
            </p>
          ) : (
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
          )}
        </Section>

        {/* What's not covered — the specific exclusions / carve-outs that shaped the verdict */}
        {exclusions.length > 0 && (
          <Section title="What's not covered">
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
          </Section>
        )}

        {/* Limits & deductibles */}
        {limits.length > 0 && (
          <Section title="Limits & deductibles">
            <div className="flex flex-col">
              {limits.map((l, i) => (
                <div key={i} className="flex items-baseline justify-between gap-4 py-2"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[13px] text-text">{l.label}</span>
                    {l.note && <span className="text-[11px] text-faint leading-snug">{l.note}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono tnum text-[13px] text-text">{l.value}</span>
                    {l.source && <RefChip id={l.source} />}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Why */}
        {reasoning.length > 0 && (
          <Section title="Why">
            <ol className="flex flex-col gap-1.5 list-decimal marker:text-faint marker:text-[11px] pl-4">
              {reasoning.map((r, i) => (
                <li key={i} className="text-[13px] text-dim leading-relaxed pl-0.5"><CitedText text={r} /></li>
              ))}
            </ol>
          </Section>
        )}

        {/* What the form doesn't determine */}
        {openItems.length > 0 && (
          <div className="flex gap-2.5 rounded-[12px] p-3" style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
            <IconWarning size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-[12px] font-semibold text-text">Not determined by the form</span>
              <ul className="flex flex-col gap-1">
                {openItems.map((o, i) => (
                  <li key={i} className="text-[12px] text-dim leading-relaxed"><CitedText text={o} /></li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 text-[11px] text-faint leading-relaxed" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-raised)' }}>
        Grounded in {d.formNumber ? <span className="font-mono text-dim">{d.formNumber}</span> : 'the base form'} + product data. This is a coverage-analysis aid, not a claims decision.
      </div>
    </article>
  )
}
