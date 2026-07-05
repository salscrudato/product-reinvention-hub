// BaseFormExtract — the base-form gate + grounded coverage extraction (§8B/§10.1).
// An EDITOR uploads a base coverage form; until one exists the "Extract coverages"
// action is disabled with a hint. Once present, extraction reads the form via a
// Cloud Function + Claude and proposes the product's coverages (prefilled and
// pre-checked); the user reviews / deselects before anything is written. Each
// confirmed coverage is created through mutate() (entity + audit + version +
// searchIndex), allocating the next HO.COV.NNN refId. VIEWER sees nothing.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { Dialog, Button, Tooltip, RefChip, Badge } from '../ui'
import { IconUpload, IconFile, IconSparkle, IconTrash, IconSpinner } from '../ui/icons'
import type { Coverage, Product, Requirement } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface ProposedCoverage {
  name:              string
  requirement:       Requirement
  premiumGenerating: boolean
  formNumbers?:      string[]
  limitHint?:        string
  confidence:        number
  citation:          string
}

interface Props {
  product:   WithId<Product>
  coverages: WithId<Coverage>[]
  canEdit:   boolean
  actor:     { uid: string; name: string }
}

type Busy = 'upload' | 'extract' | 'add' | null

// Chunked base64 — avoids call-stack overflow on large PDFs.
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

function confidenceColor(c: number): string {
  return c >= 0.8 ? 'var(--color-good)' : c >= 0.5 ? 'var(--color-warn)' : 'var(--color-faint)'
}

