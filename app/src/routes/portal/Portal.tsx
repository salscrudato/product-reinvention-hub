// Portal — the POLICYHOLDER-facing route (/portal). Mobile-first, standalone (no AppShell).
//
// A policyholder signs in with the same auth seam as everyone else, but the server
// grants their JWT only portal:read / portal:upload — every staff surface (catalog
// reads, AI, mutations, admin) rejects them server-side. This page:
//   1. one-time PDF upload of their policy (client pre-checks type/size for fast
//      feedback; the SERVER independently enforces PDF magic bytes + 15 MB + one-per-account),
//   2. shows the grounded, judge-approved coverage summary (HTML is sanitized
//      client-side in sanitizeHtml.ts before render — never trusted, even from our API).
// All reads/writes go through the adapter seam; no platform SDK, no direct fetch.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adapter } from '../../lib/backend'
import type { PortalPolicy, PortalSummary } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { sanitizePortalHtml } from './sanitizeHtml'
import { Button, Skeleton } from '../../components/ui'
import { IconUpload, IconSpinner, IconCheck, IconShield, IconWarning, IconFile } from '../../components/ui/icons'

const MAX_PDF_MB = 15

// Portal styles — token-driven (var(--color-*)) so the summary inherits light/dark themes.
// Scoped under .ph-summary; the generated HTML may only use these class names (the server
// prompt + both sanitizers enforce that).
const PORTAL_CSS = `
.ph-summary { display: flex; flex-direction: column; gap: 12px; }
.ph-summary section.ph-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; padding: 16px; }
.ph-summary .ph-hero { background: var(--color-accent-soft); border-color: var(--color-accent-line); }
.ph-summary h2 { font-size: 18px; font-weight: 700; color: var(--color-text); margin-bottom: 6px; }
.ph-summary h3 { font-size: 14px; font-weight: 650; color: var(--color-text); margin-bottom: 8px; }
.ph-summary h4 { font-size: 12px; font-weight: 600; color: var(--color-text); margin: 10px 0 4px; }
.ph-summary p, .ph-summary li { font-size: 13px; line-height: 1.55; color: var(--color-text); }
.ph-summary .ph-muted { color: var(--color-dim, var(--color-text)); opacity: .75; font-size: 12px; }
.ph-summary ul, .ph-summary ol { padding-left: 18px; display: flex; flex-direction: column; gap: 6px; margin: 6px 0; }
.ph-summary table.ph-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ph-summary table.ph-table th { text-align: left; font-weight: 600; color: var(--color-dim, var(--color-text)); padding: 6px 8px; border-bottom: 1px solid var(--color-border); }
.ph-summary table.ph-table td { padding: 7px 8px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
.ph-summary details { border: 1px solid var(--color-border); border-radius: 10px; padding: 8px 12px; }
.ph-summary details + details { margin-top: 6px; }
.ph-summary summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--color-text); }
.ph-summary details[open] summary { margin-bottom: 6px; }
.ph-summary .ph-refid, .ph-summary .ph-form { display: inline-block; font-family: ui-monospace, monospace; font-size: 10.5px; padding: 1px 6px; border-radius: 6px; background: var(--color-accent-soft); color: var(--color-accent); border: 1px solid var(--color-accent-line); white-space: nowrap; }
.ph-summary .ph-form { background: var(--color-raised); color: var(--color-dim, var(--color-text)); border-color: var(--color-border); }
.ph-summary .ph-risk li { padding-left: 2px; }
.ph-summary .ph-upsell li { border: 1px dashed var(--color-border-strong, var(--color-border)); border-radius: 10px; padding: 8px 10px; list-style: none; }
.ph-summary .ph-upsell { padding-left: 0; }
`

function friendlyError(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message : ''
  // Server error details are honest and human-readable; generic transport codes are not.
  return m && !/failed: \d+/.test(m) && m !== 'unauthenticated' ? m : fallback
}

