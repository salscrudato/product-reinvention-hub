// BaseFormsLibrary — the left pane of Claims Analysis. EDITOR/ADMIN upload a
// Homeowners base coverage form (drag-drop or picker): the file goes to Storage via
// the adapter, a lightweight baseForms record is written through mutate(), and a
// server-side identify pass fills in the form's title / number / edition (a real
// PROCESSING → READY state). Every role sees the list and selects a form to start a
// conversation; VIEWER never sees the upload control. No firebase/* imports here.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { RefChip, Skeleton, EmptyState } from '../ui'
import { IconUpload, IconFile, IconSpinner, IconCheck, IconTrash, IconShield } from '../ui/icons'

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
  status:         'PROCESSING' | 'READY'
  uploadedBy:     string
  uploadedByName: string
  createdAt?:     unknown
}

// Full-name tooltip for the compact line chip.
const LINE_TITLE: Record<string, string> = { HO: 'Homeowners', PA: 'Personal Auto', GL: 'General Liability' }

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

export function BaseFormsLibrary({ forms, loading, selectedId, onSelect, canEdit, actor }: Props) {
  const [busy, setBusy]         = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (!actor) return
    if (!isSupported(file)) { toast.error('Upload a PDF or text form.'); return }
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
      try {
        const buf = await file.arrayBuffer()
        const payload = isPdf
          ? { formBase64: toBase64(buf), mediaType, fileName: file.name }
          : { formText: new TextDecoder().decode(buf), fileName: file.name }
        const meta = await adapter.fns.call<typeof payload, { title: string; formNumber: string; edition: string; lob: string }>('identifyBaseForm', payload)
        await adapter.db.mutate({
          op: 'update', path: `baseForms/${id}`,
          data: { title: meta.title || file.name, formNumber: meta.formNumber || '', edition: meta.edition || '', lob: meta.lob || '', status: 'READY' },
          entityType: 'baseForm', actor,
        })
      } catch {
        // Identify is best-effort — the form is still usable; just mark it ready.
        await adapter.db.mutate({ op: 'update', path: `baseForms/${id}`, data: { status: 'READY' }, entityType: 'baseForm', actor })
      }
    } catch (err) {
      const msg = err instanceof MutationConflictError ? 'Conflict — please refresh.'
        : err instanceof Error && /bypass/i.test(err.message) ? err.message
        : 'Upload failed'
      toast.error(msg)
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
            description={canEdit ? 'Upload a Homeowners or Personal Auto base form to start a coverage conversation.' : 'Ask an editor to upload a base form to start.'}
          />
        ) : (
          forms.map(f => {
            const on = f.id === selectedId
            return (
              <div key={f.id} className="relative group">
                <button
                  onClick={() => onSelect(f.id)}
                  aria-pressed={on}
                  className={`w-full text-left rounded-[12px] p-3 flex items-start gap-2.5 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? 'bg-accent-soft' : 'bg-surface hover:bg-hover'}`}
                  style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}`, boxShadow: on ? 'var(--shadow-card)' : 'none' }}
                >
                  <div className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${on ? 'text-accent' : 'text-faint'}`}
                    style={{ background: on ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))' : 'var(--color-raised)' }}>
                    <IconFile size={15} aria-hidden="true" />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className={`text-[13px] font-semibold leading-snug line-clamp-2 ${on ? 'text-accent' : 'text-text'}`}>{f.title}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {f.formNumber && <RefChip id={f.formNumber} tone={on ? 'accent' : 'default'} />}
                      {f.lob && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-[5px] bg-raised text-dim"
                          title={LINE_TITLE[f.lob] ?? f.lob}
                        >
                          {f.lob}
                        </span>
                      )}
                      {f.edition && <span className="text-[10px] text-faint tnum">ed. {f.edition}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-faint">
                      {f.status === 'PROCESSING' ? (
                        <span className="inline-flex items-center gap-1 text-accent"><IconSpinner size={10} className="animate-spin" aria-hidden="true" /> Reading form…</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><IconCheck size={10} className="text-good" aria-hidden="true" /> Ready</span>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{relativeTime(f.createdAt)}</span>
                    </div>
                  </div>
                </button>
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
    </div>
  )
}
