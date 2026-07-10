// DeterminationCard — the centerpiece of the Claims coverage copilot. A grounded coverage
// determination, read like a verdict, in one clean structured card:
//   • a custom verdict emblem + plain-language headline (Covered / Not covered / Partial),
//   • a brief 3-sentence summary,
//   • Why — 3 cited reasons supporting the verdict,
//   • Things to consider — 3 practical, grounded caveats/next steps,
//   • Document citations — a short-title ACCORDION (click a coverage/exclusion to read the clause),
//   • the limits + deductibles that apply,
//   • Data citations — the internal refIds/forms the analysis traces to (the provenance trace).
// All colour comes from design tokens (verdict tints via color-mix); no hard hex. Every citation
// is a real, catalog-resolved source (the server downgrades any it can't verify).
import { useId, type ReactNode } from 'react'
import { RefChip } from '../ui'
import { IconWarning, IconInfo, IconChat, IconCheck, IconChevronRight } from '../ui/icons'
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
      <svg width="60" height="60" viewBox="0 0 66 66" fill="none" xmlns="http://www.w3.org/2000/svg">
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

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.07em] text-faint">
        {title}
        {count != null && <span className="tabular-nums text-faint/80 font-normal normal-case tracking-normal">· {count}</span>}
      </h4>
      {children}
    </section>
  )
}

/** A bulleted, cited point (Why / Things to consider). `dot` sets the marker colour. */
function Point({ text, dot }: { text: string; dot: string }) {
  return (
    <li className="flex gap-2 text-[13px] text-dim leading-relaxed">
      <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} aria-hidden="true" />
      <span className="min-w-0"><CitedText text={text} /></span>
    </li>
  )
}

/** A value row — used by Limits + Deductibles for a consistent, tabular read. */
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

// ─── Document citation — a short-title accordion; click to read the clause ─────────
function DocCitation({ title, dotToken, formNumber, refId, body }: {
  title: string; dotToken?: string; formNumber?: string; refId?: string; body?: string
}) {
  const bodyId = useId()
  return (
    <details className="group rounded-[10px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
      <summary
        className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none select-none rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
        aria-controls={bodyId}
      >
        {dotToken && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotToken }} aria-hidden="true" />}
        <span className="font-semibold text-[13px] text-text min-w-0 truncate">{title}</span>
        {formNumber && <RefChip id={formNumber} tone="accent" />}
        <IconChevronRight size={14} aria-hidden="true"
          className="ml-auto shrink-0 text-faint transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <div id={bodyId} className="px-3 pb-2.5 pt-0 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        {body && <p className="text-[13px] text-dim leading-relaxed pt-2"><CitedText text={body} /></p>}
        {(refId || formNumber) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {refId && <DataChip id={refId} />}
            {formNumber && <RefChip id={formNumber} />}
          </div>
        )}
      </div>
    </details>
  )
}

