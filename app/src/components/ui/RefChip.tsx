// RefChip — the canonical treatment for a real, user-meaningful identifier: an ISO
// form number (HO 04 90, CG 00 01). Monospace, tabular, subtly chipped so form
// numbers read as precise, scannable tokens. Optional onClick makes it a jump link.
//
// Internal refIds (HO.COV.001, HO.DEF.004, GL.RU.090, HO.FORM.RU.001, RTTable.002…)
// mean nothing to a product manager, so RefChip renders NOTHING for them — they
// survive only in exports. The tell: an internal refId has dot-separated segments
// and no space; an ISO form number has spaces and no dots.
const isInternalRefId = (id: string) => id.includes('.') && !/\s/.test(id)

interface RefChipProps {
  id: string
  tone?: 'default' | 'accent'
  onClick?: () => void
  title?: string
  className?: string
}

export function RefChip({ id, tone = 'default', onClick, title, className = '' }: RefChipProps) {
  if (!id || isInternalRefId(id)) return null
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
