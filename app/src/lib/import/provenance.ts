// provenance.ts — P3 import provenance stamps, computed CLIENT-side at the only
// moments the truth exists in the browser:
//   • contentHash — sha256 of the raw uploaded bytes, hashed at file intake while
//     the File objects are still in scope (they do not survive into modal state).
//     Feeds dedup-at-the-door (GET /api/db/drafts/dedup) and is persisted on the
//     draft at import-apply so future imports of the same artifact are caught.
//   • runId — minted before the upload and sent to /api/ai/unifiedImport, which
//     echoes it and persists the full bundle blob under it (run-results.js). Stamped
//     on the draft as importRunId so the extraction report can recover the bundle.
//   • readiness — a bounded ReadinessSummary derived from the bundle's stage-5/6/7
//     outputs at apply time. This is a SUMMARY of server-produced evidence, never a
//     client judgement: blockers are the brain's BLOCKING unresolved items verbatim,
//     and the server re-derives the promote verdict from this persisted summary.
import type { ReadinessSummary, UnifiedProposalBundle } from '@pf/shared'

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

/** Canonical artifact hash for an upload batch: one file → sha256 of its bytes;
 *  several → sha256 of the SORTED per-file digests (order-independent, so the same
 *  set of files always hashes identically). Format `sha256:<hex>` — matches the
 *  server's CONTENT_HASH_RE and is the format /drafts/dedup queries against. */
export async function hashUploadBytes(buffers: ArrayBuffer[]): Promise<string> {
  const digests = await Promise.all(buffers.map((b) => sha256Hex(b)))
  if (digests.length === 1) return `sha256:${digests[0]}`
  return `sha256:${await sha256Hex(new TextEncoder().encode(digests.sort().join('|')))}`
}

export async function hashFiles(files: File[]): Promise<string> {
  return hashUploadBytes(await Promise.all(files.map((f) => f.arrayBuffer())))
}

/** Client-minted unified-import run id. Charset/length must satisfy the server's
 *  sanitizeRunId ([A-Za-z0-9._-], 8–64 chars) or the server silently drops it. */
export function mintRunId(): string {
  return `run-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

// Runtime bundle fields the shared FilingImportPlan type does not (yet) declare —
// the server brain stamps severity/label on unresolved items and attaches
// importWarnings/completeness at stage 6/7. Read them loosely, never trust shapes.
interface LooseUnresolved { severity?: unknown; label?: unknown; name?: unknown; refId?: unknown; reason?: unknown }
interface LooseBundle { importWarnings?: unknown; completeness?: { assessment?: unknown } }

const MAX_BLOCKERS = 20
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Bounded readiness summary from a server-pipeline bundle (stage-5/6/7 outputs). */
export function readinessFromBundle(bundle: UnifiedProposalBundle): ReadinessSummary {
  const unresolved: LooseUnresolved[] = Array.isArray(bundle.unresolved) ? bundle.unresolved : []
  const blocking = unresolved.filter((u) => u.severity === 'BLOCKING')
  const blockers = blocking.slice(0, MAX_BLOCKERS).map((u) => {
    const what = str(u.label) ?? str(u.name) ?? str(u.refId) ?? 'Unresolved item'
    const why = str(u.reason)
    return why ? `${what}: ${why}` : what
  })
  if (blocking.length > MAX_BLOCKERS) blockers.push(`…and ${blocking.length - MAX_BLOCKERS} more blocking items`)
  const loose = bundle as unknown as LooseBundle
  const importWarnings = Array.isArray(loose.importWarnings) ? loose.importWarnings.length : 0
  const completeness = str(loose.completeness?.assessment)
  const counts = bundle.counts && typeof bundle.counts === 'object'
    ? {
        proposed: Number(bundle.counts.proposed) || 0,
        accepted: Number(bundle.counts.accepted) || 0,
        unresolved: Number(bundle.counts.unresolved) || 0,
      }
    : null
  return {
    v: 1,
    counts,
    blockers,
    validation: blocking.length > 0 ? 'fail' : unresolved.length > 0 || importWarnings > 0 ? 'warn' : 'pass',
    importWarnings,
    completeness,
  }
}

