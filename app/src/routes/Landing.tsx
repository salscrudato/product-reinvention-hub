// Public landing page — aurora background, product constellation SVG, glass cards,
// and a refId marquee strip. Pure CSS + inline SVG, zero images, respects prefers-reduced-motion.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ─── Aurora background ────────────────────────────────────────────────────────

function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="aurora-a absolute w-[700px] h-[500px] rounded-full opacity-35 -top-40 -left-40"
        style={{ background: 'radial-gradient(ellipse at center, rgba(192,38,211,.55) 0%, transparent 70%)' }} />
      <div className="aurora-b absolute w-[600px] h-[450px] rounded-full opacity-30 top-1/3 -right-32"
        style={{ background: 'radial-gradient(ellipse at center, rgba(236,72,153,.5) 0%, transparent 70%)' }} />
      <div className="aurora-c absolute w-[500px] h-[400px] rounded-full opacity-25 bottom-0 left-1/3"
        style={{ background: 'radial-gradient(ellipse at center, rgba(147,51,234,.4) 0%, transparent 70%)' }} />
    </div>
  )
}

// ─── Product constellation SVG ────────────────────────────────────────────────

const CENTER = { x: 200, y: 200 }
const RADIUS = 130
const NODES = [
  { id: 'A', label: 'Coverage A', mono: 'HO.COV.001', angle: -90  },
  { id: 'B', label: 'Coverage B', mono: 'HO.COV.002', angle: -30  },
  { id: 'C', label: 'Coverage C', mono: 'HO.COV.003', angle:  30  },
  { id: 'D', label: 'Coverage D', mono: 'HO.COV.004', angle:  90  },
  { id: 'E', label: 'Coverage E', mono: 'HO.COV.005', angle:  150 },
  { id: 'F', label: 'Coverage F', mono: 'HO.COV.006', angle: -150 },
]