// ─── Data citation chip — shows ANY token, incl. internal dotted refIds (PA.COV.004.002)
// that RefChip deliberately hides. This section IS the data-provenance trace, so the internal
// refIds are exactly what the reader wants to see. ─────────────────────────────────────────
function DataChip({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tracking-[-.01em] bg-raised text-dim" style={{ border: '1px solid var(--color-border)' }}>
      {id}
    </span>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function DeterminationCard({ d, onCreateFeedback, linked }: {
  d: Determination
  /** Offered on a coverage-gap card — opens the feedback capture prefilled from this gap. */
  onCreateFeedback?: () => void
  /** True once feedback has been created for this gap — swaps the action for a "Linked" chip. */
  linked?: boolean
}) {
  const v = VERDICT[d.verdict] ?? VERDICT.PARTIAL
  const wash = `color-mix(in srgb, ${v.token} 8%, var(--color-surface))`
  // Defensive: the structured payload comes from the model — default the arrays so a
  // partial determination renders cleanly instead of crashing the message.
  const coverages  = d.coverages ?? []
  const exclusions = d.exclusions ?? []
  const reasoning  = (d.reasoning ?? []).slice(0, 3)
  const openItems  = d.openItems ?? []
  // "Things to consider": prefer the dedicated field; fall back to openItems for older/cached
  // determinations. Capped at 3.
  const considerations = (d.considerations && d.considerations.length ? d.considerations : openItems).slice(0, 3)
  // Only show the separate "Not determined by the form" callout when considerations came from a
  // distinct source (so openItems isn't shown twice).
  const showOpenItemsCallout = !!(d.considerations && d.considerations.length) && openItems.length > 0
  const gap        = d.coverageGap

  const isDeductible = (label: string) => /deduct/i.test(label)
  const allLimits    = d.limits ?? []
  const limits       = allLimits.filter(l => !isDeductible(l.label))
  const deductibles  = allLimits.filter(l => isDeductible(l.label))

  // Data-citation trace: every internal refId / form / section the determination points at,
  // deduped in reading order. Powers the "Data citations" provenance section.
  const dataCitations = Array.from(new Set([
    ...coverages.flatMap(c => [c.refId, c.formNumber]),
    ...exclusions.flatMap(e => [e.refId, e.formNumber]),
    ...allLimits.map(l => l.source),
    ...(gap?.sources ?? []),
    ...(d.citations ?? []),
  ].map(s => (s ?? '').trim()).filter(Boolean)))

  const sections: ReactNode[] = []

  if (reasoning.length > 0) {
    sections.push(
      <Section key="why" title={`Why it’s ${v.label.toLowerCase()}`} count={reasoning.length}>
        <ul className="flex flex-col gap-2">{reasoning.map((r, i) => <Point key={i} text={r} dot={v.token} />)}</ul>
      </Section>,
    )
  }

  if (considerations.length > 0) {
    sections.push(
      <Section key="consider" title="Things to consider" count={considerations.length}>
        <ul className="flex flex-col gap-2">{considerations.map((c, i) => <Point key={i} text={c} dot="var(--color-info)" />)}</ul>
      </Section>,
    )
  }

  if (coverages.length > 0 || exclusions.length > 0) {
    sections.push(
      <Section key="doc" title="Document citations" count={coverages.length + exclusions.length}>
        <div className="flex flex-col gap-1.5">
          {coverages.map((c, i) => (
            <DocCitation key={`c${i}`} title={c.name} dotToken={v.token} formNumber={c.formNumber} refId={c.refId} body={c.definition} />
          ))}
          {exclusions.map((e, i) => (
            <DocCitation key={`e${i}`} title={e.name} dotToken="var(--color-danger)" formNumber={e.formNumber} refId={e.refId} body={e.note} />
          ))}
        </div>
      </Section>,
    )
  }

  if (limits.length > 0 || deductibles.length > 0) {
    sections.push(
      <Section key="lim" title="Limits & deductibles">
        <div className="flex flex-col">
          {limits.map((l, i) => <ValueRow key={`l${i}`} first={i === 0} label={l.label} value={l.value} source={l.source} note={l.note} />)}
          {deductibles.map((l, i) => <ValueRow key={`d${i}`} first={i === 0 && limits.length === 0} label={l.label} value={l.value} source={l.source} note={l.note} />)}
        </div>
      </Section>,
    )
  }

  if (dataCitations.length > 0) {
    sections.push(
      <Section key="data" title="Data citations" count={dataCitations.length}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {dataCitations.map((id, i) => <DataChip key={i} id={id} />)}
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

      {/* Hero — emblem + plain-language verdict headline + brief 3-sentence summary */}
      <div className="flex flex-col items-center text-center gap-3 px-5 pt-6 pb-5"
        style={{ background: wash, borderBottom: `1px solid color-mix(in srgb, ${v.token} 16%, transparent)` }}>
        <VerdictEmblem verdict={d.verdict} token={v.token} />
        <div className="flex flex-col gap-1.5 items-center">
          <span className="inline-flex items-center h-6 px-2.5 rounded-full text-white text-[11px] font-semibold tracking-[.02em]" style={{ background: v.token }}>
            {v.label}
          </span>
          <h3 className="text-[17px] font-bold text-text tracking-tight leading-snug">{v.headline}</h3>
          {d.summary && <p className="text-[13px] text-dim max-w-lg leading-relaxed">{d.summary}</p>}
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

      {/* What the form doesn't determine (only when distinct from the considerations above) */}
      {showOpenItemsCallout && (
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
            {(onCreateFeedback || linked) && (
              <div className="pt-1.5">
                {linked ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-[6px] px-2 py-1 bg-accent-soft text-accent">
                    <IconCheck size={12} aria-hidden="true" /> Linked feedback
                  </span>
                ) : (
                  <button type="button" onClick={onCreateFeedback}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-[7px] px-2.5 py-1 text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    style={{ background: 'var(--color-warn)' }}>
                    <IconChat size={12} aria-hidden="true" /> Create product feedback
                  </button>
                )}
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
