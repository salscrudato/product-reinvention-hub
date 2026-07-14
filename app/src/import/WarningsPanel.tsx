// WarningsPanel — the import review's first-class warnings surface. Takes the
// brain's structured importWarnings (kind/sheet/row/field/detail) — or legacy
// flattened "[kind] sheet field: detail" strings — groups them by kind,
// severity-tints each group, translates every kind into plain human language
// with a suggested action where the brain's semantics imply one, and renders as
// an expandable panel. Built to make the 81-warnings case feel organized:
// scannable in under ten seconds, grouped counts first, detail one click away.
import { useMemo, useState } from 'react'
import { IconWarning, IconInfo, IconChevronRight } from '../components/ui/icons'
import { VirtualList } from './VirtualList'

export interface ImportWarning {
  kind: string
  sheet?: string | null
  row?: number | null
  field?: string | null
  detail: string
}

type Severity = 'danger' | 'warn' | 'info'

// Human framing per warning kind: what it means, how serious, what to do.
const KIND_META: Record<string, { label: string; severity: Severity; action?: string }> = {
  'duplicate-refId':          { label: 'Duplicate reference ids', severity: 'danger', action: 'Decide which row is authoritative before importing — duplicates overwrite each other.' },
  'dangling-form-reference':  { label: 'Forms referenced but not uploaded', severity: 'warn', action: 'Upload the forms workbook too, or attach these forms in the product after import.' },
  'orphan-promoted':          { label: 'Sub-coverages without their parent', severity: 'warn', action: 'They were kept as top-level coverages — re-parent them after import if needed.' },
  'exclusion-as-coverage':    { label: 'Possible exclusions classified as coverages', severity: 'warn', action: 'Review each one — an exclusion belongs in forms/rules, not the coverage tree.' },
  'incomplete-product':       { label: 'Product looks incomplete', severity: 'warn' },
  'not-in-deterministic-map': { label: 'Extracted beyond the template parse', severity: 'info', action: 'These rows came from the AI extraction only — check their citations.' },
  'product-synthesized':      { label: 'Product identity was synthesized', severity: 'info', action: 'Verify the product name and line before importing.' },
  'dynamic-fields-surfaced':  { label: 'Dynamic fields surfaced', severity: 'info' },
  'empty-source':             { label: 'Empty source regions', severity: 'info' },
  'unmapped-column':          { label: 'Unmapped columns', severity: 'info', action: 'Try AI Assist to propose column mappings.' },
}

const SEV_TOKEN: Record<Severity, { fg: string; soft: string; line: string }> = {
  danger: { fg: 'var(--color-danger)', soft: 'var(--color-danger-soft)', line: 'var(--color-danger-line)' },
  warn:   { fg: 'var(--color-warn)',   soft: 'var(--color-warn-soft)',   line: 'var(--color-warn-line)' },
  info:   { fg: 'var(--color-info)',   soft: 'var(--color-info-soft, var(--color-accent-soft))', line: 'var(--color-border)' },
}

const SEV_ORDER: Severity[] = ['danger', 'warn', 'info']

/** Parse a legacy flattened warning "[kind] sheet field: detail" back to structure. */
export function parseFlatWarning(s: string): ImportWarning {
  const m = /^\[([^\]]+)\]\s*([^:]*):\s*([\s\S]*)$/.exec(s)
  if (!m) return { kind: 'general', detail: s }
  const head = (m[2] ?? '').trim()
  return { kind: m[1]!.trim(), field: head || null, detail: m[3]!.trim() }
}

function metaFor(kind: string) {
  return KIND_META[kind] ?? { label: kind.replace(/-/g, ' '), severity: 'info' as Severity }
}

/** Pull the refId-looking token out of a warning's detail, if the brain included one. */
const REFID_RE = /"([A-Z]{2,4}(?:\.[A-Z0-9]{2,8}){1,4})"|\b([A-Z]{2,4}(?:\.[A-Z0-9]{2,8}){2,4})\b/
function refIdOf(w: ImportWarning): string | null {
  const m = REFID_RE.exec(w.detail)
  return m ? (m[1] ?? m[2] ?? null) : null
}

