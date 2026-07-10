// filingImportClient.ts — the app-side driver for the FILING importer's SSE pipeline. Reads a
// set of uploaded filing PDFs, streams them to the `filingImport` Cloud Function, forwards the
// staged progress events to the caller, and returns the reconciled FilingImportPlan bundle
// (from the terminal `{t:'json', key:'bundle'}` event). Nothing is written here — the reviewed
// bundle is persisted separately through the adapter (see FilingImportModal → importPlan()).
import { adapter } from '../backend'
import type { FilingImportPlan } from '@pf/shared'
import type { NoticeEvent, NoticeKind } from '../ai/notices'

/** A staged progress event the modal renders as it streams. */
export interface FilingStageEvent {
  kind:    'tool' | 'notice'
  name?:   string
  phase?:  'start' | 'end'
  summary?: string
  message?: string
  /** Present for `kind:'notice'` — carries the honest-status level + kind (was dropped before). */
  notice?: NoticeEvent
}

export interface FilingImportInput { name: string; base64: string; mediaType: string }

// Chunked base64 — avoids call-stack overflow on large PDFs (mirrors BaseFormExtract).
export function fileToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

/** Read the uploaded files to base64 (PDF or text). */
export async function readFilingFiles(files: File[]): Promise<FilingImportInput[]> {
  const out: FilingImportInput[] = []
  for (const f of files) {
    const buf = await f.arrayBuffer()
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    out.push({ name: f.name, base64: fileToBase64(buf), mediaType: isPdf ? 'application/pdf' : 'text/plain' })
  }
  return out
}

/** Stream the pipeline. Resolves with the reconciled bundle, or rejects on a server error. */
export async function runFilingImport(
  documents: FilingImportInput[],
  opts: { productName?: string; filingState?: string; onStage?: (e: FilingStageEvent) => void; signal?: AbortSignal } = {},
): Promise<FilingImportPlan> {
  let bundle: FilingImportPlan | null = null
  let streamErr = ''
  await adapter.fns.stream(
    'filingImport',
    { documents, productName: opts.productName, filingState: opts.filingState },
    (chunk) => {
      let ev: { t: string; name?: string; phase?: 'start' | 'end'; summary?: string; key?: string; value?: unknown; message?: string; level?: 'info' | 'warn'; kind?: NoticeKind; refs?: string[] }
      try { ev = JSON.parse(chunk) } catch { return }
      if (ev.t === 'tool') opts.onStage?.({ kind: 'tool', name: ev.name, phase: ev.phase, summary: ev.summary })
      else if (ev.t === 'notice') opts.onStage?.({ kind: 'notice', message: ev.message, notice: { level: ev.level ?? 'info', message: ev.message ?? '', kind: ev.kind, refs: ev.refs } })
      else if (ev.t === 'json' && ev.key === 'bundle') bundle = ev.value as FilingImportPlan
      else if (ev.t === 'error') streamErr = ev.message ?? 'Filing import failed'
    },
    opts.signal,
  )
  if (streamErr) throw new Error(streamErr)
  if (!bundle) throw new Error('The importer returned no bundle.')
  return bundle
}
