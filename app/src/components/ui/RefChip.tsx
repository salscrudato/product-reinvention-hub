// RefChip — the canonical treatment for a reference id / form number (HO.COV.001,
// HO 04 90). Monospace, tabular, subtly chipped so identifiers read as precise,
// scannable tokens everywhere they appear. Optional onClick makes it a jump link.
interface RefChipProps {
  id: string
  tone?: 'default' | 'accent'
  onClick?: () => void
  title?: string
  className?: string
}

export function RefChip({ id, tone = 'default', onClick, title, className = '' }: RefChipProps) {
  const base = 'inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tracking-[-.01em] align-baseline'
  const toneCls = tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-raised text-dim'
  const interactive = onClick ? 'cursor-pointer hover:bg-accent-soft hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent' : ''
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title ?? `Open ${id}`} className={`${base} ${toneCls} ${interactive} ${className}`}>
        {id}
      </button>
    )
  }
  return <span title={title} className={`${base} ${toneCls} ${className}`}>{id}</span>
}