export function BaseFormExtract({ product, coverages, canEdit, actor }: Props) {
  const [busy, setBusy] = useState<Busy>(null)
  const [proposed, setProposed] = useState<ProposedCoverage[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [reviewOpen, setReviewOpen] = useState(false)
  const baseForm = product.baseForm ?? null

  if (!canEdit) return null

  async function upload(file: File) {
    setBusy('upload')
    try {
      const path = `uploads/${actor.uid}/baseforms/${product.id}/${Date.now()}-${file.name}`
      const url = await adapter.storage.upload(path, file)
      await adapter.db.mutate({
        op: 'update', path: `products/${product.id}`,
        data: { baseForm: { path, url, name: file.name, uploadedAt: new Date().toISOString(), uploadedBy: actor.uid } },
        entityType: 'product', actor,
      })
      toast.success('Base form uploaded')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — please refresh.' : 'Upload failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('upload')
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${product.id}`, data: { baseForm: null },
        entityType: 'product', actor,
      })
      toast.success('Base form removed')
    } catch { toast.error('Could not remove the base form') }
    finally { setBusy(null) }
  }

  async function extract() {
    if (!baseForm) return
    setBusy('extract')
    try {
      const resp = await fetch(baseForm.url)
      if (!resp.ok) throw new Error('Could not read the uploaded form')
      const blob = await resp.blob()
      const isPdf = blob.type === 'application/pdf' || baseForm.name.toLowerCase().endsWith('.pdf')
      const payload = isPdf
        ? { formBase64: toBase64(await blob.arrayBuffer()), mediaType: 'application/pdf', productName: product.name }
        : { formText: await blob.text(), productName: product.name }

      // `raw`/`streamErr` are written inside the stream callback, so keep them
      // `unknown`/loosely typed to avoid TS narrowing them to their initializers.
      let raw: unknown = null
      let streamErr = ''
      await adapter.fns.stream('extractCoverages', payload, chunk => {
        let ev: { t: string; key?: string; value?: unknown; message?: string }
        try { ev = JSON.parse(chunk) } catch { return }
        if (ev.t === 'json' && ev.key === 'proposal') raw = ev.value
        if (ev.t === 'error') streamErr = ev.message ?? 'Extraction failed'
      })
      if (streamErr) throw new Error(streamErr)

      const list = ((raw as { coverages?: ProposedCoverage[] } | null)?.coverages ?? []).filter(c => Boolean(c?.name))
      if (!list.length) { toast.error('No coverages found in the form.'); return }
      setProposed(list)
      setChecked(new Set(list.map((_, i) => i)))
      setReviewOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setBusy(null)
    }
  }

  async function addSelected() {
    const chosen = proposed.filter((_, i) => checked.has(i))
    if (!chosen.length) return
    setBusy('add')
    const nums = coverages.map(c => c.refId).filter(Boolean)
      .map(r => { const m = /^HO\.COV\.(\d+)$/.exec(r!); return m ? Number(m[1]) : 0 })
    let next = Math.max(0, ...nums)
    const maxOrder = Math.max(0, ...coverages.map(c => c.order ?? 0))
    try {
      let i = 0
      for (const p of chosen) {
        next += 1; i += 1
        await adapter.db.mutate({
          op: 'create', path: `products/${product.id}/coverages/cov-${Date.now()}-${i}`,
          data: {
            refId: `HO.COV.${String(next).padStart(3, '0')}`,
            name: p.name, parentId: null, order: maxOrder + i,
            requirement: p.requirement, claimsBasis: '', premiumGenerating: p.premiumGenerating,
            source: p.formNumbers?.length ? 'BUREAU' : 'PROPRIETARY',
            formNumbers: p.formNumbers ?? [], terms: [],
            allStates: false, states: [],
            status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
            updatedBy: actor.uid, rev: 1,
          },
          entityType: 'coverage', productId: product.id, actor,
        })
      }
      toast.success(`Added ${chosen.length} coverage${chosen.length === 1 ? '' : 's'}`)
      setReviewOpen(false)
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — please refresh.' : 'Could not add coverages')
    } finally {
      setBusy(null)
    }
  }

  const toggle = (i: number) => setChecked(prev => {
    const n = new Set(prev)
    if (n.has(i)) n.delete(i); else n.add(i)
    return n
  })

  return (
    <>
      <div className="flex items-center gap-2">
        {baseForm ? (
          <span className="inline-flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-[9px] bg-raised text-sm text-dim max-w-[220px]"
            style={{ border: '1px solid var(--color-border)' }}>
            <IconFile size={14} className="text-accent shrink-0" aria-hidden="true" />
            <span className="truncate" title={baseForm.name}>{baseForm.name}</span>
            <label className="shrink-0 rounded-[6px] p-1 hover:bg-hover hover:text-text transition-colors cursor-pointer" title="Replace form" aria-label="Replace base form">
              <IconUpload size={13} aria-hidden="true" />
              <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" className="hidden"
                disabled={busy !== null}
                onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            </label>
            <button onClick={remove} disabled={busy !== null} title="Remove form" aria-label="Remove base form"
              className="shrink-0 rounded-[6px] p-1 hover:bg-hover hover:text-danger transition-colors">
              <IconTrash size={13} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <label className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[9px] text-sm font-medium transition-colors cursor-pointer ${busy === 'upload' ? 'opacity-60' : 'text-dim hover:text-text bg-raised hover:bg-hover'}`}
            style={{ border: '1px solid var(--color-border)' }}>
            {busy === 'upload' ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconUpload size={14} aria-hidden="true" />}
            Upload base form
            <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" className="hidden"
              disabled={busy !== null}
              onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          </label>
        )}

        <Tooltip content={baseForm ? '' : 'Upload a base coverage form to enable AI extraction'} side="bottom">
          <Button variant="primary" size="sm" disabled={!baseForm || busy !== null} onClick={() => void extract()}>
            {busy === 'extract' ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconSparkle size={14} aria-hidden="true" />}
            {busy === 'extract' ? 'Reading form…' : 'Extract coverages'}
          </Button>
        </Tooltip>
      </div>

      <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} title="Review extracted coverages" width="max-w-2xl">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Found <span className="font-medium text-text">{proposed.length}</span> coverage{proposed.length === 1 ? '' : 's'} in{' '}
            <span className="font-mono text-dim">{baseForm?.name}</span>. Deselect anything wrong, then add — nothing is written until you confirm.
          </p>

          <div className="flex flex-col gap-2 max-h-[52vh] overflow-y-auto -mx-1 px-1">
            {proposed.map((p, i) => {
              const on = checked.has(i)
              return (
                <label key={i}
                  className={`flex items-start gap-3 rounded-[12px] p-3 cursor-pointer transition-colors ${on ? 'bg-accent-soft' : 'bg-raised hover:bg-hover'}`}
                  style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(i)}
                    className="mt-1 w-4 h-4 accent-[var(--color-accent)] shrink-0" aria-label={`Include ${p.name}`} />
                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[14px] text-text truncate">{p.name}</span>
                      <span className="text-[11px] font-mono tnum shrink-0" style={{ color: confidenceColor(p.confidence) }}
                        title="Extraction confidence">
                        {Math.round(p.confidence * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge label={p.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={p.requirement === 'MANDATORY' ? 'purple' : 'default'} />
                      {p.premiumGenerating && <Badge label="Rated" color="good" />}
                      {p.formNumbers?.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
                    </div>
                    <p className="text-xs text-faint truncate">
                      {p.citation}{p.limitHint ? ` · ${p.limitHint}` : ''}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-faint">{checked.size} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReviewOpen(false)} disabled={busy === 'add'}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => void addSelected()} disabled={busy === 'add' || checked.size === 0}>
                {busy === 'add' && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
                Add selected{checked.size ? ` (${checked.size})` : ''}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  )
}
