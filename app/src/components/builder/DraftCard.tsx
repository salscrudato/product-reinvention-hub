// DraftCard — one draft in the Builder workbench (P3: console truth).
//   • Identity (task 1): title = server-derived displayName; source-file chip +
//     relative import timestamp; the placeholder "Core" is unreachable when a
//     source file exists, and legacy placeholder names render "Untitled draft – Mon DD".
//   • Telemetry (task 3): labeled counts with thousands separators; an IMPORTED
//     draft with 0 forms gets the amber "view extraction report" diagnostic chip
//     (a deliberately empty non-imported draft stays neutral).
//   • Readiness + armed Promote (task 4): the three lights and the Promote arming
//     render the SERVER's readiness verdict only — a blocked Promote shows the
//     server's blockers verbatim; the promote 409 remains the actual enforcement.
//   • Delete safety (task 5/09): no trash in the action row — destructive actions
//     live behind the overflow kebab (Menu primitive) → two-step confirm.
import { useId, useState } from 'react'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'
import type { DraftIdentity, DraftReadiness } from '../../lib/backend'
import { RefChip, LifecyclePill } from '../ui'
import { IconCoverage, IconForm, IconFile, IconArrowRight, IconArrowUp, IconTrash, IconMore, IconAlertCircle } from '../ui/icons'
import { LineageBadge } from '../product/LineageBadge'
import { Menu } from '../menu/Menu'
import { ReadinessStrip } from './ReadinessStrip'
import { ExtractionReportDialog } from './ExtractionReportDialog'
import { draftTitle, timeAgo, countLabel } from './draftPresentation'

/** The row the seam actually returns: Product + the server-derived read-only
 *  projections (identity/readiness) and the P3 apply-time stamps. */
export type DraftRow = WithId<Product> & {
  identity?: DraftIdentity
  readiness?: DraftReadiness
  importRunId?: string
  updatedAt?: string
}

