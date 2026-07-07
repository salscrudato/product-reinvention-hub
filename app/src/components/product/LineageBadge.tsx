// LineageBadge — shows a draft's provenance (what it cloned / imported / leveraged).
// Two shapes: a compact `chip` for cards + the workspace header, and a `full` block
// (summary + cited source chips) for the promote dialog and the overview banner.
// refId / form-number sources render as RefChips so they stay recognisably load-bearing.
import type { Lineage, LineageKind } from '@pf/shared'
import { RefChip } from '../ui'
import { IconFileSpreadsheet, IconCopy, IconSparkle, IconPlus, type IconType } from '../ui/icons'

const META: Record<LineageKind, { label: string; Icon: IconType; tint: string }> = {
  IMPORT:      { label: 'Imported',      Icon: IconFileSpreadsheet, tint: 'var(--color-info)' },
  CLONE:       { label: 'Cloned',        Icon: IconCopy,            tint: 'var(--color-accent)' },
  AI_SCAFFOLD: { label: 'AI-scaffolded', Icon: IconSparkle,         tint: 'var(--color-accent)' },
  BLANK:       { label: 'From scratch',  Icon: IconPlus,            tint: 'var(--color-faint)' },
}

export function LineageBadge({ lineage, variant = 'chip' }: { lineage: Lineage; variant?: 'chip' | 'full' }) {
  const meta = META[lineage.kind] ?? META.BLANK
  const { Icon } = meta

  if (variant === 'chip') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2 py-0.5 text-[11px] font-medium"
        style={{ background: `color-mix(in srgb, ${meta.tint} 12%, transparent)`, color: meta.tint }}
        title={lineage.summary}
      >
        <Icon size={12} aria-hidden="true" />
        {meta.label}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-[12px] p-3 bg-raised" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-[7px] shrink-0"
          style={{ background: `color-mix(in srgb, ${meta.tint} 14%, transparent)`, color: meta.tint }}>
          <Icon size={13} aria-hidden="true" />
        </span>
        <span className="text-[13px] font-medium text-text">{meta.label}</span>
        <span className="text-xs text-faint truncate">{lineage.summary}</span>
      </div>
      {lineage.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-8">
          <span className="text-[11px] text-faint">Leveraged:</span>
          {lineage.sources.map((s, i) =>
            s.type === 'product' || s.type === 'coverage' || s.type === 'form'
              ? <RefChip key={`${s.ref}-${i}`} id={s.ref} tone="accent" title={s.name} />
              : <span key={`${s.ref}-${i}`} className="px-1.5 py-0.5 rounded bg-surface text-[11px] text-dim" style={{ border: '1px solid var(--color-border)' }} title={s.name}>{s.ref}</span>,
          )}
        </div>
      )}
    </div>
  )
}
