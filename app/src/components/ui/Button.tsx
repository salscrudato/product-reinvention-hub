// Button — four visual variants sharing the same layout rhythm.
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'default' | 'primary' | 'ghost' | 'destructive'
type Size    = 'sm' | 'md' | 'lg'

const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-[10px] border-0 cursor-pointer transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none'

const variants: Record<Variant, string> = {
  default:     'bg-raised text-text hover:bg-hover focus-visible:outline-accent',
  primary:     'text-white focus-visible:outline-accent',
  ghost:       'bg-transparent text-dim hover:bg-raised hover:text-text focus-visible:outline-accent',
  destructive: 'bg-[rgba(220,38,38,.08)] text-danger hover:bg-[rgba(220,38,38,.14)] focus-visible:outline-danger',
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

export function Button({ variant = 'default', size = 'md', className = '', style, children, ...props }: ButtonProps) {
  const isPrimary = variant === 'primary'
  return (
    <button
      {...props}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      style={isPrimary ? {
        background: 'var(--gradient-accent)',
        boxShadow: '0 1px 3px var(--glow-accent)',
        ...style,
      } : style}
    >
      {children}
    </button>
  )
}
