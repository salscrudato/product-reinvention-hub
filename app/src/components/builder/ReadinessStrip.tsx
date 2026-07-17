// ReadinessStrip — the three readiness lights (P3 task 4): citations, blockers,
// validation. Rendered ONLY from the server-derived DraftReadiness projection —
// the client never recomputes a verdict. Not color-only: each light pairs a
// distinct icon shape with a visible label and a full text alternative
// (aria-label); legacy drafts with no persisted summary show neutral lights that
// SAY so rather than fabricating a verdict.
import type { DraftReadiness } from '../../lib/backend'
import { IconCheckCircle, IconAlertCircle, IconWarning, IconInfo } from '../ui/icons'

type Tone = 'ok' | 'warn' | 'fail' | 'none'

const TONE_ICON: Record<Tone, { Icon: typeof IconInfo; className: string }> = {
  ok:   { Icon: IconCheckCircle, className: 'text-good' },
  warn: { Icon: IconAlertCircle, className: 'text-warn' },
  fail: { Icon: IconWarning,     className: 'text-danger' },
  none: { Icon: IconInfo,        className: 'text-faint' },
}

function Light({ tone, label, aria }: { tone: Tone; label: string; aria: string }) {
  const { Icon, className } = TONE_ICON[tone]
  return (
    <span role="img" aria-label={aria} className="inline-flex items-center gap-1">
      <Icon size={12} className={className} aria-hidden="true" />
      <span className="text-[10px] text-faint">{label}</span>
    </span>
  )
}

export function ReadinessStrip({ readiness }: { readiness?: DraftReadiness | null }) {
  const r = readiness && readiness.source === 'summary' ? readiness : null

  const citations: { tone: Tone; aria: string } = !r || !r.citations
    ? { tone: 'none', aria: 'Citations: no readiness data for this draft' }
    : r.citations.unresolved === 0
      ? { tone: 'ok', aria: `Citations: ${r.citations.accepted.toLocaleString('en-US')} accepted, none unresolved` }
      : { tone: 'warn', aria: `Citations: ${r.citations.unresolved.toLocaleString('en-US')} unresolved, ${r.citations.accepted.toLocaleString('en-US')} accepted` }

  const blockers: { tone: Tone; aria: string } = !r
    ? { tone: 'none', aria: 'Blockers: no readiness data for this draft' }
    : r.blockers.length === 0
      ? { tone: 'ok', aria: 'Blockers: none' }
      : { tone: 'fail', aria: `Blockers: ${r.blockers.length.toLocaleString('en-US')} blocking issue${r.blockers.length === 1 ? '' : 's'}` }

  const validation: { tone: Tone; aria: string } = !r || !r.validation
    ? { tone: 'none', aria: 'Validation: no readiness data for this draft' }
    : { tone: r.validation === 'pass' ? 'ok' : r.validation, aria: `Validation: ${r.validation}` }

  return (
    <div role="group" aria-label="Readiness" className="flex items-center gap-2.5">
      <Light tone={citations.tone}  label="citations"  aria={citations.aria} />
      <Light tone={blockers.tone}   label="blockers"   aria={blockers.aria} />
      <Light tone={validation.tone} label="validation" aria={validation.aria} />
    </div>
  )
}
