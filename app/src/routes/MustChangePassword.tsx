// Interstitial shown when mustChangePassword=true on the user's Firestore doc.
import { useState, type FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { adapter, MutationConflictError } from '../lib/backend'
import { IconSpinner, IconEye, IconEyeOff } from '../components/ui/icons'
import { useUser } from '../context/useUser'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Logo } from '../components/ui'

export default function MustChangePassword() {
  const { user }  = useUser()
  const navigate  = useNavigate()

  const [next,        setNext]        = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [showNext,    setShowNext]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  if (!user) return <Navigate to="/" replace />

  // Capture for async closure — TypeScript cannot narrow closure vars after early return
  const currentUser = user

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next.length < 8)           { setError('Password must be at least 8 characters.'); return }
    if (next !== confirm)          { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      await adapter.auth.changePassword(next)
      // B9: load the current rev so the self-update is optimistic-concurrency-guarded like every
      // other mutate() call. The users doc is provisioned via the Admin SDK (setUserRole/seed),
      // so it may carry no rev yet — undefined then makes the guard a safe no-op.
      const profileDoc = await adapter.db.get<{ rev?: number }>(`users/${currentUser.uid}`).catch(() => null)
      await adapter.db.mutate({
        op: 'update', path: `users/${currentUser.uid}`,
        data: { mustChangePassword: false },
        entityType: 'user',
        actor: { uid: currentUser.uid, name: currentUser.name ?? currentUser.email ?? 'unknown' },
        expectedRev: profileDoc?.rev,
      })
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof MutationConflictError ? 'Someone else updated your account — please refresh and try again.'
        : err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-page px-4">
      {/* Aurora wash */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="aurora-a absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[380px] rounded-full blur-3xl opacity-15"
          style={{ background: 'radial-gradient(ellipse, var(--color-warn), var(--color-accent-strong))' }} />
      </div>

      <div className="relative w-full max-w-sm rise-in">
        <div className="flex flex-col items-center gap-4 mb-8">
          <Logo size={48} />
          <div className="text-center">
            <h1 className="text-xl font-bold text-text">Set a new password</h1>
            <p className="text-sm text-dim mt-1">Your account requires a password change before you can continue.</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-[18px] p-6 flex flex-col gap-4"
          style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}
          noValidate
        >
          <div className="relative">
            <Input
              label="New password"
              type={showNext ? 'text' : 'password'}
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              disabled={loading}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowNext(s => !s)}
              aria-label={showNext ? 'Hide password' : 'Show password'}
              tabIndex={-1}
              className="absolute right-3 bottom-2.5 text-faint hover:text-dim transition-colors"
            >
              {showNext ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>

          <div className="relative">
            <Input
              label="Confirm new password"
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
              required
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(s => !s)}
              aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'}
              tabIndex={-1}
              className="absolute right-3 bottom-2.5 text-faint hover:text-dim transition-colors"
            >
              {showConfirm ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>

          {/* Inline strength hint */}
          {next.length > 0 && next.length < 8 && (
            <p className="text-xs text-warn -mt-1">Password is too short ({next.length}/8).</p>
          )}

          {error && <p role="alert" className="text-sm text-danger bg-[rgba(220,38,38,.06)] rounded-[8px] px-3 py-2">{error}</p>}

          <Button type="submit" variant="primary" className="w-full mt-1" disabled={loading || !next || !confirm}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {loading ? 'Saving…' : 'Set password'}
          </Button>
        </form>
      </div>
    </div>
  )
}
