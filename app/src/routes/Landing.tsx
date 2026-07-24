// Public landing — the showpiece AND the sign-in entry point. A two-column hero:
// on the left, the headline, promise and a glass sign-in card wrapped in an
// electric-blue outline and a soft backdrop glow; on the right, a bespoke "orbit
// console" — the insurance product manager at the exact center of a knowledge-
// saturated system. The platform's capabilities (an AI assistant, live market news,
// intelligent tasks and the product's coverages) ride a slowly-turning orbit, each
// streaming knowledge inward to the PM, while a radar sweep, breathing rings and a
// drifting particle field keep the whole thing alive. Pure CSS + inline SVG, zero
// images, pixel-perfect geometry, honours prefers-reduced-motion.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { adapter } from '../lib/backend'
import type { TenantInfo } from '../lib/backend'
import { useUser } from '../context/useUser'
import { reportWebVitals } from '../lib/perf/reportWebVitals'
import { Logo } from '../components/ui'
import { IconArrowRight, IconLayers, IconSparkle, IconTasks, IconSpinner, IconEye, IconEyeOff, IconChevronDown } from '../components/ui/icons'

// A glyph accepts size / className / strokeWidth - matches the in-house icon shape.
type Glyph = (p: { size?: number; className?: string; strokeWidth?: number }) => React.ReactElement

// Provenance mark (footer). Encoded so the tree carries no plaintext; decoded only
// at render. Credit-only (RISK-013): no functional behavior attaches to it.
const _P1 = 'RGVzaWduZWQgYnkgU2FsIGluIEhhY2tlbnNhY2s='
const _P2 = 'UmV2aWV3ZWQgYnkgU2FssywgdGFrZW4gY2FyZSBvZiBieSBMaXNh'

// ─── Aurora background ────────────────────────────────────────────────────────

function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="aurora-a absolute w-[720px] h-[520px] rounded-full opacity-25 -top-48 -left-40"
        style={{ background: 'var(--gradient-aurora-a)' }} />
      <div className="aurora-b absolute w-[620px] h-[460px] rounded-full opacity-20 top-1/4 -right-32"
        style={{ background: 'var(--gradient-aurora-b)' }} />
      <div className="aurora-c absolute w-[520px] h-[420px] rounded-full opacity-[.16] bottom-0 left-1/4"
        style={{ background: 'var(--gradient-aurora-c)' }} />
    </div>
  )
}

// ─── Pointer tilt (elevation) ────────────────────────────────────────────────
// A whisper of 3D: the console leans a few degrees toward the pointer, eased by a
// per-frame lerp so motion is butter-smooth (no transition fighting, no jank).
// Fine-pointer devices only; reduced-motion users get a static graph (the CSS guard
// also zeroes the transform, so this is belt AND braces).

