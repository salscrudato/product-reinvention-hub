// Public landing — the showpiece. Aurora background, an AI-inspired product graph
// (product → coverages → limits) with self-drawing edges and flowing directional
// pulses, and three elegant feature cards. Pure CSS + inline SVG, zero images,
// respects prefers-reduced-motion.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, Sparkles, KanbanSquare, ArrowRight } from 'lucide-react'
import { Logo } from '../components/ui'

// ─── Aurora background ────────────────────────────────────────────────────────

function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="aurora-a absolute w-[720px] h-[520px] rounded-full opacity-30 -top-48 -left-40"
        style={{ background: 'radial-gradient(ellipse at center, rgba(147,51,234,.5) 0%, transparent 70%)' }} />
      <div className="aurora-b absolute w-[620px] h-[460px] rounded-full opacity-25 top-1/4 -right-32"
        style={{ background: 'radial-gradient(ellipse at center, rgba(219,39,119,.45) 0%, transparent 70%)' }} />
      <div className="aurora-c absolute w-[520px] h-[420px] rounded-full opacity-20 bottom-0 left-1/4"
        style={{ background: 'radial-gradient(ellipse at center, rgba(192,38,211,.4) 0%, transparent 70%)' }} />
    </div>
  )
}

// ─── Product graph geometry ─────────────────────────────────────────────────

const C = { x: 240, y: 240 }
const R_COV = 138   // coverage ring radius
const R_LIM = 210   // limit leaf radius
const RP = 44, RC = 26, RL = 18   // node radii: product, coverage, limit

interface Vec { x: number; y: number }
const rad = (deg: number) => (deg * Math.PI) / 180
const at = (deg: number, r: number): Vec => ({ x: C.x + r * Math.cos(rad(deg)), y: C.y + r * Math.sin(rad(deg)) })
const unit = (a: Vec, b: Vec): Vec => { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d } }
const len = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y)

const COVERAGES = [
  { id: 'A', label: 'Cov A', ref: '001', angle: -90 },
  { id: 'B', label: 'Cov B', ref: '002', angle: -30 },
  { id: 'C', label: 'Cov C', ref: '003', angle:  30 },
  { id: 'D', label: 'Cov D', ref: '004', angle:  90 },
  { id: 'E', label: 'Cov E', ref: '005', angle: 150 },
  { id: 'F', label: 'Cov F', ref: '006', angle: 210 },
]

// Limit / term leaves branching off selected coverages.
const LIMITS = [
  { parent: 'A', angle: -108, label: 'Dwelling', ref: '$400k' },
  { parent: 'A', angle:  -72, label: 'Deductible', ref: '$1,000' },
  { parent: 'C', angle:   48, label: 'Cov C %',  ref: '70%' },
  { parent: 'E', angle:  132, label: 'Liability', ref: '$300k' },
  { parent: 'F', angle:  228, label: 'Med Pay',  ref: '$2,000' },
]

interface Edge { from: Vec; to: Vec; length: number; kind: 'cov' | 'lim'; delay: number }

function buildEdges(): Edge[] {
  const edges: Edge[] = []
  COVERAGES.forEach((cov, i) => {
    const p = at(cov.angle, R_COV)
    const u = unit(C, p)
    const from = { x: C.x + u.x * RP, y: C.y + u.y * RP }
    const to   = { x: p.x - u.x * RC, y: p.y - u.y * RC }
    edges.push({ from, to, length: len(from, to), kind: 'cov', delay: 150 + i * 70 })
  })
  LIMITS.forEach((lim, i) => {
    const parent = COVERAGES.find(c => c.id === lim.parent)!
    const pp = at(parent.angle, R_COV)
    const lp = at(lim.angle, R_LIM)
    const u = unit(pp, lp)
    const from = { x: pp.x + u.x * RC, y: pp.y + u.y * RC }
    const to   = { x: lp.x - u.x * RL, y: lp.y - u.y * RL }
    edges.push({ from, to, length: len(from, to), kind: 'lim', delay: 650 + i * 80 })
  })
  return edges
}

const EDGES = buildEdges()

