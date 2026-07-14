// BaseFormsLibrary — the left pane of Claims Analysis. EDITOR/ADMIN upload a
// Homeowners base coverage form (drag-drop or picker): the file goes to Storage via
// the adapter, a lightweight baseForms record is written through mutate(), and a
// server-side identify pass fills in the form's title / number / edition (a real
// PROCESSING → READY state). Every role sees the list and selects a form to start a
// conversation; VIEWER never sees the upload control. No firebase/* imports here.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { resolveClaimsLineProfile, normalizeFormNumber } from '@pf/shared'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { statusAfterIdentify, isUnverified, type BaseFormStatus } from '../../lib/claims/baseForm'
import { RefChip, Skeleton, EmptyState, Dialog, Button } from '../ui'
import { IconUpload, IconFile, IconSpinner, IconCheck, IconTrash, IconShield, IconWarning, IconSparkle, IconChevronRight } from '../ui/icons'
import { WaveformLoader } from '../ai/WaveformLoader'
import { CitedText } from './DeterminationCard'

/** Sectioned, grounded risk report generated from the uploaded form itself. */
export interface FormRiskReport {
  overview:       string
  riskHighlights: string[]
  watchFor:       string[]
  insurerLens:    string[]
  generatedAt?:   string
}

export interface BaseForm {
  id:             string
  title:          string
  formNumber:     string
  edition:        string
  lob?:           string   // detected line: 'HO' | 'PA' | 'GL' | '' — labels the card + grounds analysis
  fileName:       string
  storagePath:    string
  url:            string
  mediaType:      string
  status:         BaseFormStatus   // PROCESSING | READY | NEEDS_REVIEW (unidentified — held from analysis)
  // The server read a form number the forms catalogue could not confirm. The form is still
  // READY + analyzable (the attached document is the authority); the UI flags it "Unverified".
  verified?:      boolean
  riskReport?:    FormRiskReport   // cached server-side by /api/ai/formRiskReport
  uploadedBy:     string
  uploadedByName: string
  createdAt?:     unknown
}

// Full-name tooltip for the compact line chip — derived from the shared claims line-profile
// registry (never a hard-coded list), so a recognised line shows its full name and any other
// code shows verbatim. Adding a line profile automatically labels its forms here.
function lineTitle(code: string): string {
  const p = resolveClaimsLineProfile(code)
  return p.code === 'GENERIC' ? code : p.displayName
}

interface Props {
  forms:      BaseForm[]
  loading:    boolean
  selectedId: string | null
  onSelect:   (id: string) => void
  canEdit:    boolean
  actor:      { uid: string; name: string } | null
}

// Chunked base64 — avoids call-stack overflow on large PDFs (mirrors BaseFormExtract).
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