export function DraftCard({ p, covCount, formCount, canEdit, onOpen, onPromote, onDelete }: {
  p: DraftRow
  covCount?: number; formCount?: number
  canEdit: boolean
  onOpen: () => void; onPromote: () => void; onDelete: () => void
}) {
  const [showReport, setShowReport] = useState(false)
  // WCAG 1.4.13: the blockers popover must be dismissible without moving focus —
  // Escape hides it; leaving/blurring re-arms it for the next hover/focus.
  const [tipDismissed, setTipDismissed] = useState(false)
  const blockersId = useId()

  const title = draftTitle(p)
  const imported = (p.lineage as { kind?: string } | undefined)?.kind === 'IMPORT'
  const when = timeAgo(p.identity?.importedAt ?? p.updatedAt ?? null)
  const whenLabel = when ? (p.identity?.importedAt ? `Imported ${when}` : `Updated ${when}`) : null
  // Promote arming renders the server verdict only; no readiness projection → armed
  // (a legacy draft is not blocked by absent evidence — same rule the server applies).
  const promotable = p.readiness ? p.readiness.promotable : true
  const blockers = p.readiness?.blockers ?? []
  // The amber diagnostic fires only for a LOADED zero on an imported draft — an
  // unknown count (inventory still loading) or a deliberately empty blank draft never alarms.
  const zeroForms = imported && formCount === 0

  return (
    // No overflow-hidden on the root: the blockers popover must escape the card
    // bounds (the hairline keeps the rounded corners itself instead).
    <div className="group relative bg-surface rounded-[16px] flex flex-col"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <span aria-hidden="true" className="block h-[3px] w-full opacity-70 rounded-t-[16px]"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />
      <div className="p-5 flex flex-col gap-3 flex-1">
        <button onClick={onOpen} aria-label={`Open ${title}`}
          className="flex flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[8px]">
          <span className="font-semibold text-[15px] text-text leading-snug group-hover:text-accent transition-colors">{title}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {p.refId && <RefChip id={p.refId} />}
            <LifecyclePill lifecycle={p.lifecycle} />
            {p.lob?.name && <span className="text-[11px] text-faint">{p.lob.name}</span>}
          </div>
        </button>

        {/* Source identity (task 1): the artifact this draft came from + when. */}
        {(p.identity?.sourceFileName || whenLabel) && (
          <div className="flex items-center gap-2 min-w-0">
            {p.identity?.sourceFileName && (
              <span className="inline-flex items-center gap-1 max-w-[60%] px-1.5 py-0.5 rounded-[6px] bg-raised text-[11px] text-dim"
                style={{ border: '1px solid var(--color-border)' }} title={p.identity.sourceFileName}>
                <IconFile size={11} className="shrink-0 text-faint" aria-hidden="true" />
                <span className="truncate">{p.identity.sourceFileName}</span>
              </span>
            )}
            {whenLabel && <span className="text-[11px] text-faint shrink-0">{whenLabel}</span>}
          </div>
        )}

        {p.lineage && <LineageBadge lineage={p.lineage} />}

        <ReadinessStrip readiness={p.readiness} />

        <div className="flex items-center gap-3 text-xs text-dim pt-3 mt-auto flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="inline-flex items-center gap-1"><IconCoverage size={13} aria-hidden="true" />{countLabel(covCount, 'coverage', 'coverages')}</span>
          {zeroForms ? (
            <button onClick={() => setShowReport(true)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[11px] font-medium text-warn hover:opacity-80 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
              <IconAlertCircle size={12} aria-hidden="true" />0 forms — view extraction report
            </button>
          ) : (
            <span className="inline-flex items-center gap-1"><IconForm size={13} aria-hidden="true" />{countLabel(formCount, 'form', 'forms')}</span>
          )}
          <span className="truncate">{p.owner?.name ? `by ${p.owner.name}` : '—'}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={onOpen}
              className="inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-[7px] text-[11px] font-medium text-dim hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              Open <IconArrowRight size={12} aria-hidden="true" />
            </button>
            {canEdit && (
              promotable ? (
                <button onClick={onPromote} title={`Promote ${title} to the published portfolio`}
                  className="inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-[7px] text-[11px] font-medium text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                  <IconArrowUp size={12} aria-hidden="true" />Promote
                </button>
              ) : (
                // Blocked: aria-disabled (stays focusable so keyboard users reach the
                // verdict) + a popover listing the server's blockers VERBATIM. The
                // server's promote 409 remains the enforcement; this only renders it.
                // WCAG 1.4.13: hoverable (no pointer-events-none — the pointer can move
                // onto the popover text), dismissible (Escape), persistent (stays while
                // hovered/focused); leaving re-arms it.
                <span className="relative inline-flex group/promote"
                  onKeyDown={(e) => { if (e.key === 'Escape') setTipDismissed(true) }}
                  onMouseLeave={() => setTipDismissed(false)}
                  onBlur={() => setTipDismissed(false)}>
                  <button aria-disabled="true" aria-describedby={blockersId}
                    className="inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-[7px] text-[11px] font-medium text-faint opacity-60 cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                    <IconArrowUp size={12} aria-hidden="true" />Promote
                  </button>
                  <span id={blockersId} role="tooltip"
                    className={`absolute bottom-full right-0 mb-2 z-50 w-64 rounded-[8px] p-2.5 text-left text-[11px] leading-snug bg-text text-surface transition-opacity duration-150 ${
                      tipDismissed ? 'opacity-0 pointer-events-none' : 'opacity-0 pointer-events-none group-hover/promote:opacity-100 group-hover/promote:pointer-events-auto group-focus-within/promote:opacity-100 group-focus-within/promote:pointer-events-auto'}`}>
                    <span className="font-semibold block mb-1">Promotion blocked by the server:</span>
                    <ul className="list-disc pl-3.5 flex flex-col gap-0.5">
                      {blockers.slice(0, 6).map((b, i) => <li key={i}>{b}</li>)}
                      {blockers.length > 6 && <li>…and {(blockers.length - 6).toLocaleString('en-US')} more</li>}
                      {blockers.length === 0 && <li>Validation failed — open the extraction report.</li>}
                    </ul>
                  </span>
                </span>
              )
            )}
            {canEdit && (
              <Menu label={`More actions for ${title}`} items={[
                ...(imported ? [{ label: 'View extraction report', onSelect: () => setShowReport(true) }] : []),
                { label: 'Delete draft', onSelect: onDelete, destructive: true, icon: <IconTrash size={13} /> },
              ]}>
                <IconMore size={14} aria-hidden="true" />
              </Menu>
            )}
          </div>
        </div>
      </div>
      {showReport && (
        <ExtractionReportDialog title={title} importRunId={p.importRunId ?? null}
          readiness={p.readiness} onClose={() => setShowReport(false)} />
      )}
    </div>
  )
}