function useTilt(maxDeg = 4) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    let raf = 0
    let targetX = 0, targetY = 0, curX = 0, curY = 0
    const tick = () => {
      curX += (targetX - curX) * 0.12
      curY += (targetY - curY) * 0.12
      el.style.setProperty('--tilt-x', `${curX.toFixed(3)}deg`)
      el.style.setProperty('--tilt-y', `${curY.toFixed(3)}deg`)
      raf = Math.abs(targetX - curX) + Math.abs(targetY - curY) > 0.005 ? requestAnimationFrame(tick) : 0
    }
    const start = () => { if (!raf) raf = requestAnimationFrame(tick) }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const nx = (e.clientX - r.left) / r.width - 0.5
      const ny = (e.clientY - r.top) / r.height - 0.5
      targetY = nx * maxDeg * 2
      targetX = -ny * maxDeg * 2
      el.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(1)}px`)
      el.style.setProperty('--my', `${(e.clientY - r.top).toFixed(1)}px`)
      start()
    }
    const onLeave = () => { targetX = 0; targetY = 0; start() }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [maxDeg])
  return ref
}

// ─── Orbit-console geometry ───────────────────────────────────────────────────

interface Vec { x: number; y: number }
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y)
const unit = (a: Vec, b: Vec): Vec => { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d } }
const rad = (deg: number) => (deg * Math.PI) / 180
const P = (v: Vec) => `${v.x.toFixed(2)} ${v.y.toFixed(2)}`

// The product manager sits at the exact center of the console.
const C   = { x: 240, y: 240 }
const RPM = 44            // medallion radius
const RN  = 24            // capability-node radius
const R_ORBIT = 158       // capability orbit radius
const R_MID = 116         // inner decorative orbit
const R_HORIZON = 196     // field horizon radius

const at = (deg: number, r: number): Vec => ({ x: C.x + r * Math.cos(rad(deg)), y: C.y + r * Math.sin(rad(deg)) })

type GlyphId = 'ai' | 'news' | 'task' | 'cov'
interface Capability { id: GlyphId; label: string; deg: number; x: number; y: number }

// Four capabilities, evenly spaced around the orbit (90° apart), AI at the zenith.
const CAPS: Capability[] = ([
  { id: 'ai',   label: 'AI Assistant', deg: -90 },
  { id: 'news', label: 'Market News',  deg: 0 },
  { id: 'task', label: 'Tasks',        deg: 90 },
  { id: 'cov',  label: 'Coverages',    deg: 180 },
] as const).map((c) => ({ ...c, ...at(c.deg, R_ORBIT) }))

// Spokes: every capability streams inward to the PM along a gently-curved path.
// All curves share the same chirality, so the console reads as a soft vortex
// converging on the center.
interface Spoke { d: string; len: number; drawDelay: number; flowDelay: number }

const SPOKES: Spoke[] = CAPS.map((n, i) => {
  const u = unit(n, C)
  const S = { x: n.x + u.x * RN,  y: n.y + u.y * RN }               // leaves the node toward the PM
  const E = { x: C.x - u.x * (RPM + 4), y: C.y - u.y * (RPM + 4) }  // arrives at the medallion edge
  const mid = { x: (S.x + E.x) / 2, y: (S.y + E.y) / 2 }
  const perp = { x: -u.y, y: u.x }
  const ctrl = { x: mid.x + perp.x * 20, y: mid.y + perp.y * 20 }
  return {
    d: `M ${P(S)} Q ${P(ctrl)} ${P(E)}`,
    len: dist(S, E) * 1.1,
    drawDelay: 200 + i * 90,
    flowDelay: 600 + i * 150,
  }
})

// Ambient knowledge field: motes seeded on a golden-angle spiral (deterministic —
// every visit renders the same constellation). Sparse and faint: presence, not
// spectacle.
const FIELD_MOTES = Array.from({ length: 9 }, (_, i) => {
  const angle = i * 137.508
  const r = 60 + (R_HORIZON - 74) * Math.sqrt((i + 0.5) / 9)
  return {
    ...at(angle, r),
    r: 0.9 + ((i * 7) % 3) * 0.35,
    dur: 9 + (i % 5) * 1.6,
    delay: -(i * 1.3),
    dx: ((i * 13) % 7) - 3,
    dy: ((i * 29) % 9) - 4,
    lo: 0.06 + ((i * 3) % 4) * 0.03,
    hi: 0.22 + ((i * 5) % 4) * 0.05,
  }
})

// Radar sweep wedge — a soft, fading beam rotating about the center with a faint
// leading edge. A narrow 52° sector, radius just inside the horizon, so it reads as
// an ambient light sweep rather than a hard triangle.
const SWEEP_R = 186
const SWEEP_LEAD = at(0, SWEEP_R)
const SWEEP_TAIL = at(-52, SWEEP_R)
const SWEEP_D = `M ${P(C)} L ${P(SWEEP_LEAD)} A ${SWEEP_R} ${SWEEP_R} 0 0 0 ${P(SWEEP_TAIL)} Z`

// ─── Capability glyphs (hand-drawn, pixel-perfect, no icon fonts) ─────────────

function CapGlyph({ id }: { id: GlyphId }) {
  const s = { stroke: 'var(--color-accent)', strokeWidth: 1.7, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    // AI Assistant — a four-point spark with a small twinkle in its concavity.
    case 'ai': return (
      <g>
        <path d="M0 -10 C1.5 -3.3 3.3 -1.5 10 0 C3.3 1.5 1.5 3.3 0 10 C-1.5 3.3 -3.3 1.5 -10 0 C-3.3 -1.5 -1.5 -3.3 0 -10 Z" fill="var(--color-accent)" />
        <circle cx={7.4} cy={-7.4} r={1.5} fill="var(--color-accent-bright)" />
      </g>
    )
    // Market News — a rising trend line with data points and a lift arrow.
    case 'news': return (
      <g {...s}>
        <path d="M-9 5.5 L-2.8 -1 L1.8 3 L8.2 -6.4" />
        <path d="M8.2 -6.4 L4.1 -6.4 M8.2 -6.4 L8.2 -2.3" />
        <circle cx={-2.8} cy={-1} r={1.4} fill="var(--color-accent)" stroke="none" />
        <circle cx={1.8} cy={3} r={1.4} fill="var(--color-accent)" stroke="none" />
      </g>
    )
    // Tasks — a rounded checkbox, ticked.
    case 'task': return (
      <g {...s}>
        <rect x={-9} y={-9} width={18} height={18} rx={5} />
        <path d="M-4.2 0 L-1.1 3.3 L4.6 -4" />
      </g>
    )
    // Coverages — a shield with a verified check (protection, covered).
    case 'cov': return (
      <g {...s}>
        <path d="M0 -10 L8.2 -6.4 L8.2 0.8 C8.2 6 4.6 8.8 0 10 C-4.6 8.8 -8.2 6 -8.2 0.8 L-8.2 -6.4 Z" />
        <path d="M-3.5 0 L-1 2.6 L3.9 -3.3" strokeWidth={1.5} />
      </g>
    )
  }
}

// ─── The orbit console ────────────────────────────────────────────────────────

function OrbitConsole() {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 150); return () => clearTimeout(t) }, [])

  return (
    <svg
      viewBox="0 0 480 480" width="100%" height="100%" fill="none"
      className="graph-float max-w-[520px]"
      shapeRendering="geometricPrecision" textRendering="optimizeLegibility"
      role="img"
      aria-label="An insurance product manager at the center of an orbital console. The platform's capabilities — an AI assistant, live market news, intelligent tasks and the product's coverages — sit on a slowly turning orbit around them, each streaming knowledge inward to the product manager."
    >
      <defs>
        <radialGradient id="oc-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity=".32" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="oc-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity=".22" />
          <stop offset="70%" stopColor="var(--color-accent)" stopOpacity=".05" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="oc-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent-bright)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </linearGradient>
        <linearGradient id="oc-medallion" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-bright)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </linearGradient>
        {/* Sweep tail — bright at the leading edge, dissolving toward the trailing side */}
        <linearGradient id="oc-sweep" x1={SWEEP_LEAD.x} y1={SWEEP_LEAD.y} x2={SWEEP_TAIL.x} y2={SWEEP_TAIL.y} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity=".15" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Core aura behind the whole console */}
      <circle cx={C.x} cy={C.y} r={R_HORIZON} fill="url(#oc-core)" aria-hidden="true" />

      {/* Radar sweep — a soft rotating sector with a bright leading edge */}
      <g className="c-spin" style={{ '--spin-dur': '18s' } as React.CSSProperties} aria-hidden="true">
        <path d={SWEEP_D} fill="url(#oc-sweep)" className="orbit-sweep" />
        <line x1={C.x} y1={C.y} x2={SWEEP_LEAD.x} y2={SWEEP_LEAD.y} stroke="var(--color-accent-bright)" strokeWidth={1} strokeLinecap="round" opacity={0.28} />
      </g>

      {/* Field horizon + drifting particle field */}
      <circle cx={C.x} cy={C.y} r={R_HORIZON} stroke="var(--color-accent-line)" strokeWidth={1} className="ring-dim"
        style={{ '--ring-dur': '9s', '--ring-lo': 0.1, '--ring-hi': 0.24 } as React.CSSProperties} />
      <g aria-hidden="true">
        {FIELD_MOTES.map((m, i) => (
          <circle key={`fm${i}`} cx={m.x} cy={m.y} r={m.r} fill="var(--color-accent)" className="field-mote"
            style={{
              '--mote-dur': `${m.dur}s`, '--mote-delay': `${m.delay}s`,
              '--dx': `${m.dx}px`, '--dy': `${m.dy}px`,
              '--mote-lo': m.lo, '--mote-hi': m.hi,
            } as React.CSSProperties} />
        ))}
      </g>

      {/* Counter-rotating decorative orbits — hairline, unhurried, dimming in and out */}
      <g className="c-spin" style={{ '--spin-dur': '80s' } as React.CSSProperties} aria-hidden="true">
        <circle cx={C.x} cy={C.y} r={R_ORBIT} stroke="var(--color-accent-line)" strokeWidth={1} strokeDasharray="2 12" className="ring-dim"
          style={{ '--ring-dur': '11s', '--ring-lo': 0.28, '--ring-hi': 0.5 } as React.CSSProperties} />
      </g>
      <g className="c-spin-rev" style={{ '--spin-dur': '64s' } as React.CSSProperties} aria-hidden="true">
        <circle cx={C.x} cy={C.y} r={R_MID} stroke="var(--color-accent-line)" strokeWidth={1} strokeDasharray="1 15" className="ring-dim"
          style={{ '--ring-dur': '13s', '--ring-lo': 0.22, '--ring-hi': 0.42 } as React.CSSProperties} />
        <circle cx={C.x} cy={C.y - R_MID} r={2} fill="var(--color-accent)" opacity={0.5} />
      </g>

      {/* Capability units — each owns its node AND its stream, so hovering a node
          wakes that stream (spoke brightens, particles accelerate). */}
      {CAPS.map((f, i) => {
        const e = SPOKES[i]!
        return (
          <g key={f.id} className="rise-in cap-unit" style={{ '--rise-delay': `${260 + i * 110}ms` } as React.CSSProperties}>
            {/* Inward stream: self-drawing base + flowing pulse + travelling knowledge mote */}
            <path d={e.d} stroke="var(--color-accent-line)" strokeWidth={1.4} strokeLinecap="round"
              className={`spoke-base constellation-line ${drawn ? 'drawn' : ''}`}
              style={{ '--dash-len': `${e.len}px`, '--draw-delay': `${e.drawDelay}ms`, strokeDasharray: e.len } as React.CSSProperties} />
            <path d={e.d} stroke="url(#oc-flow)" strokeWidth={1.9} strokeLinecap="round" className="spoke-flow edge-flow"
              style={{ '--flow-delay': `${e.flowDelay}ms` } as React.CSSProperties} />
            <circle r={1.9} fill="var(--color-accent-bright)" className="spoke-mote"
              style={{
                offsetPath: `path("${e.d}")`,
                '--mote-dur': `${3.6 + (i % 3) * 0.6}s`,
                '--mote-delay': `${i * 0.7}s`,
              } as React.CSSProperties} />
            <g className="cap-bob" style={{ '--bob-delay': `${-(i * 1.4)}s` } as React.CSSProperties}>
              <g className="ig-node">
                <circle cx={f.x} cy={f.y} r={RN + 8} fill="url(#oc-glow)" className="node-glow"
                  style={{ '--breathe-delay': `${i * 420}ms` } as React.CSSProperties} />
                <circle cx={f.x} cy={f.y} r={RN} stroke="var(--color-accent-line)" strokeWidth={1}
                  style={{ fill: 'var(--fill-glass)', filter: 'var(--shadow-node-md)' }} />
                <g transform={`translate(${f.x} ${f.y})`}><CapGlyph id={f.id} /></g>
                <text x={f.x} y={f.y < C.y - 40 ? f.y - RN - 9 : f.y + RN + 16} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--color-text)">{f.label}</text>
              </g>
            </g>
          </g>
        )
      })}

      {/* The focal point — the product manager, dead center, absorbing every stream */}
      <g className="rise-in" style={{ '--rise-delay': '150ms' } as React.CSSProperties}>
        <circle cx={C.x} cy={C.y} r={RPM + 22} fill="url(#oc-glow)" className="node-glow" />
        {/* Slow breathing halo — one soft ring blooms and fades every six seconds */}
        <circle cx={C.x} cy={C.y} r={RPM + 2} fill="none" stroke="var(--color-accent)" strokeWidth={1.25} className="medallion-pulse" />
        {/* Intake ring (dashed, flowing inward) */}
        <circle cx={C.x} cy={C.y} r={RPM + 9} fill="none" stroke="var(--color-accent-line)" strokeWidth={1.25}
          className="edge-flow" style={{ strokeDasharray: '3 9' } as React.CSSProperties} />
        {/* Rim shimmer — a short bright arc sweeping the medallion edge */}
        <g className="c-spin" style={{ '--spin-dur': '9s' } as React.CSSProperties}>
          <circle cx={C.x} cy={C.y} r={RPM + 5} fill="none" stroke="var(--color-accent-bright)" strokeWidth={1.5} strokeLinecap="round"
            strokeDasharray="26 300" opacity={0.7} />
        </g>
        <circle cx={C.x} cy={C.y} r={RPM} fill="url(#oc-medallion)" style={{ filter: 'var(--shadow-node-lg)' }} />
        {/* Product-manager glyph: head + shoulders */}
        <g fill="var(--color-surface)">
          <circle cx={C.x} cy={C.y - 8} r={10.5} />
          <path d={`M${C.x - 18} ${C.y + 21} C${C.x - 18} ${C.y + 6} ${C.x + 18} ${C.y + 6} ${C.x + 18} ${C.y + 21} Z`} />
        </g>
        <text x={C.x} y={C.y + RPM + 23} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="var(--color-text)">Product Manager</text>
      </g>
    </svg>
  )
}

// ─── Hero sign-in card ────────────────────────────────────────────────────────
// Deliberately simple and reliable: username OR email + password, one button. The
// server validates bootstrap accounts and provisioned user records through the same
// endpoint (timing-safe, rate-limited, audit-logged). Labels are dropped in favour
// of quiet, lower-case placeholders.

const inputCls =
  'w-full h-11 rounded-[12px] bg-surface border border-border-strong text-text text-[15px] px-4 ' +
  'placeholder:text-faint placeholder:font-normal transition-[border-color,box-shadow] duration-200 ' +
  'focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

function HeroSignIn() {
  const navigate = useNavigate()

  const [identifier,   setIdentifier]   = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [tenant,       setTenant]       = useState('')
  const [tenants,      setTenants]      = useState<TenantInfo[]>([])
  const [tenantPinned, setTenantPinned] = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)

  useEffect(() => {
    adapter.auth.listTenants().then(list => {
      setTenants(list)
      if (!tenantPinned && list.length > 0) {
        const def = list.find(t => t.id === 'testco') ?? list[0]
        setTenant(def.id)
      }
    }).catch(() => setTenants([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function inferTenant(username: string) {
    if (!username || tenantPinned || tenants.length === 0) return
    const u = username.toLowerCase()
    const match = tenants.find(t =>
      t.id.toLowerCase() === u ||
      u.includes(t.id.toLowerCase()) ||
      t.name.toLowerCase().split(/\s+/).some(w => w.length > 2 && u.includes(w)),
    )
    if (match) setTenant(match.id)
  }

  function mapError(err: unknown): string {
    const msg = err instanceof Error ? err.message : 'Sign-in failed'
    if (msg.includes('401') || msg.includes('invalid_credentials') || msg.includes('unauthenticated')) return 'Incorrect username or password.'
    if (msg.includes('account_disabled')) return 'This account has been disabled. Contact your administrator.'
    if (msg.includes('tenant_suspended')) return 'This workspace is suspended. Contact your platform administrator.'
    if (msg.includes('429')) return 'Too many attempts. Try again in a few minutes.'
    if (msg.includes('400')) return 'Please fill in all required fields.'
    if (msg.includes('403')) return "You don't have access to that company."
    return msg
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await adapter.auth.loginBootstrap(identifier.trim(), password, tenant || undefined)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(mapError(err))
    } finally {
      setLoading(false)
    }
  }

  const buttonDisabled = loading || !identifier || !password

  return (
    <div className="relative w-full max-w-sm mx-auto lg:mx-0">
      <div className="card-backglow" aria-hidden="true" />
      <form onSubmit={handleSubmit} noValidate autoComplete="off"
        className="reinvent-card relative z-10 rounded-[20px] p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1 pb-1">
          <h2 className="text-[17px] font-semibold text-text tracking-tight">Sign in</h2>
          <p className="text-[13px] text-dim">Access your product workspace.</p>
        </div>

        <input
          id="signin-username"
          name="prh-identifier"
          aria-label="Username"
          type="text"
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
          onBlur={() => inferTenant(identifier)}
          placeholder="username"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={loading}
          className={inputCls}
        />

        <div className="relative">
          <input
            id="signin-password"
            name="prh-secret"
            aria-label="Password"
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="password"
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            disabled={loading}
            className={`${inputCls} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPass(s => !s)}
            aria-label={showPass ? 'Hide password' : 'Show password'}
            aria-pressed={showPass}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-dim transition-colors rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {showPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </button>
        </div>

        {/* Company — pre-selected to testco (seeded content default); label-less to match */}
        {tenants.length > 0 && (
          <div className="relative">
            <select
              id="signin-tenant" aria-label="Company" value={tenant}
              onChange={e => { setTenantPinned(true); setTenant(e.target.value) }}
              disabled={loading}
              className={`${inputCls} pr-10 appearance-none cursor-pointer ${tenant ? '' : 'text-faint'}`}
            >
              <option value="">Company</option>
              {tenants.map(t => <option key={t.id} value={t.id} className="text-text">{t.name}</option>)}
            </select>
            <IconChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger bg-[var(--color-danger-soft)] rounded-[8px] px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={buttonDisabled}
          className="btn-wave-shine group relative inline-flex items-center justify-center gap-2 h-12 px-7 rounded-[13px] text-white text-[15px] font-semibold transition-all duration-200 hover:scale-[1.015] active:scale-[.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 10px 26px var(--glow-accent)' }}
        >
          <span aria-hidden="true" className="wave-shine-span pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(90deg,transparent 0%,rgba(255,255,255,.18) 50%,transparent 100%)', transform: 'translateX(-180%) skewX(-20deg)' }} />
          {loading && <IconSpinner size={18} className="animate-spin" aria-hidden="true" />}
          {loading ? 'Signing in…' : 'Sign in'}
          {!loading && <IconArrowRight size={18} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />}
        </button>

        <p className="text-xs text-faint px-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-good shrink-0" aria-hidden="true" />
          Grounded, governed and fully traceable.
        </p>
      </form>
    </div>
  )
}

// ─── Feature cards ────────────────────────────────────────────────────────────

const CARDS: { icon: Glyph; title: string; body: string }[] = [
  {
    icon: IconLayers,
    title: 'Your whole portfolio, one workspace',
    body: 'Author coverages, forms, rules and rating side by side - versioned, governed and instantly searchable, from first draft to state filing.',
  },
  {
    icon: IconSparkle,
    title: 'An AI copilot for product managers',
    body: 'Ask your portfolio anything. Trace a premium, see which forms attach, draft language - every answer grounded in your data and cited to the exact refId.',
  },
  {
    icon: IconTasks,
    title: 'Every signal, aggregated',
    body: 'Live market news, readiness checks, reviews awaiting you and a living task board - the whole picture converges on you, so nothing slips.',
  },
]

function FeatureCard({ icon: Icon, title, body, delay }: { icon: Glyph; title: string; body: string; delay: number }) {
  return (
    <div
      className="group rise-in landing-card bg-surface rounded-[18px] p-6 flex flex-col gap-4"
      style={{ '--rise-delay': `${delay}ms` } as React.CSSProperties}
    >
      <div className="w-11 h-11 rounded-[13px] flex items-center justify-center transition-transform duration-300 group-hover:scale-[1.06]"
        style={{ background: 'var(--gradient-accent-soft)' }}>
        <Icon size={20} className="text-accent" strokeWidth={1.75} />
      </div>
      <h3 className="text-[15px] font-semibold text-text leading-snug">{title}</h3>
      <p className="text-sm text-dim leading-relaxed">{body}</p>
    </div>
  )
}

// ─── Landing ─────────────────────────────────────────────────────────────────

export default function Landing() {
  const { user } = useUser()
  const tiltRef = useTilt(4)

  // Route-level paint diagnostic (must run before the early return below to keep
  // hook order stable across renders).
  useEffect(() => { reportWebVitals('landing') }, [])

  // A real (credentialed) session belongs in the app, not on the marketing page.
  if (user?.email) return <Navigate to="/app" replace />

  return (
    <div className="relative min-h-svh flex flex-col overflow-hidden bg-page">
      <Aurora />

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="font-semibold text-text text-[15px] tracking-tight">Product Reinvention Hub</span>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16 px-6 sm:px-10 pt-8 pb-16 flex-1 max-w-6xl mx-auto w-full">
        <div className="flex flex-col gap-8 max-w-lg text-center lg:text-left">
          <h1 className="rise-in text-display text-[2.75rem] leading-[1.04] sm:text-6xl font-bold text-text"
            style={{ '--rise-delay': '0ms' } as React.CSSProperties}>
            Ship insurance<br />products{' '}
            <span className="gradient-text gradient-shimmer">faster.</span>
          </h1>

          <p className="rise-in text-base sm:text-lg text-dim leading-relaxed max-w-md mx-auto lg:mx-0"
            style={{ '--rise-delay': '90ms' } as React.CSSProperties}>
            The product manager sits at the center. Coverages, live market news,
            intelligent tasks and an AI assistant all flow to you - grounded, governed and
            fully traceable, from first draft to state filing.
          </p>

          <div className="rise-in" style={{ '--rise-delay': '180ms' } as React.CSSProperties}>
            <HeroSignIn />
          </div>
        </div>

        {/* Orbit console (pointer-tilted) */}
        <div className="relative shrink-0 flex items-center justify-center w-full sm:w-auto">
          <div ref={tiltRef} className="landing-tilt relative w-[360px] h-[360px] sm:w-[500px] sm:h-[500px] flex items-center justify-center">
            <div className="absolute inset-10 rounded-full blur-3xl opacity-[.12] pointer-events-none"
              style={{ background: 'radial-gradient(circle, var(--color-accent-bright), transparent 70%)' }} aria-hidden="true" />
            <OrbitConsole />
            {/* Pointer spotlight — rides the tilt's --mx/--my */}
            <div className="hero-spotlight" aria-hidden="true" />
          </div>
        </div>
      </main>

      {/* Feature cards */}
      <section className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5 px-6 sm:px-10 pb-16 max-w-5xl mx-auto w-full" aria-label="What the platform does">
        {CARDS.map((f, i) => <FeatureCard key={f.title} {...f} delay={280 + i * 90} />)}
      </section>

      {/* Footer */}
      <footer className="relative z-10 flex flex-col items-center gap-1.5 py-6 text-xs text-faint" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span>Product Reinvention Hub · P&amp;C Insurance Product Management · {new Date().getFullYear()}</span>
        <span>© {new Date().getFullYear()} Accenture</span>
        {/* Provenance mark — decoded at render (see _P1/_P2); credit-only per RISK-013. */}
        <span className="text-[9.5px] tracking-[.04em] opacity-60 select-none text-center leading-relaxed" aria-hidden="true">
          {atob(_P1)}
          <br />
          {atob(_P2)}
        </span>
      </footer>
    </div>
  )
}
