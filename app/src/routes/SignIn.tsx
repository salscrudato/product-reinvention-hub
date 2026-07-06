// Sign-in — email + password through the adapter. Dev builds also expose a TEMPORARY
// "Continue as admin" bypass that fakes an ADMIN session with NO backend auth (for
// testing only; see adapter.auth.signInAsDevAdmin). Premium, calm, Apple-inspired.
import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { IconSpinner, IconCoverage } from '../components/ui/icons'
import { useUser } from '../context/useUser'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Logo } from '../components/ui'

// The dev bypass is only wired into the UI for dev builds — never shipped to production.
const DEV_BYPASS = import.meta.env.DEV

export default function SignIn() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user }  = useUser()
  const from      = (location.state as { from?: string } | null)?.from ?? '/app'

  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  // Already signed in — redirect (render-time <Navigate>, not an in-render call)
  if (user) return <Navigate to={from} replace />

  async function doSignIn(e: string, p: string) {
    setError('')
    setLoading(true)
    try {
      await adapter.auth.signIn(e.trim(), p)
      navigate(from, { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setError('Invalid email or password.')
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts — try again in a moment.')
      } else {
        setError(msg)
      }
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void doSignIn(email, pass)
  }

  // TEMPORARY: pure client-side admin bypass — no Firebase auth. Because there is no
  // real token, the workspace loads without backend data (rules deny). Remove later.
  function handleDevAdmin() {
    adapter.auth.signInAsDevAdmin()
    navigate(from, { replace: true })
  }

  const busy = loading

  return (
    <div className="min-h-svh flex items-center justify-center bg-page px-4">
      {/* Aurora wash */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="aurora-a absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[380px] rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(ellipse, var(--color-accent-bright), var(--color-accent-strong))' }} />
      </div>

      <div className="relative w-full max-w-sm rise-in">
        <div className="flex flex-col items-center gap-4 mb-8">
          <Logo size={48} rounded={14} className="shadow-[0_6px_20px_rgba(139,31,224,.3)]" />
          <div className="text-center">
            <h1 className="text-xl font-bold text-text tracking-tight">Product Reinvention Hub</h1>
            <p className="text-sm text-dim mt-1">Sign in to your workspace</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-[18px] p-6 flex flex-col gap-4"
          style={{ boxShadow: 'var(--shadow-card)', border: '1px solid var(--color-border)' }}
          noValidate
        >
          <Input
            label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com" autoComplete="email" required disabled={busy}
          />
          <Input
            label="Password" type="password" value={pass} onChange={e => setPass(e.target.value)}
            placeholder="password" autoComplete="current-password" required disabled={busy}
          />

          {error && (
            <p role="alert" className="text-sm text-danger bg-[rgba(220,38,38,.06)] rounded-[8px] px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" className="w-full mt-1" disabled={busy || !email || !pass}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>

          {/* TEMPORARY dev-only admin bypass (no backend auth — testing only) */}
          {DEV_BYPASS && (
            <>
              <div className="flex items-center gap-3 my-1" aria-hidden="true">
                <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                <span className="text-[11px] uppercase tracking-wide text-faint">dev only</span>
                <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
              </div>
              <Button type="button" variant="default" className="w-full" disabled={busy} onClick={handleDevAdmin}>
                <IconCoverage size={14} aria-hidden="true" />Continue as admin
              </Button>
            </>
          )}
        </form>

        <p className="text-center text-xs text-faint mt-4">
          {DEV_BYPASS
            ? <>Admin bypass is a temporary no-auth shortcut · data loads only when signed in</>
            : <>Demo workspace · <span className="font-mono">admin@productfactory.app</span></>}
        </p>
      </div>
    </div>
  )
}