export function WarningsPanel({ warnings, defaultOpen = false }: {
  warnings: readonly (ImportWarning | string)[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [openKinds, setOpenKinds] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const structured = warnings.map(w => typeof w === 'string' ? parseFlatWarning(w) : w)
    const byKind = new Map<string, ImportWarning[]>()
    for (const w of structured) {
      const list = byKind.get(w.kind) ?? []
      list.push(w)
      byKind.set(w.kind, list)
    }
    return [...byKind.entries()]
      .map(([kind, items]) => ({ kind, items, meta: metaFor(kind) }))
      .sort((a, b) => SEV_ORDER.indexOf(a.meta.severity) - SEV_ORDER.indexOf(b.meta.severity) || b.items.length - a.items.length)
  }, [warnings])

  if (warnings.length === 0) return null
  const worst = groups[0]!.meta.severity
  const tone = SEV_TOKEN[worst]

  return (
    <div className="rounded-[12px] overflow-hidden" style={{ border: `1px solid ${tone.line}` }}>
      {/* Header — the count is the headline; one click expands the organized view. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:opacity-90"
        style={{ background: tone.soft }}
      >
        <IconWarning size={15} style={{ color: tone.fg }} aria-hidden="true" />
        <span className="text-[13px] font-semibold" style={{ color: tone.fg }}>
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        </span>
        <span className="text-[11px] text-dim truncate flex-1">
          {groups.map(g => `${g.items.length} ${g.meta.label.toLowerCase()}`).slice(0, 3).join(' · ')}
          {groups.length > 3 ? ' · …' : ''}
        </span>
        <IconChevronRight size={14} aria-hidden="true"
          className="shrink-0 text-faint transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
      </button>

      {open && (
        <div className="flex flex-col gap-2 p-2.5 bg-surface">
          {groups.map(({ kind, items, meta }) => {
            const t = SEV_TOKEN[meta.severity]
            const kindOpen = openKinds.has(kind)
            return (
              <div key={kind} className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  onClick={() => setOpenKinds(prev => { const n = new Set(prev); if (n.has(kind)) n.delete(kind); else n.add(kind); return n })}
                  aria-expanded={kindOpen}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left bg-raised transition-colors hover:bg-hover"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.fg }} aria-hidden="true" />
                  <span className="text-[12px] font-semibold text-text">{meta.label}</span>
                  <span className="text-[11px] text-faint tabular-nums">· {items.length}</span>
                  {meta.action && !kindOpen && (
                    <span className="text-[10.5px] text-faint truncate flex-1 text-right">{meta.action}</span>
                  )}
                  <IconChevronRight size={12} aria-hidden="true"
                    className="shrink-0 text-faint transition-transform duration-200"
                    style={{ transform: kindOpen ? 'rotate(90deg)' : 'none' }} />
                </button>
                {kindOpen && (
                  <div className="flex flex-col">
                    {meta.action && (
                      <div className="flex items-start gap-2 px-3 py-2 text-[11.5px] text-dim" style={{ borderTop: '1px solid var(--color-border)', background: t.soft }}>
                        <IconInfo size={12} className="shrink-0 mt-0.5" style={{ color: t.fg }} aria-hidden="true" />
                        {meta.action}
                      </div>
                    )}
                    <VirtualList
                      items={items}
                      rowHeight={44}
                      maxHeight={220}
                      renderRow={(w) => {
                        const rid = refIdOf(w)
                        return (
                          <div className="flex items-start gap-2 px-3 py-1.5 h-full" style={{ borderTop: '1px solid var(--color-border)' }}>
                            {rid && (
                              <span className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] text-dim bg-raised"
                                style={{ border: '1px solid var(--color-border)' }}>
                                {rid}
                              </span>
                            )}
                            <span className="text-[11.5px] text-dim leading-snug line-clamp-2 min-w-0">
                              {(w.sheet || w.field) && (
                                <span className="font-medium text-text">{[w.sheet, w.field].filter(Boolean).join(' · ')}: </span>
                              )}
                              {w.detail}
                            </span>
                          </div>
                        )
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
