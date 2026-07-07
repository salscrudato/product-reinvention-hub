// Sign-in — email + password through the adapter, plus a no-credentials "Continue as
// admin" button that performs a REAL sign-in as the seeded demo admin (real token +
// ADMIN claim → full access and persistence). Premium, calm, Apple-inspired.
import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { IconSpinner, IconEye, IconEyeOff } from '../components/ui/icons'
import { useUser } from '../context/useUser'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Logo } from '../components/ui'

export default function SignIn() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user }  = useUser()
  const from      = (location.state as { from?: string } | null)?.from ?? '/app'

  const [email,       setEmail]       = useState('')
  const [pass,        setPass]        = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

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
        setError('Invalid username or password.')
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

  const busy = loading

  return (
    <div className="min-h-svh flex items-center justify-center bg-page px-4">
      {/* Aurora wash */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="aurora-a absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[380px] rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(ellipse, var(--color-accent-bright), var(--color-accent-strong))' }} />
        <div className="aurora-b absolute -bottom-20 right-1/4 w-[400px] h-[260px] rounded-full blur-3xl opacity-10"
          style={{ background: 'radial-gradient(ellipse, var(--color-accent), transparent)' }} />
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
            label="Username" type="text" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="sal" autoComplete="username" required disabled={busy}
            autoFocus
          />

          {/* Password with show/hide toggle */}
          <div className="relative">
            <Input
              label="Password"
              type={showPass ? 'text' : 'password'}
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => setShowPass(s => !s)}
              aria-label={showPass ? 'Hide password' : 'Show password'}
              aria-pressed={showPass}
              className="absolute right-3 bottom-2.5 text-faint hover:text-dim transition-colors rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {showPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger bg-[rgba(220,38,38,.06)] rounded-[8px] px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" className="w-full mt-1" disabled={busy || !email || !pass}>
            {loading && <IconSpinner size={14} className="animate-spin" aria-hidden="true" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="text-center text-xs text-faint mt-4">
          Sign in with your username and password.
        </p>
      </div>
    </div>
  )
}
