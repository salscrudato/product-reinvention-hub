// PresenceAvatars — shows who else is viewing this product workspace in real time.
// Calls adapter.presence.join() to heartbeat the current user's presence doc,
// and adapter.presence.watch() (polled every 15 s) to receive the current viewer list.
// Up to 3 avatars are shown inline; any excess collapses to a "+N" overflow chip.
// Colors are deterministically derived from each viewer's UID so they are stable
// across renders and across sessions.
import { useEffect, useState } from 'react'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { Tooltip } from '../ui'

// ─── Color palette ───────────────────────────────────────────────────────────
// Four distinct accent bands using design tokens so the avatars respect the theme.

interface AvatarColor { bg: string; text: string }

const PALETTE: AvatarColor[] = [
  { bg: 'var(--color-accent-soft)',  text: 'var(--color-accent)'  },
  { bg: 'var(--color-good-soft)',    text: 'var(--color-good)'    },
  { bg: 'var(--color-warn-soft)',    text: 'var(--color-warn)'    },
  { bg: 'var(--color-info-soft)',    text: 'var(--color-info)'    },
]

function hashCode(s: string): number {
  return s.split('').reduce((a, c) => ((a * 31) ^ c.charCodeAt(0)) | 0, 0)
}

function colorFor(uid: string): AvatarColor {
  return PALETTE[Math.abs(hashCode(uid)) % PALETTE.length]!
}

function initials(uid: string): string {
  return uid.replace(/[^a-z0-9]/gi, '').slice(-2).toUpperCase() || 'U'
}

// ─── Single avatar ────────────────────────────────────────────────────────────

function Avatar({ uid, label }: { uid: string; label?: string }) {
  const { bg, text } = colorFor(uid)
  return (
    <Tooltip content={label ?? uid}>
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-bold select-none ring-2"
        style={{
          background: bg,
          color: text,
          ringColor: 'var(--color-surface)',
        } as React.CSSProperties}
        aria-label={`Viewing: ${label ?? uid}`}
      >
        {initials(uid)}
      </span>
    </Tooltip>
  )
}

// ─── PresenceAvatars ─────────────────────────────────────────────────────────

interface Props { pid: string }

export function PresenceAvatars({ pid }: Props) {
  const { user } = useUser()
  const myUid = user?.uid ?? ''
  const [viewers, setViewers] = useState<string[]>([])

  // Heartbeat: maintain this user's presence document.
  useEffect(() => {
    if (!myUid) return
    const unsub = adapter.presence.join(pid)
    return unsub
  }, [pid, myUid])

  // Watch: poll for other viewers every 15 s.
  useEffect(() => {
    const unsub = adapter.presence.watch(pid, uids => {
      // Filter out the current user — we don't show a self-avatar.
      setViewers(uids.filter(uid => uid !== myUid))
    })
    return unsub
  }, [pid, myUid])

  if (viewers.length === 0) return null

  const MAX_SHOWN = 3
  const shown  = viewers.slice(0, MAX_SHOWN)
  const excess = viewers.length - MAX_SHOWN

  const label = viewers.length === 1
    ? '1 other is viewing'
    : `${viewers.length} others are viewing`

  return (
    <div className="flex items-center gap-1" aria-label={label} title={label}>
      <div className="flex items-center -space-x-1.5">
        {shown.map(uid => (
          <Avatar key={uid} uid={uid} />
        ))}
        {excess > 0 && (
          <Tooltip content={`${excess} more viewer${excess > 1 ? 's' : ''}`}>
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[9px] font-bold select-none ring-2 text-dim"
              style={{ background: 'var(--color-raised)', ringColor: 'var(--color-surface)' } as React.CSSProperties}
            >
              +{excess}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
