// RiskReportDialog — the insured-centric risk report, full-surface (E6). Where the
// old 320px-rail accordion cramped the content, this opens the report in the shared
// Dialog primitive (focus trap, Escape, focus-restore — the wave's keyboard gate,
// already test-locked) as a brief, formatted read: a plain-language summary addressed
// to the insured, then three toned sections — what you're covered for, what to watch
// out for, questions to ask. Tone is derived from the SECTION (good/warn/accent),
// never model-assigned, so a risk can never be mislabeled reassuring. Every point
// cites its clause ([brackets] → mono chips via CitedText); each item carries an
// always-tabbable "Ask the copilot" affordance that routes the question through the
// real grounded analyzeClaim path. Reports are version-gated: a stale cached shape
// never renders — the dialog fetches fresh and the server regenerates.
import { useEffect, useState } from 'react'
import { adapter } from '../../lib/backend'
import { Dialog, RefChip } from '../ui'
import { IconShield, IconWarning, IconIdea, IconChat, IconSparkle } from '../ui/icons'
import { WaveformLoader } from '../ai/WaveformLoader'
import { CitedText } from './DeterminationCard'
import { isRenderableRiskReport, buildReportAsk, type FormRiskReport } from '../../lib/claims/riskReport'
import type { BaseForm } from './BaseFormsLibrary'

// Session-lifetime report cache — a VIEWER (whose reports never persist server-side)
// still reopens instantly within the session. Bounded (oldest-first eviction) so a
// long-lived session can never grow it without limit.
const _reports = new Map<string, FormRiskReport>()
const REPORT_CACHE_MAX = 50
function cacheReport(id: string, report: FormRiskReport) {
  if (_reports.size >= REPORT_CACHE_MAX) {
    const oldest = _reports.keys().next().value
    if (oldest !== undefined) _reports.delete(oldest)
  }
  _reports.set(id, report)
}

const SECTIONS = [
  { key: 'protections' as const, label: "What you're covered for", Icon: IconShield, tone: 'var(--color-good)', soft: 'var(--color-good-soft)' },
  { key: 'watchouts' as const, label: 'What to watch out for', Icon: IconWarning, tone: 'var(--color-warn)', soft: 'var(--color-warn-soft)' },
  { key: 'actions' as const, label: 'Questions to ask', Icon: IconIdea, tone: 'var(--color-accent)', soft: 'var(--color-accent-soft)' },
]

export function RiskReportDialog({ form, onClose, onAsk }: {
  form: BaseForm
  onClose: () => void
  /** Routes a report item into the copilot composer (Claims owns selection + ask()). */
  onAsk: (form: BaseForm, question: string) => void
}) {
  // BOTH seeds pass the version gate — the session Map by defense-in-depth (only
  // fetch results enter it today, but a stale shape must be unrenderable, period).
  const cached = _reports.get(form.id)
  const seed = isRenderableRiskReport(cached) ? cached
    : isRenderableRiskReport(form.riskReport) ? form.riskReport : null
  const [report, setReport]   = useState<FormRiskReport | null>(seed)
  const [error, setError]     = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (report) return
    let live = true
    setError(null)
    adapter.fns.call<{ formKey: string }, { report: FormRiskReport; cached: boolean }>(
      'formRiskReport', { formKey: form.id },
    ).then(out => {
      if (!live) return
      cacheReport(form.id, out.report)
      setReport(out.report)
    }).catch(e => {
      if (live) setError(e instanceof Error ? e.message : 'Report unavailable right now.')
    })
    return () => { live = false }
  }, [form.id, attempt])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open onClose={onClose} title="Risk report" width="max-w-xl">
      <div className="flex flex-col gap-4">
        {/* Which form this reads — refId chip is load-bearing, never stripped. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-text min-w-0 truncate">{form.title || form.fileName}</span>
          {form.formNumber && <RefChip id={form.formNumber} tone="accent" />}
          {form.lob && <span className="text-[10px] font-bold uppercase tracking-[.05em] text-faint rounded-[5px] px-1.5 py-0.5" style={{ border: '1px solid var(--color-border)' }}>{form.lob}</span>}
        </div>

        {!report && !error && (
          <div className="flex items-center gap-2.5 py-8 justify-center" role="status">
            <WaveformLoader size="sm" label="" className="text-accent" />
            <span className="text-[12.5px] text-dim">Reading the form…</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-[12.5px] text-danger" role="alert"
            style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => { setError(null); setAttempt(a => a + 1) }}
              className="font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
              Retry
            </button>
          </div>
        )}

        {report && (
          <div className="facet-reveal flex flex-col gap-4">
            {/* The hero read: what this policy means for YOU. */}
            <div className="flex flex-col gap-1">
              <p className="text-[14px] leading-relaxed text-text">{report.plainSummary}</p>
              <span className="inline-flex items-center gap-1 text-[10px] text-faint">
                <IconSparkle size={10} aria-hidden="true" />
                AI-composed{report.generatedAt ? ` · ${new Date(report.generatedAt).toLocaleDateString()}` : ''} · every point cites its clause
              </span>
            </div>

            {SECTIONS.map(({ key, label, Icon, tone, soft }) => {
              const items = report[key]
              if (!items.length) return null
              return (
                <section key={key} aria-label={label} className="flex flex-col gap-1.5">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.06em]" style={{ color: tone }}>
                    <span className="w-5 h-5 rounded-[7px] grid place-items-center" style={{ background: soft }}>
                      <Icon size={12} aria-hidden="true" />
                    </span>
                    {label}
                  </h3>
                  <ul className="flex flex-col">
                    {items.map((item, i) => (
                      <li key={i} className="group flex items-start gap-2 py-1.5 rounded-[8px] px-1.5 -mx-1.5 transition-colors hover:bg-raised">
                        <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tone }} aria-hidden="true" />
                        <span className="flex-1 min-w-0 text-[12.5px] text-dim leading-relaxed"><CitedText text={item} /></span>
                        <button
                          type="button"
                          onClick={() => onAsk(form, buildReportAsk(item))}
                          aria-label={`Ask the copilot about: ${item}`}
                          title="Ask the copilot what this means for you"
                          className="shrink-0 mt-0.5 p-1 rounded-[6px] text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent hover:bg-accent-soft transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                        >
                          <IconChat size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}

            <p className="text-[10.5px] text-faint pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              Grounded in the attached form — every point cites its clause. A coverage-analysis aid, not a claims decision.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
