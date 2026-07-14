// Button — four visual variants sharing the same layout rhythm, plus a soft
// pointer-following wave: onMouseMove feeds --wx/--wy so a radial sheen glides
// under the cursor (see .btn-wave-follow in index.css; reduced-motion softens
// it to a static hover tint). Primary buttons wave in white-on-gradient; the
// rest wave in accent-soft.
import { useCallback, type ButtonHTMLAttributes, type MouseEvent } from 'react'

type Variant = 'default' | 'primary' | 'ghost' | 'destructive'
type Size    = 'sm' | 'md' | 'lg'

const base = 'btn-wave-follow inline-flex items-center justify-center gap-2 font-medium rounded-[10px] border-0 cursor-pointer transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none'

const variants: Record<Variant, string> = {
  default:     'bg-raised text-text hover:bg-hover focus-visible:outline-accent',
  primary:     'text-white focus-visible:outline-accent',
  ghost:       'bg-transparent text-dim hover:bg-raised hover:text-text focus-visible:outline-accent',
  destructive: 'bg-[var(--color-danger-hover)] text-danger hover:bg-[var(--color-danger-press)] focus-visible:outline-danger',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm h-8',
  md: 'px-4 py-2 text-sm h-9',
  lg: 'px-5 py-2.5 text-base h-11',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'default', size = 'md', className = '', style, children, onMouseMove, ...props }: ButtonProps) {
  const isPrimary = variant === 'primary'

  // Track the pointer inside the button — drives the CSS wave (no re-render).
  const handleMove = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--wx', `${e.clientX - r.left}px`)
    el.style.setProperty('--wy', `${e.clientY - r.top}px`)
    onMouseMove?.(e)
  }, [onMouseMove])

  return (
    <button
      {...props}
      onMouseMove={handleMove}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      style={{
        // Wave hue per variant: white sheen on the filled gradient, accent-soft elsewhere.
        ['--color-btn-wave' as string]: isPrimary ? 'var(--color-btn-wave-on-fill)' : 'var(--color-accent-soft)',
        ...(isPrimary ? { background: 'var(--gradient-accent)', boxShadow: '0 1px 3px var(--glow-accent)' } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  )
}
