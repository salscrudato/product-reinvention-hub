// Interstitial shown when mustChangePassword=true on the user's Firestore doc.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { IconSpinner } from '../components/ui/icons'
import { useUser } from '../context/useUser'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'

export default function MustChangePassword() {
  const { user }  = useUser()
  const navigate  = useNavigate()

  const [next,    setNext]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  if (!user) { navigate('/sign-in', { replace: true }); return null }

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
      await adapter.db.mutate({
        op: 'update', path: `users/${currentUser.uid}`,
        data: { mustChangePassword: false },
        entityType: 'user',
        actor: { uid: currentUser.uid, name: currentUser.name ?? currentUser.email ?? 'unknown' },
      })
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-[rgba(180,83,9,.1)] flex items-center justify-center text-warn font-bold text-lg" aria-hidden="true">!</div>
          <h1 className="text-xl font-bold text-text">Set a new password</h1>
          <p className="text-sm text-dim text-center">Your account requires a password change before you can continue.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-[16px] p-6 flex flex-col gap-4"
          style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}
          noValidate
        >
          <Input
            label="New password"
            type="password"
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            disabled={loading}
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat password"
            autoComplete="new-password"
            required
            disabled={loading}
          />
          {error && <p role="alert" className="text-sm text-danger bg-[rgba(220,38,38,.06)] rounded-[8px] px-3 py-2">{error}</p>}
          <Button type="submit" variant="primary" className="w-full mt-1" disabled={loading || !next || !confirm}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {loading ? 'Saving...' : 'Set password'}
          </Button>
        </form>
      </div>
    </div>
  )
}