function relativeTime(v: unknown): string {
  const o = v as { toDate?: () => Date; seconds?: number } | null
  const ms = o?.toDate ? o.toDate().getTime() : typeof o?.seconds === 'number' ? o.seconds * 1000 : null
  if (ms == null) return 'just now'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

const ACCEPT = '.pdf,.txt,.md,text/plain,application/pdf'
function isSupported(f: File): boolean {
  return f.type === 'application/pdf' || f.type === 'text/plain' || /\.(pdf|txt|md)$/i.test(f.name)
}

// ─── Risk report accordion — collapsed by default, one per READY form ───────────
// Sits directly under the form's name block. First expand fetches the sectioned,
// grounded report (cached server-side on the doc thereafter); every point cites
// the form's own clause in [brackets] (rendered as mono chips via CitedText).

const REPORT_SECTIONS: { key: keyof Pick<FormRiskReport, 'riskHighlights' | 'watchFor' | 'insurerLens'>; label: string }[] = [
  { key: 'riskHighlights', label: 'Risk overview' },
  { key: 'watchFor',       label: 'What to look for' },
  { key: 'insurerLens',    label: "The insurer's lens" },
]

function RiskReportAccordion({ form }: { form: BaseForm }) {
  const [open, setOpen]       = useState(false)
  const [report, setReport]   = useState<FormRiskReport | null>(form.riskReport ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || report || loading) return
    setLoading(true); setError(null)
    try {
      const out = await adapter.fns.call<{ formKey: string }, { report: FormRiskReport; cached: boolean }>(
        'formRiskReport', { formKey: form.id },
      )
      setReport(out.report)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report unavailable right now.')
      setOpen(false)
    } finally { setLoading(false) }
  }

  return (
    <div className="mt-1.5 rounded-[10px] overflow-hidden transition-colors"
      style={{ border: `1px solid ${open ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent-soft"
        style={{ background: open ? 'var(--color-accent-soft)' : 'var(--color-raised)' }}
      >
        <IconSparkle size={12} className="text-accent shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-text flex-1">Risk report</span>
        {loading
          ? <WaveformLoader size="xs" label="" className="text-accent" />
          : <IconChevronRight size={12} aria-hidden="true"
              className="shrink-0 text-faint transition-transform duration-200"
              style={{ transform: open ? 'rotate(90deg)' : 'none' }} />}
      </button>
      {error && <p className="px-2.5 py-1.5 text-[10.5px] text-danger" role="alert">{error}</p>}
      {open && report && (
        <div className="facet-reveal flex flex-col gap-3 px-2.5 py-2.5 bg-surface" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-[11.5px] text-dim leading-relaxed">{report.overview}</p>
          {REPORT_SECTIONS.map(({ key, label }) => {
            const items = report[key] ?? []
            if (items.length === 0) return null
            return (
              <div key={key} className="flex flex-col gap-1">
                <h4 className="text-[9.5px] font-semibold uppercase tracking-[.08em] text-accent">{label}</h4>
                <ul className="flex flex-col gap-1">
                  {items.map((p, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] text-dim leading-relaxed">
                      <span className="mt-[6px] w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--color-accent)' }} aria-hidden="true" />
                      <span className="min-w-0"><CitedText text={p} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <p className="text-[9.5px] text-faint">Grounded in the attached form — every point cites its clause. Not a claims decision.</p>
        </div>
      )}
    </div>
  )
}

export function BaseFormsLibrary({ forms, loading, selectedId, onSelect, canEdit, actor }: Props) {
  const [busy, setBusy]         = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // Duplicate-upload guard: set when a freshly-identified, verified form matches an existing
  // form's number + edition. The PM chooses "Use existing" (discard the upload, select the
  // existing) or "Upload anyway" (keep the new copy).
  const [dup, setDup] = useState<{ newId: string; existing: BaseForm } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (!actor) return
    if (!isSupported(file)) { toast.error('Upload a PDF or text form.'); return }
    // Fast client pre-check (the server independently enforces a 15 MB decoded cap): a
    // larger file previously died in the transport layer as an opaque "Upload failed".
    if (file.size > 15 * 1024 * 1024) {
      toast.error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the upload limit is 15 MB.`)
      return
    }
    setBusy(true)
    const id = `bf-${Date.now()}`
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const mediaType = isPdf ? 'application/pdf' : 'text/plain'
    try {
      // 1) File → Storage (own baseforms prefix; rules require EDITOR/ADMIN).
      const storagePath = `baseforms/${actor.uid}/${id}/${file.name}`
      const url = await adapter.storage.upload(storagePath, file)

      // 2) Lightweight record via mutate() — shows immediately as "Processing".
      await adapter.db.mutate({
        op: 'create', path: `baseForms/${id}`,
        data: {
          title: file.name, formNumber: '', edition: '', fileName: file.name,
          storagePath, url, mediaType, status: 'PROCESSING',
          uploadedBy: actor.uid, uploadedByName: actor.name,
        },
        entityType: 'baseForm', actor,
      })
      onSelect(id)
      toast.success('Base form uploaded')

      // 3) Server-side identify (grounded header read) → enrich + mark READY.
      // IMPORTANT: adapter.db.mutate() op:'update' is a FULL replace (server does Upsert,
      // not a partial patch). Every field that must survive must be re-sent here — including
      // storagePath, url, mediaType, fileName, uploadedBy, uploadedByName from step 1.
      const baseFields = {
        fileName: file.name, storagePath, url, mediaType,
        uploadedBy: actor.uid, uploadedByName: actor.name,
      }
      try {
        const buf = await file.arrayBuffer()
        const payload = isPdf
          ? { formBase64: toBase64(buf), mediaType, fileName: file.name }
          : { formText: new TextDecoder().decode(buf), fileName: file.name }
        const meta = await adapter.fns.call<typeof payload, { title: string; formNumber: string; edition: string; lob: string; verified?: boolean }>('identifyBaseForm', payload)
        // Honest identification: only a form we could actually identify (a printed form number
        // OR a recognised line) becomes READY; neither → NEEDS_REVIEW. verified:false means the
        // server read a formNumber the forms catalogue couldn't confirm — the form is still READY
        // (the attached document is the authority) but carries verified:false for the "Unverified"
        // chip, so analysis is never silently disabled by a catalogue miss.
        await adapter.db.mutate({
          op: 'update', path: `baseForms/${id}`,
          data: {
            ...baseFields,
            title: meta.title || file.name, formNumber: meta.formNumber || '',
            edition: meta.edition || '', lob: meta.lob || '',
            status: statusAfterIdentify(meta),
            ...(meta.verified === false ? { verified: false } : {}),
          },
          entityType: 'baseForm', actor,
        })

        // Duplicate-upload guard: a verified, printed form number that already exists in the
        // library (same number + edition) offers Use existing / Upload anyway. Skip when the
        // number is unverified (nothing reliable to dedupe on).
        const num = normalizeFormNumber(meta.formNumber || '')
        if (meta.verified !== false && num) {
          const existing = forms.find(f =>
            f.id !== id &&
            normalizeFormNumber(f.formNumber || '') === num &&
            (f.edition || '').trim() === (meta.edition || '').trim())
          if (existing) setDup({ newId: id, existing })
        }
      } catch {
        // Identify failed entirely — we know neither the form number nor the line. Hold it for
        // review rather than marking it READY: an unidentified form must not be analyzable.
        // Re-send all base fields so storagePath/url survive the full-replace Upsert.
        await adapter.db.mutate({
          op: 'update', path: `baseForms/${id}`,
          data: { ...baseFields, title: file.name, formNumber: '', edition: '', lob: '', status: 'NEEDS_REVIEW' as const },
          entityType: 'baseForm', actor,
        })
      }
    } catch (err) {
      if (err instanceof MutationConflictError) {
        conflictToast({})
      } else {
        // The adapter now surfaces the server's honest error detail (size limit, type
        // rejection, storage outage) — show it when we have one; the generic transport
        // form ("… failed: NNN") stays behind the plain "Upload failed" toast.
        const msg = err instanceof Error ? err.message : ''
        toast.error(msg && !/failed: \d+/.test(msg) && msg !== 'unauthenticated' ? msg : 'Upload failed')
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(form: BaseForm) {
    if (!actor) return
    try {
      await adapter.db.mutate({ op: 'delete', path: `baseForms/${form.id}`, entityType: 'baseForm', actor })
      if (selectedId === form.id) onSelect('')
      toast.success('Base form removed')
    } catch { toast.error('Could not remove the form') }
  }

  // Duplicate guard — "Use existing": discard the just-uploaded copy and select the one already
  // in the library. "Upload anyway" simply keeps the new copy (dismiss the prompt).
  async function switchToExisting() {
    if (!dup || !actor) return
    const { newId, existing } = dup
    setDup(null)
    try {
      await adapter.db.mutate({ op: 'delete', path: `baseForms/${newId}`, entityType: 'baseForm', actor })
      onSelect(existing.id)
      toast.success('Using the form already in your library')
    } catch { toast.error('Could not switch to the existing form') }
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between gap-2 pb-3">
        <h2 className="text-sm font-semibold text-text">Base forms</h2>
        {forms.length > 0 && <span className="text-[11px] text-faint tnum">{forms.length}</span>}
      </div>

      {/* Upload affordance — EDITOR/ADMIN only */}
      {canEdit && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f) }}
          className="rounded-[12px] p-4 mb-3 flex flex-col items-center gap-2 text-center transition-colors"
          style={{ border: `1.5px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border-strong)'}`, background: dragOver ? 'var(--color-accent-soft)' : 'transparent' }}
        >
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: 'var(--color-accent-soft)' }}>
            {busy ? <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" /> : <IconUpload size={16} className="text-accent" aria-hidden="true" />}
          </div>
          <p className="text-[12px] text-dim leading-snug">
            {busy ? 'Uploading & reading form…' : <>Drop a base coverage form here<br />or</>}
          </p>
          {!busy && (
            <button
              onClick={() => inputRef.current?.click()}
              className="text-[12px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
            >
              Upload base form
            </button>
          )}
          <input
            ref={inputRef} type="file" accept={ACCEPT} className="hidden" disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }}
          />
          <p className="text-[10px] text-faint">PDF or text</p>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1 flex flex-col gap-2">
        {loading ? (
          <>
            <Skeleton className="h-[68px] w-full" rounded="rounded-[12px]" />
            <Skeleton className="h-[68px] w-full" rounded="rounded-[12px]" />
            <Skeleton className="h-[68px] w-full" rounded="rounded-[12px]" />
          </>
        ) : forms.length === 0 ? (
          <EmptyState
            compact
            icon={<IconFile size={26} />}
            title="No base forms yet"
            description={canEdit ? 'Upload any P&C base coverage form — Homeowners, General Liability, Personal Auto or another line — to start a coverage conversation.' : 'Ask an editor to upload a base coverage form to start.'}
          />
        ) : (
          forms.map(f => {
            const on = f.id === selectedId
            return (
              <div key={f.id}
                className={`relative group rounded-[12px] transition-all ${on ? 'bg-accent-soft' : 'bg-surface hover:bg-hover'}`}
                style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}`, boxShadow: on ? 'var(--shadow-card)' : 'none' }}
              >
                {/* Name block — the select target */}
                <button
                  onClick={() => onSelect(f.id)}
                  aria-pressed={on}
                  className="w-full text-left rounded-t-[12px] p-3 pb-1.5 flex items-start gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {/* Document emblem — gradient when selected; a shield-check seal once READY */}
                  <div className={`relative w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 transition-all ${on ? 'text-white' : 'text-faint group-hover:text-accent'}`}
                    style={{
                      background: on ? 'var(--gradient-accent)' : 'var(--color-raised)',
                      boxShadow: on ? '0 1px 4px var(--glow-accent)' : 'none',
                    }}>
                    <IconFile size={15} aria-hidden="true" />
                    {f.status === 'READY' && !isUnverified(f) && (
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full grid place-items-center"
                        style={{ background: 'var(--color-good)', border: '1.5px solid var(--color-surface)' }}
                        title="Identified & verified" aria-hidden="true">
                        <IconCheck size={8} className="text-white" />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className={`text-[13px] font-semibold leading-snug line-clamp-2 ${on ? 'text-accent' : 'text-text'}`}>{f.title}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {f.formNumber && <RefChip id={f.formNumber} tone={on ? 'accent' : 'default'} />}
                      {f.lob && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-[5px] bg-raised text-dim"
                          title={lineTitle(f.lob)}
                        >
                          {f.lob}
                        </span>
                      )}
                      {f.edition && <span className="text-[10px] text-faint tnum">ed. {f.edition}</span>}
                      {f.status === 'READY' && isUnverified(f) && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-[5px]"
                          style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)' }}
                          title="This form number couldn’t be matched to the catalogue. Analysis still runs against the attached document, which is the authority."
                        >
                          <IconWarning size={9} aria-hidden="true" /> Unverified
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Risk report — collapsed accordion, below the name block, above the status row */}
                {f.status === 'READY' && (
                  <div className="px-3">
                    <RiskReportAccordion form={f} />
                  </div>
                )}

                {/* Status row */}
                <div className="flex items-center gap-1.5 text-[10px] text-faint px-3 pt-1.5 pb-2.5">
                  {f.status === 'PROCESSING' ? (
                    <span className="inline-flex items-center gap-1 text-accent"><IconSpinner size={10} className="animate-spin" aria-hidden="true" /> Reading form…</span>
                  ) : f.status === 'NEEDS_REVIEW' ? (
                    <span className="inline-flex items-center gap-1 text-warn"><IconWarning size={10} aria-hidden="true" /> Needs review</span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><IconCheck size={10} className="text-good" aria-hidden="true" /> Ready</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{relativeTime(f.createdAt)}</span>
                </div>

                {canEdit && (
                  <button
                    onClick={() => void remove(f)}
                    title="Remove form" aria-label={`Remove ${f.title}`}
                    className="absolute top-2 right-2 p-1 rounded-[6px] text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-hover hover:text-danger transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  >
                    <IconTrash size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Role note for VIEWER — honest about why there's no upload control */}
      {!canEdit && !loading && (
        <p className="flex items-center gap-1.5 text-[11px] text-faint pt-3 mt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <IconShield size={12} aria-hidden="true" /> Viewer — analysis only. Editors upload forms.
        </p>
      )}

      {/* Duplicate-upload guard */}
      {dup && (
        <Dialog open onClose={() => setDup(null)} title="This form is already in your library" width="max-w-md">
          <p className="text-sm text-dim -mt-1">
            <span className="font-medium text-text">{dup.existing.title}</span>
            {dup.existing.formNumber ? <> (<span className="font-mono text-[12px]">{dup.existing.formNumber}</span>{dup.existing.edition ? ` ed. ${dup.existing.edition}` : ''})</> : null}
            {' '}is already here. Use the existing form, or upload this copy anyway?
          </p>
          <div className="flex items-center justify-end gap-2 mt-6">
            <Button variant="ghost" size="sm" onClick={() => setDup(null)}>Upload anyway</Button>
            <Button variant="primary" size="sm" onClick={() => void switchToExisting()}>
              <IconCheck size={14} aria-hidden="true" />Use existing
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
