// Badge + StatusPill — semantic color chips for status, lifecycle and reviewStatus.
import type { Status, Lifecycle, ReviewStatus } from '@pf/shared'

// ─── Generic badge ────────────────────────────────────────────────────────────

type BadgeColor = 'default' | 'accent' | 'good' | 'warn' | 'danger' | 'blue' | 'purple'

const badgeColors: Record<BadgeColor, string> = {
  default: 'bg-raised text-dim',
  accent:  'text-white',
  good:    'bg-[rgba(5,150,105,.1)] text-good',
  warn:    'bg-[rgba(180,83,9,.1)] text-warn',
  danger:  'bg-[rgba(220,38,38,.1)] text-danger',
  blue:    'bg-[rgba(37,99,235,.08)] text-info',
  purple:  'bg-accent-soft text-accent',
}

interface BadgeProps {
  label: string
  color?: BadgeColor
  mono?: boolean
  className?: string
}

export function Badge({ label, color = 'default', mono = false, className = '' }: BadgeProps) {
  const isAccent = color === 'accent'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-medium leading-none
        ${badgeColors[color]} ${mono ? 'font-mono' : ''} ${className}`}
      style={isAccent ? { background: 'var(--gradient-accent)' } : undefined}
    >
      {label}
    </span>
  )
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

const statusColors: Record<Status, BadgeColor>        = { ACTIVE: 'good', INACTIVE: 'default', FUTURE: 'blue' }
const lifecycleColors: Record<Lifecycle, BadgeColor>  = { LAUNCHED: 'good', APPROVED: 'purple', IN_REVIEW: 'warn', DRAFT: 'default' }
const reviewColors: Record<ReviewStatus, BadgeColor>  = {
  APPROVED: 'good', BUSINESS_REVIEW: 'warn', IN_PROGRESS: 'blue',
  NOT_STARTED: 'default', REJECTED: 'danger',
}

export function StatusPill({ status }:        { status: Status })       { return <Badge label={status}   color={statusColors[status]}   /> }
export function LifecyclePill({ lifecycle }:  { lifecycle: Lifecycle }) { return <Badge label={lifecycle} color={lifecycleColors[lifecycle]} /> }
export function ReviewPill({ review }:        { review: ReviewStatus }) { return <Badge label={review.replace(/_/g,' ')} color={reviewColors[review]} /> }
