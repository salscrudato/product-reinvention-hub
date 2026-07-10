// NoticeBanner — the ONE honest-AI-status advisory, shared by every SSE surface
// (Home chat, Claims copilot, rule composer, scaffold, filing import). It renders the
// drift-proof canonical copy from lib/ai/notices.ts for a degrade / deny / breaker /
// unverified event. A `role="status"` polite live region announces it to screen readers
// (matching the Home chat pattern). Cache HITS are NOT shown here — they surface as a
// quiet badge beside Regenerate.
import type { ReactNode } from 'react'
import { resolveNotice, type NoticeEvent } from '../../lib/ai/notices'
import { IconWarning, IconInfo } from './icons'

interface NoticeBannerProps {
  notice:    NoticeEvent
  /** Optional recovery affordance (e.g. a Regenerate button for the deny state). */
  action?:   ReactNode
  className?: string
}

export function NoticeBanner({ notice, action, className = '' }: NoticeBannerProps) {
  const { level, title, detail } = resolveNotice(notice)
  const warn = level === 'warn'
  const Icon = warn ? IconWarning : IconInfo
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] ${className}`}
      style={{
        background: warn ? 'var(--color-warn-soft)' : 'var(--color-raised)',
        border: `1px solid ${warn ? 'var(--color-warn-line)' : 'var(--color-border)'}`,
        color: warn ? 'var(--color-warn)' : 'var(--color-dim)',
      }}
    >
      <Icon size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold leading-snug">{title}</p>
        <p className="leading-snug mt-0.5" style={{ color: warn ? 'var(--color-warn)' : 'var(--color-dim)' }}>{detail}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}
