// Skeleton — shimmer placeholder for content loading states.
interface SkeletonProps { className?: string; rounded?: string }

export function Skeleton({ className = '', rounded = 'rounded-[8px]' }: SkeletonProps) {
  return (
    <div
      className={`bg-raised animate-pulse ${rounded} ${className}`}
      aria-hidden="true"
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="bg-surface rounded-[14px] p-5 flex flex-col gap-3" style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}