function ProductGraph() {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 150); return () => clearTimeout(t) }, [])

  return (
    <svg
      viewBox="0 0 480 480" width="100%" height="100%" fill="none"
      className="graph-float max-w-[480px]"
      role="img"
      aria-label="Product graph: an HO-3 product branching into coverages A–F and their limits and deductibles."
    >
      <defs>
        <radialGradient id="g-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(192,38,211,.35)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="g-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9333EA" stopOpacity=".55" />
          <stop offset="100%" stopColor="#DB2777" stopOpacity=".35" />
        </linearGradient>
        <linearGradient id="g-flow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C026D3" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
        <linearGradient id="g-node" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9333EA" /><stop offset="100%" stopColor="#DB2777" />
        </linearGradient>
      </defs>

      {/* Edges: a self-drawing base line + a flowing directional overlay */}
      {EDGES.map((e, i) => (
        <g key={`e${i}`}>
          <line
            x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y}
            stroke="url(#g-edge)" strokeWidth={e.kind === 'cov' ? 1.6 : 1.1} strokeLinecap="round"
            className={`constellation-line ${drawn ? 'drawn' : ''}`}
            style={{ '--dash-len': `${e.length}px`, '--draw-delay': `${e.delay}ms`, strokeDasharray: e.length } as React.CSSProperties}
          />
          <line
            x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y}
            stroke="url(#g-flow)" strokeWidth={e.kind === 'cov' ? 2.2 : 1.6} strokeLinecap="round"
            className="edge-flow"
            style={{ '--flow-delay': `${e.delay + 400}ms` } as React.CSSProperties}
          />
        </g>
      ))}

      {/* Limit leaves */}
      {LIMITS.map((lim, i) => {
        const p = at(lim.angle, R_LIM)
        return (
          <g key={`l${i}`} className="rise-in" style={{ '--rise-delay': `${700 + i * 80}ms` } as React.CSSProperties}>
            <circle cx={p.x} cy={p.y} r={RL} fill="rgba(255,255,255,.92)" stroke="rgba(192,38,211,.22)" strokeWidth="1"
              style={{ filter: 'drop-shadow(0 2px 8px rgba(192,38,211,.1))' }} />
            <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize="7" fontWeight="600" fill="#5B5C6B">{lim.label}</text>
            <text x={p.x} y={p.y + 7} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#C026D3"
              style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>{lim.ref}</text>
          </g>
        )
      })}

      {/* Coverage nodes */}
      {COVERAGES.map((cov, i) => {
        const p = at(cov.angle, R_COV)
        return (
          <g key={cov.id}>
            <circle cx={p.x} cy={p.y} r={RC + 8} fill="url(#g-glow)" className="node-glow"
              style={{ '--breathe-delay': `${i * 500}ms` } as React.CSSProperties} />
            <circle cx={p.x} cy={p.y} r={RC} fill="rgba(255,255,255,.95)" stroke="rgba(192,38,211,.28)" strokeWidth="1"
              style={{ filter: 'drop-shadow(0 3px 12px rgba(192,38,211,.14))' }} />
            <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize="10" fontWeight="700" fill="#131318">{cov.label}</text>
            <text x={p.x} y={p.y + 8} textAnchor="middle" fontSize="7.5" fill="#8E90A0"
              style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>{cov.ref}</text>
          </g>
        )
      })}

      {/* Product core */}
      <circle cx={C.x} cy={C.y} r={RP + 14} fill="url(#g-glow)" className="node-glow" />
      <circle cx={C.x} cy={C.y} r={RP} fill="rgba(255,255,255,.97)" stroke="url(#g-node)" strokeWidth="1.5"
        style={{ filter: 'drop-shadow(0 6px 22px rgba(192,38,211,.24))' }} />
      <text x={C.x} y={C.y - 5} textAnchor="middle" fontSize="12" fontWeight="700" fill="#131318">Product</text>
      <text x={C.x} y={C.y + 10} textAnchor="middle" fontSize="8" fill="#5B5C6B"
        style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>HO.PROD.001</text>
    </svg>
  )
}

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Layers,
    title: 'Your whole portfolio, one workspace',
    body: 'Author coverages, forms, rules and rating side by side — versioned, governed and instantly searchable, from first draft to state filing.',
  },
  {
    icon: Sparkles,
    title: 'An AI copilot for product managers',
    body: 'Ask your portfolio anything. Trace a premium, see which forms attach, draft language — every answer grounded in your data and cited to the exact refId.',
  },
  {
    icon: KanbanSquare,
    title: 'Every filing, on track',
    body: 'A living task board carries each product from idea to launch, with owners, due dates and readiness checks — so nothing slips.',
  },
]