function pt(angle: number, r = RADIUS) {
  const a = (angle * Math.PI) / 180
  return { x: CENTER.x + r * Math.cos(a), y: CENTER.y + r * Math.sin(a) }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

function Constellation() {
  const [drawn, setDrawn] = useState(false)
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    // Trigger draw animation shortly after mount
    const t = setTimeout(() => setDrawn(true), 200)
    return () => clearTimeout(t)
  }, [])

  return (
    <svg
      ref={ref}
      viewBox="0 0 400 400"
      width="400"
      height="400"
      fill="none"
      aria-label="Product constellation diagram showing Coverage A through F nodes"
      role="img"
    >
      <defs>
        <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(192,38,211,.3)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="stroke-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C026D3" stopOpacity=".5" />
          <stop offset="100%" stopColor="#EC4899" stopOpacity=".3" />
        </linearGradient>
      </defs>

      {/* Connecting strokes */}
      {NODES.map(node => {
        const p     = pt(node.angle)
        const d     = dist(CENTER, p)
        const inner = pt(node.angle, 32)  // edge of center node
        const outer = pt(node.angle, RADIUS - 22) // edge of coverage node
        return (
          <line
            key={node.id}
            x1={inner.x} y1={inner.y}
            x2={outer.x} y2={outer.y}
            stroke="url(#stroke-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={`constellation-line ${drawn ? 'drawn' : ''}`}
            style={{ '--dash-len': `${d}px`, strokeDasharray: d } as React.CSSProperties}
          />
        )
      })}

      {/* Center node — Product */}
      <circle cx={CENTER.x} cy={CENTER.y} r={42} fill="url(#node-glow)" />
      <circle cx={CENTER.x} cy={CENTER.y} r={32} fill="rgba(255,255,255,.95)"
        style={{ filter: 'drop-shadow(0 4px 16px rgba(192,38,211,.2))' }} />
      <circle cx={CENTER.x} cy={CENTER.y} r={32} fill="none" stroke="rgba(192,38,211,.25)" strokeWidth="1" />
      <text x={CENTER.x} y={CENTER.y - 6} textAnchor="middle" className="font-semibold" fontSize="10" fill="#131318">Product</text>
      <text x={CENTER.x} y={CENTER.y + 7} textAnchor="middle" fontSize="8" fill="#5B5C6B" style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>HO.PROD.001</text>

      {/* Coverage nodes */}
      {NODES.map(node => {
        const { x, y } = pt(node.angle)
        return (
          <g key={node.id} className="group cursor-default">
            <circle cx={x} cy={y} r={28} fill="rgba(255,255,255,.0)" className="transition-all duration-200 group-hover:fill-[rgba(192,38,211,.05)]" />
            <circle cx={x} cy={y} r={22} fill="rgba(255,255,255,.9)"
              stroke="rgba(192,38,211,.2)" strokeWidth="1"
              style={{ filter: 'drop-shadow(0 2px 8px rgba(192,38,211,.1))' }}
              className="transition-all duration-200 group-hover:stroke-[rgba(192,38,211,.5)]"
            />
            <text x={x} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="600" fill="#131318">Cov {node.id}</text>
            <text x={x} y={y + 7} textAnchor="middle" fontSize="7" fill="#8E90A0" style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>{node.mono.split('.').slice(-1)[0]}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Marquee strip ────────────────────────────────────────────────────────────

const CHIPS = [
  'HO 00 03','HO.RU.006','HO 04 61','HO.LD.002','HO.COV.003.002',
  'HO.FORM.RU.003','HO 04 90','HO.RT.003','HO.LD.001','HO.RU.008',
  'PN HO 01','HO.COV.005','HO.RT.007','HO 03 12','HO.LD.004',
]

function MarqueeStrip() {
  const doubled = [...CHIPS, ...CHIPS]
  return (
    <div className="overflow-hidden w-full py-2" aria-hidden="true">
      <div className="marquee-track flex gap-3" style={{ width: 'max-content' }}>
        {doubled.map((chip, i) => (
          <span
            key={i}
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-mono text-faint bg-surface"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Counting premium ─────────────────────────────────────────────────────────

function CountingPremium() {
  const [val, setVal] = useState(0)
  const target = 1528

  useEffect(() => {
    const steps = 60
    const dur   = 1600
    let i = 0
    const timer = setInterval(() => {
      i++
      const p = i / steps
      const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
      setVal(Math.round(eased * target))
      if (i >= steps) clearInterval(timer)
    }, dur / steps)
    return () => clearInterval(timer)
  }, [])

  return (
    <span
      className="font-mono text-xl font-bold tabular-nums"
      style={{ background: 'linear-gradient(135deg, #C026D3, #EC4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
    >
      ${val.toLocaleString()}
    </span>
  )
}

// ─── Glass card with pointer parallax ────────────────────────────────────────

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tStyle, setTStyle] = useState<React.CSSProperties>({})

  function onMove(e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const x = (e.clientX - rect.left - rect.width / 2)  / (rect.width  / 2)
    const y = (e.clientY - rect.top  - rect.height / 2) / (rect.height / 2)
    setTStyle({ transform: `perspective(700px) rotateX(${-y * 5}deg) rotateY(${x * 5}deg) translateZ(6px)` })
  }

  return (
    <div
      ref={ref}
      className={`rounded-[16px] p-5 backdrop-blur-md transition-transform duration-200 ${className}`}
      style={{
        background: 'rgba(255,255,255,.72)',
        border: '1px solid rgba(255,255,255,.6)',
        boxShadow: '0 4px 24px rgba(192,38,211,.08), inset 0 1px 0 rgba(255,255,255,.8)',
        ...tStyle,
      }}
      onMouseMove={onMove}
      onMouseLeave={() => setTStyle({})}
    >
      {children}
    </div>
  )
}

// ─── Main Landing ─────────────────────────────────────────────────────────────

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="relative min-h-svh flex flex-col overflow-hidden bg-page">
      <Aurora />

      {/* Nav bar */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect width="24" height="24" rx="6" fill="url(#nav-grad)" />
            <path d="M7 12l4 4 6-8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <defs>
              <linearGradient id="nav-grad" x1="0" y1="0" x2="24" y2="24">
                <stop stopColor="#C026D3" /><stop offset="1" stopColor="#EC4899" />
              </linearGradient>
            </defs>
          </svg>
          <span className="font-semibold text-text text-sm tracking-tight">Product Factory</span>
        </div>
        <button
          onClick={() => navigate('/sign-in')}
          className="text-sm font-medium text-dim hover:text-text transition-colors px-4 py-2 rounded-[8px] hover:bg-surface"
        >
          Sign in →
        </button>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-col lg:flex-row items-center justify-center gap-16 px-8 py-16 flex-1">
        {/* Left — headline + CTA */}
        <div className="flex flex-col gap-6 max-w-md text-center lg:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-soft self-center lg:self-start">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
            <span className="text-xs font-medium text-accent font-mono">P&C Insurance · HO-3 Special Form</span>
          </div>

          <h1 className="text-4xl lg:text-5xl font-bold text-text leading-tight tracking-tight">
            Ship insurance products<br />
            <span
              style={{ background: 'linear-gradient(135deg, #C026D3 0%, #EC4899 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              10× faster.
            </span>
          </h1>

          <p className="text-base text-dim leading-relaxed">
            AI-native product management for property &amp; casualty insurers. Author coverages, price with confidence, govern with traceability — from first draft to state filing.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <button
              onClick={() => navigate('/sign-in')}
              className="px-6 py-3 rounded-[12px] text-white font-semibold text-sm transition-all duration-150 hover:scale-[1.02] active:scale-[.98]"
              style={{ background: 'linear-gradient(135deg, #C026D3, #EC4899)', boxShadow: '0 4px 16px rgba(192,38,211,.35)' }}
            >
              Enter the Factory →
            </button>
            <button
              onClick={() => navigate('/app/explorer')}
              className="px-6 py-3 rounded-[12px] text-dim font-medium text-sm bg-surface border hover:bg-raised transition-colors"
              style={{ borderColor: 'var(--color-border)' }}
            >
              Explore HO-3
            </button>
          </div>
        </div>

        {/* Right — constellation */}
        <div className="relative shrink-0">
          <div
            className="absolute inset-0 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{ background: 'radial-gradient(circle, #C026D3, #EC4899)' }}
            aria-hidden="true"
          />
          <Constellation />
        </div>
      </main>

      {/* Marquee strip */}
      <div className="relative z-10 w-full overflow-hidden py-4" style={{ borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
        <MarqueeStrip />
      </div>

      {/* Glass module cards */}
      <section
        className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5 px-8 py-12 max-w-5xl mx-auto w-full"
        aria-label="Feature highlights"
      >
        {/* Rating trace card */}
        <GlassCard>
          <p className="text-xs font-medium text-faint mb-3 font-mono uppercase tracking-wide">Live Rating Trace</p>
          <div className="flex flex-col gap-2 text-xs font-mono text-dim mb-3">
            {[
              { step: 'S1', label: 'Territory T002',    val: '$700.00' },
              { step: 'S3', label: '×1.30 CovA 400k',  val: '$956' },
              { step: 'S9', label: '×1.10 Tier B',      val: '$1,262.47' },
            ].map(r => (
              <div key={r.step} className="flex items-center justify-between">
                <span className="text-accent font-semibold">{r.step}</span>
                <span className="text-faint">{r.label}</span>
                <span className="text-text font-medium">{r.val}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <span className="text-xs text-dim">Final premium</span>
            <CountingPremium />
          </div>
        </GlassCard>

        {/* AI grounded chat */}
        <GlassCard>
          <p className="text-xs font-medium text-faint mb-3 font-mono uppercase tracking-wide">AI Assistant</p>
          <div className="flex flex-col gap-2.5">
            <div className="self-end px-3 py-2 rounded-[10px] rounded-br-[3px] bg-accent-soft text-accent text-xs max-w-[80%]">
              When does HO 04 90 attach?
            </div>
            <div className="self-start px-3 py-2 rounded-[10px] rounded-bl-[3px] bg-raised text-text text-xs max-w-[90%] leading-relaxed">
              HO 04 90 attaches when Personal Property Replacement Cost is elected per <span className="font-mono text-accent">[HO.FORM.RU.001]</span>. It amends Coverage C settlement.
            </div>
          </div>
        </GlassCard>

        {/* Kanban glimpse */}
        <GlassCard>
          <p className="text-xs font-medium text-faint mb-3 font-mono uppercase tracking-wide">Product Tasks</p>
          <div className="flex flex-col gap-2">
            {[
              { col: 'BUILD', task: 'Configure product in Factory', done: true  },
              { col: 'TEST',  task: 'UAT rating scenarios',          done: false },
              { col: 'LAUNCH',task: 'Launch readiness check',        done: false },
            ].map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${t.done ? 'bg-good border-good' : 'border-[rgba(19,19,26,.2)]'}`} aria-hidden="true">
                  {t.done && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>}
                </span>
                <span className={t.done ? 'text-dim line-through' : 'text-text'}>{t.task}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </section>

      {/* Footer */}
      <footer className="relative z-10 flex items-center justify-center py-6 text-xs text-faint" style={{ borderTop: '1px solid var(--color-border)' }}>
        Product Factory · P&C Insurance Product Management · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