// ─── Login (email OTP via the shared auth seam) ───────────────────────────────
function PortalLogin() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestCode() {
    setBusy(true); setError(null)
    try { await adapter.auth.requestOtp(email.trim()); setStage('code') }
    catch (err) { setError(friendlyError(err, 'Could not send a sign-in code. Check the email address.')) }
    finally { setBusy(false) }
  }
  async function verify() {
    setBusy(true); setError(null)
    try { await adapter.auth.verifyOtp(email.trim(), code.trim()) }
    catch (err) { setError(friendlyError(err, 'That code did not work — request a new one.')) }
    finally { setBusy(false) }
  }

  return (
    <div className="w-full max-w-sm mx-auto rounded-[16px] p-5 flex flex-col gap-3"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <h2 className="text-[16px] font-bold text-text">Sign in to your policy portal</h2>
      <p className="text-[12px] text-dim">Use the email address your insurance company has on file.</p>
      {stage === 'email' ? (
        <>
          <label className="text-[12px] font-medium text-text" htmlFor="ph-email">Email</label>
          <input id="ph-email" type="email" inputMode="email" autoComplete="email" value={email}
            onChange={e => setEmail(e.target.value)}
            className="rounded-[10px] px-3 py-2.5 text-[14px] text-text bg-page focus-visible:outline-2 focus-visible:outline-accent"
            style={{ border: '1px solid var(--color-border-strong)' }} placeholder="you@example.com" />
          <Button variant="primary" size="md" disabled={busy || !email.includes('@')} onClick={() => void requestCode()}>
            {busy ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : null} Send code
          </Button>
        </>
      ) : (
        <>
          <label className="text-[12px] font-medium text-text" htmlFor="ph-code">6-digit code sent to {email}</label>
          <input id="ph-code" inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={e => setCode(e.target.value)}
            className="rounded-[10px] px-3 py-2.5 text-[16px] tracking-[0.3em] text-text bg-page focus-visible:outline-2 focus-visible:outline-accent"
            style={{ border: '1px solid var(--color-border-strong)' }} placeholder="••••••" />
          <Button variant="primary" size="md" disabled={busy || code.trim().length < 6} onClick={() => void verify()}>
            {busy ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : null} Sign in
          </Button>
          <button className="text-[12px] text-accent hover:underline self-start" onClick={() => { setStage('email'); setCode('') }}>
            Use a different email
          </button>
        </>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  )
}

// ─── Upload card (one-time) ───────────────────────────────────────────────────
function UploadCard({ onUploaded }: { onUploaded: (p: PortalPolicy) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    // Client pre-checks give instant feedback; the server re-enforces both independently.
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (!isPdf) { setError('Only PDF policy documents are accepted.'); return }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_PDF_MB} MB.`)
      return
    }
    setBusy(true)
    try {
      const { policy } = await adapter.portal.upload(file)
      onUploaded(policy)
    } catch (err) {
      setError(friendlyError(err, 'The upload did not go through. Please try again.'))
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-[16px] p-5 flex flex-col items-center gap-3 text-center"
      style={{ background: 'var(--color-surface)', border: '1.5px dashed var(--color-border-strong)' }}>
      <div className="w-11 h-11 rounded-[12px] flex items-center justify-center" style={{ background: 'var(--color-accent-soft)' }}>
        {busy ? <IconSpinner size={18} className="animate-spin text-accent" aria-hidden="true" /> : <IconUpload size={18} className="text-accent" aria-hidden="true" />}
      </div>
      <h2 className="text-[15px] font-bold text-text">Add your policy document</h2>
      <p className="text-[12.5px] text-dim leading-snug">
        {busy
          ? 'Uploading and reading your policy… this can take a minute.'
          : `Upload the PDF of your insurance policy (up to ${MAX_PDF_MB} MB). We read it once, securely, to build your personal coverage summary.`}
      </p>
      {!busy && (
        <label className="inline-flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-semibold cursor-pointer focus-within:outline-2 focus-within:outline-accent"
          style={{ background: 'var(--color-accent)', color: 'var(--color-accent-contrast, var(--color-surface))' }}>
          <IconFile size={14} aria-hidden="true" /> Choose PDF
          <input type="file" accept=".pdf,application/pdf" className="sr-only" disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        </label>
      )}
      <p className="text-[10.5px] text-faint inline-flex items-center gap-1">
        <IconShield size={11} aria-hidden="true" /> One-time upload · visible only to you and your insurer
      </p>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  )
}

// ─── Summary view ─────────────────────────────────────────────────────────────
function SummaryView({ policy, summary }: { policy: PortalPolicy; summary: PortalSummary }) {
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap pb-3">
        {policy.policyNumber && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-[7px] bg-raised text-dim">Policy {policy.policyNumber}</span>
        )}
        {policy.lob && <span className="text-[11px] font-medium px-2 py-1 rounded-[7px] bg-raised text-dim">{policy.lob}</span>}
        {summary.source === 'fallback' ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-[7px]"
            style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)' }}
            title="This summary was assembled directly from your policy record and your carrier's catalog, without AI-generated text.">
            <IconWarning size={10} aria-hidden="true" /> Standard summary
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-[7px]"
            style={{ background: 'var(--color-good-soft, var(--color-accent-soft))', color: 'var(--color-good)' }}
            title="Checked against your policy and your carrier's catalog by an independent review pass before display.">
            <IconCheck size={10} aria-hidden="true" /> Reviewed
          </span>
        )}
      </div>
      {/* Server-generated, judge-approved HTML — sanitized AGAIN on this side before render. */}
      <div className="ph-summary" dangerouslySetInnerHTML={{ __html: sanitizePortalHtml(summary.html) }} />
      <p className="text-[10.5px] text-faint pt-3">
        Generated {new Date(summary.generatedAt).toLocaleDateString()} from your uploaded policy and your insurer's official product catalog.
        Coverage options shown are limited to what your insurer actually offers — talk to your agent to make changes.
      </p>
    </div>
  )
}

// ─── Signed-in home ───────────────────────────────────────────────────────────
function PortalHome() {
  const [policy, setPolicy] = useState<PortalPolicy | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    adapter.portal.me()
      .then(({ policy }) => { if (alive) { setPolicy(policy); setLoaded(true) } })
      .catch((err) => { if (alive) { setError(friendlyError(err, 'Could not load your portal. Pull to refresh.')); setLoaded(true) } })
    return () => { alive = false }
  }, [])

  async function generate() {
    setGenerating(true); setError(null)
    try {
      const { summary } = await adapter.portal.generateSummary()
      setPolicy((p: PortalPolicy | null) => (p ? { ...p, summary } : p))
    } catch (err) {
      setError(friendlyError(err, 'Your summary could not be created just now. Please try again shortly.'))
    } finally { setGenerating(false) }
  }

  if (!loaded) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" rounded="rounded-[16px]" />
        <Skeleton className="h-40 w-full" rounded="rounded-[16px]" />
      </div>
    )
  }
  if (!policy) {
    return (
      <>
        <UploadCard onUploaded={(p) => setPolicy(p)} />
        {error && <p role="alert" className="text-[12px] text-danger pt-3">{error}</p>}
      </>
    )
  }
  if (!policy.summary) {
    return (
      <div className="rounded-[16px] p-5 flex flex-col items-center gap-3 text-center"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="w-11 h-11 rounded-[12px] flex items-center justify-center" style={{ background: 'var(--color-accent-soft)' }}>
          {generating ? <IconSpinner size={18} className="animate-spin text-accent" aria-hidden="true" /> : <IconCheck size={18} className="text-good" aria-hidden="true" />}
        </div>
        <h2 className="text-[15px] font-bold text-text">{policy.fileName || 'Your policy'} is on file</h2>
        <p className="text-[12.5px] text-dim leading-snug">
          {generating
            ? 'Building your personal coverage summary — reading your coverages, checking risks in your area, and reviewing everything for accuracy. This can take a couple of minutes.'
            : `We read ${policy.coverages.length} coverage${policy.coverages.length === 1 ? '' : 's'} from your document. Create your plain-language summary — including risks in your area and options your insurer offers.`}
        </p>
        {!generating && (
          <Button variant="primary" size="md" onClick={() => void generate()} aria-busy={generating}>
            Create my coverage summary
          </Button>
        )}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    )
  }
  return <SummaryView policy={policy} summary={policy.summary} />
}

// ─── Route component ──────────────────────────────────────────────────────────
export default function Portal() {
  const { user, loading } = useUser()

  return (
    <div className="min-h-svh bg-page">
      <style>{PORTAL_CSS}</style>
      <header className="px-4 pt-5 pb-4 max-w-lg mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-[9px] flex items-center justify-center" style={{ background: 'var(--color-accent-soft)' }}>
            <IconShield size={15} className="text-accent" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-text leading-tight">My coverage</h1>
            <p className="text-[10.5px] text-faint leading-tight">Policyholder portal</p>
          </div>
        </div>
        {user && (
          <button onClick={() => void adapter.auth.signOut()} className="text-[12px] text-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent rounded px-1">
            Sign out
          </button>
        )}
      </header>
      <main className="px-4 pb-16 max-w-lg mx-auto">
        {loading ? (
          <Skeleton className="h-40 w-full" rounded="rounded-[16px]" />
        ) : !user ? (
          <PortalLogin />
        ) : user.role !== 'POLICYHOLDER' ? (
          <div className="rounded-[16px] p-5 flex flex-col gap-2 text-center"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-[13px] text-text font-medium">This portal is for policyholders.</p>
            <p className="text-[12px] text-dim">You're signed in with a staff account ({user.role}).</p>
            <Link to="/app" className="text-[13px] text-accent font-medium hover:underline">Go to the product hub →</Link>
          </div>
        ) : (
          <PortalHome />
        )}
      </main>
    </div>
  )
}