function FeatureCard({ icon: Icon, title, body, delay }: { icon: typeof Layers; title: string; body: string; delay: number }) {
  return (
    <div
      className="group rise-in bg-surface rounded-[18px] p-6 flex flex-col gap-4 transition-all duration-300 hover:-translate-y-1"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)', '--rise-delay': `${delay}ms` } as React.CSSProperties}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
    >
      <div className="w-11 h-11 rounded-[13px] flex items-center justify-center transition-transform duration-300 group-hover:scale-[1.06]"
        style={{ background: 'linear-gradient(135deg, rgba(147,51,234,.12), rgba(219,39,119,.1))' }}>
        <Icon size={20} className="text-accent" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h3 className="text-[15px] font-semibold text-text leading-snug">{title}</h3>
      <p className="text-sm text-dim leading-relaxed">{body}</p>
    </div>
  )
}

// ─── Landing ────────────────────────────────────────────────────────────────

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="relative min-h-svh flex flex-col overflow-hidden bg-page">
      <Aurora />

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={32} rounded={9} className="shadow-[0_2px_10px_rgba(192,38,211,.3)]" />
          <span className="font-semibold text-text text-[15px] tracking-tight">Product Reinvention Hub</span>
        </div>
        <button
          onClick={() => navigate('/sign-in')}
          className="text-sm font-medium text-dim hover:text-text transition-colors px-4 py-2 rounded-[9px] hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Sign in →
        </button>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-20 px-6 sm:px-10 pt-10 pb-16 flex-1 max-w-6xl mx-auto w-full">
        <div className="flex flex-col gap-7 max-w-lg text-center lg:text-left">
          <h1 className="rise-in text-[2.75rem] leading-[1.05] sm:text-6xl font-bold text-text tracking-[-.02em]"
            style={{ '--rise-delay': '0ms' } as React.CSSProperties}>
            Ship insurance<br />products{' '}
            <span style={{ background: 'linear-gradient(120deg,#9333EA 0%,#C026D3 45%,#DB2777 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              faster.
            </span>
          </h1>

          <p className="rise-in text-base sm:text-lg text-dim leading-relaxed max-w-md mx-auto lg:mx-0"
            style={{ '--rise-delay': '90ms' } as React.CSSProperties}>
            AI-native product management for property &amp; casualty insurers. Author coverages, price with confidence, and govern with full traceability — from first draft to state filing.
          </p>

          <div className="rise-in flex justify-center lg:justify-start" style={{ '--rise-delay': '180ms' } as React.CSSProperties}>
            <button
              onClick={() => navigate('/sign-in')}
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-[13px] text-white font-semibold text-[15px] transition-all duration-200 hover:scale-[1.02] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ background: 'linear-gradient(135deg,#9333EA,#C026D3,#DB2777)', boxShadow: '0 6px 22px rgba(192,38,211,.35)' }}
            >
              Enter the Hub
              <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Product graph */}
        <div className="relative shrink-0 w-[340px] h-[340px] sm:w-[440px] sm:h-[440px] flex items-center justify-center">
          <div className="absolute inset-8 rounded-full blur-3xl opacity-[.18] pointer-events-none"
            style={{ background: 'radial-gradient(circle,#C026D3,#EC4899)' }} aria-hidden="true" />
          <ProductGraph />
        </div>
      </main>

      {/* Feature cards */}
      <section className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5 px-6 sm:px-10 pb-16 max-w-5xl mx-auto w-full" aria-label="What the Hub does">
        {FEATURES.map((f, i) => <FeatureCard key={f.title} {...f} delay={280 + i * 90} />)}
      </section>

      {/* Footer */}
      <footer className="relative z-10 flex items-center justify-center py-6 text-xs text-faint" style={{ borderTop: '1px solid var(--color-border)' }}>
        Product Reinvention Hub · P&amp;C Insurance Product Management · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
