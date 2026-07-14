// app/src/import/unifiedImportClient.ts — client-side SSE driver for the unified import pipeline.
// Mirrors filingImportClient.ts but targets the `unifiedImport` Cloud Function and handles
// the extended event set (fingerprint, extractionPlan, formatCard, bundle events).

import { adapter } from '../lib/backend'
import type { UnifiedProposalBundle, UploadDoc } from '@pf/shared'
import type { NoticeEvent, NoticeKind } from '../lib/ai/notices'

// ─── Stage event ──────────────────────────────────────────────────────────────

export interface UnifiedStageEvent {
  kind:     'tool' | 'notice' | 'json'
  name?:    string
  phase?:   'start' | 'progress' | 'end'
  summary?: string
  message?: string
  notice?:  NoticeEvent
  /** json events: the server's `key` (e.g. brain:stage1, brain:spend, filing:bundle). */
  key?:     string
  /** json events: the server payload, verbatim. */
  value?:   unknown
  /** Client receipt time (ms epoch) — powers real elapsed tickers; never server-invented. */
  at:       number
}

// ─── File readers ─────────────────────────────────────────────────────────────

/** Convert an ArrayBuffer to a base64 string without blowing the call stack on large files. */
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Extract sheet names from an XLSX file without full parsing — reads the ZIP central directory
 *  from the first 64KB, which contains workbook.xml for small workbooks.
 *  Falls back to empty array on any error. */
async function extractSheetNames(file: File): Promise<string[]> {
  try {
    const buf = await file.slice(0, 65536).arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    const names: string[] = []
    const re = /name="([^"]{1,80})"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const n = m[1]!
      if (!n.includes('<') && !n.includes('>')) names.push(n)
    }
    return names.slice(0, 50)
  } catch {
    return []
  }
}

/** Read a collection of files into UploadDoc[] for the unified import pipeline. */
export async function readUploadFiles(files: File[]): Promise<UploadDoc[]> {
  return Promise.all(files.map(async file => {
    const buf = await file.arrayBuffer()
    const base64 = bufToBase64(buf)
    const lowerName = file.name.toLowerCase()

    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') ||
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const sheetNames = await extractSheetNames(file)
      return { name: file.name, base64, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sheetNames }
    }

    if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
      return { name: file.name, base64, mediaType: 'application/pdf' }
    }

    if (lowerName.endsWith('.zip') || file.type === 'application/zip') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 4096))
      return { name: file.name, base64, text, mediaType: 'application/zip' }
    }

    // Plain text or unknown — send both base64 and decoded text
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    return { name: file.name, base64, text, mediaType: file.type || 'text/plain' }
  }))
}

// ─── SSE driver ───────────────────────────────────────────────────────────────

export interface RunUnifiedImportOpts {
  onStage?:    (event: UnifiedStageEvent) => void
  productName?: string
  filingState?: string
  signal?:     AbortSignal
}

/** Stream the unified import pipeline and return the proposal bundle on completion. */
export async function runUnifiedImport(
  documents: UploadDoc[],
  opts: RunUnifiedImportOpts = {},
): Promise<UnifiedProposalBundle> {
  let bundle: UnifiedProposalBundle | undefined
  let streamErr = ''

  await adapter.fns.stream(
    'unifiedImport',
    { documents, productName: opts.productName, filingState: opts.filingState },
    (chunk) => {
      let ev: {
        t: string; name?: string; phase?: 'start' | 'progress' | 'end'; summary?: string;
        key?: string; value?: unknown; message?: string;
        level?: 'info' | 'warn'; kind?: NoticeKind; refs?: string[]
      }
      try { ev = JSON.parse(chunk) } catch { return }
      const at = Date.now()

      if (ev.t === 'tool') {
        opts.onStage?.({ kind: 'tool', name: ev.name, phase: ev.phase, summary: ev.summary, at })
      } else if (ev.t === 'notice') {
        opts.onStage?.({
          kind: 'notice', message: ev.message, at,
          notice: { level: ev.level ?? 'info', message: ev.message ?? '', kind: ev.kind, refs: ev.refs },
        })
      } else if (ev.t === 'json') {
        if (ev.key === 'bundle') bundle = ev.value as UnifiedProposalBundle
        // Forward every json event (brain:stage*, brain:spend, filing:*, import:spend …)
        // so the agent visualizer can render real stage payloads + run telemetry.
        opts.onStage?.({ kind: 'json', key: ev.key, value: ev.value, at })
      } else if (ev.t === 'error') {
        streamErr = ev.message ?? 'Unified import failed.'
      }
    },
    opts.signal,
  )

  if (streamErr) throw new Error(streamErr)
  if (!bundle)   throw new Error('The unified importer returned no bundle.')
  return bundle
}
