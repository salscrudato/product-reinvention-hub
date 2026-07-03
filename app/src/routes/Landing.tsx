// Public landing — the showpiece. Aurora background + a bespoke "insight graph":
// an insurance product manager at the focal point, informed by inward-flowing
// streams from the app's capabilities (live news, coverages & forms, an AI
// copilot, rating, intelligent tasks). Coverages branch out from their node.
// Pure CSS + inline SVG, zero images, honours prefers-reduced-motion.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, Sparkles, KanbanSquare, ArrowRight } from 'lucide-react'
import { Logo } from '../components/ui'

// ─── Aurora background ────────────────────────────────────────────────────────

function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="aurora-a absolute w-[720px] h-[520px] rounded-full opacity-30 -top-48 -left-40"
        style={{ background: 'radial-gradient(ellipse at center, rgba(161,0,255,.5) 0%, transparent 70%)' }} />
      <div className="aurora-b absolute w-[620px] h-[460px] rounded-full opacity-25 top-1/4 -right-32"
        style={{ background: 'radial-gradient(ellipse at center, rgba(109,40,217,.42) 0%, transparent 70%)' }} />
      <div className="aurora-c absolute w-[520px] h-[420px] rounded-full opacity-20 bottom-0 left-1/4"
        style={{ background: 'radial-gradient(ellipse at center, rgba(139,31,224,.4) 0%, transparent 70%)' }} />
    </div>
  )
}

// ─── Insight-graph geometry ───────────────────────────────────────────────────

interface Vec { x: number; y: number }
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y)
const unit = (a: Vec, b: Vec): Vec => { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d } }
const rad = (deg: number) => (deg * Math.PI) / 180

// Focal point: the product manager.
const PM  = { x: 348, y: 234 }
const RPM = 46           // medallion radius
const RN  = 22           // feature-node radius

type GlyphId = 'news' | 'ai' | 'cov' | 'rate' | 'task'
interface Feature { id: GlyphId; label: string; chip: string; x: number; y: number }

// Capability sources — arranged on a left arc, converging on the PM.
const FEATURES: Feature[] = [
  { id: 'news', label: 'Live news',  chip: '12 new',   x: 100, y: 66  },
  { id: 'ai',   label: 'AI copilot', chip: 'grounded', x: 64,  y: 152 },
  { id: 'cov',  label: 'Coverages',  chip: 'HO-3',     x: 70,  y: 240 },
  { id: 'rate', label: 'Rating',     chip: '$1,528',   x: 80,  y: 328 },
  { id: 'task', label: 'Tasks',      chip: '8 due',    x: 112, y: 410 },
]

// Coverage leaves that branch out of the Coverages node.
const COV = FEATURES.find(f => f.id === 'cov')!
const COV_LEAVES = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter, i) => {
  const angle = 108 + i * 22               // fan out to the left, evenly spaced, clear of neighbours
  return { letter, x: COV.x + 50 * Math.cos(rad(angle)), y: COV.y + 50 * Math.sin(rad(angle)) }
})

interface Edge { d: string; len: number; drawDelay: number; flowDelay: number; head: string }

function buildEdges(): Edge[] {
  return FEATURES.map((n, i) => {
    const u  = unit(n, PM)
    const S  = { x: n.x + u.x * RN,   y: n.y + u.y * RN  }  // leaves the node toward PM
    const E  = { x: PM.x - u.x * RPM, y: PM.y - u.y * RPM } // arrives at the medallion edge
    const c1 = { x: S.x + (E.x - S.x) * 0.45, y: S.y }
    const c2 = { x: E.x - 78, y: E.y + (n.y - PM.y) * 0.05 }
    const d  = `M ${S.x} ${S.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${E.x} ${E.y}`
    // Arrowhead pointing into the PM (makes the inward direction unmistakable at rest).
    const p  = { x: -u.y, y: u.x }
    const b1 = { x: E.x - u.x * 8 + p.x * 4, y: E.y - u.y * 8 + p.y * 4 }
    const b2 = { x: E.x - u.x * 8 - p.x * 4, y: E.y - u.y * 8 - p.y * 4 }
    return {
      d, len: dist(S, E) * 1.18,
      drawDelay: 200 + i * 90,
      flowDelay: 600 + i * 140,
      head: `${E.x},${E.y} ${b1.x},${b1.y} ${b2.x},${b2.y}`,
    }
  })
}
const EDGES = buildEdges()

// ─── Feature glyphs (hand-drawn, no icon fonts) ───────────────────────────────

function Glyph({ id }: { id: GlyphId }) {
  const s = { stroke: 'var(--color-accent)', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'news': return <g {...s}><rect x={-7} y={-8} width={14} height={16} rx={2} /><line x1={-4} y1={-4} x2={4} y2={-4} /><line x1={-4} y1={0} x2={4} y2={0} /><line x1={-4} y1={4} x2={1} y2={4} /></g>
    case 'ai':   return <path d="M0 -9 C1 -3 3 -1 9 0 C3 1 1 3 0 9 C-1 3 -3 1 -9 0 C-3 -1 -1 -3 0 -9 Z" fill="var(--color-accent)" />
    case 'cov':  return <g {...s}>{[-5, 0, 5].map((dy, i) => <path key={i} d={`M-8 ${dy} L0 ${dy - 4} L8 ${dy} L0 ${dy + 4} Z`} />)}</g>
    case 'rate': return <g {...s}><line x1={-6} y1={7} x2={-6} y2={1} /><line x1={0} y1={7} x2={0} y2={-3} /><line x1={6} y1={7} x2={6} y2={-7} /></g>
    case 'task': return <g {...s}><rect x={-7} y={-7} width={14} height={14} rx={3} /><path d="M-3 0 L-0.5 3 L4 -3" /></g>
  }
}

// ─── The insight graph ────────────────────────────────────────────────────────

function InsightGraph() {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 150); return () => clearTimeout(t) }, [])

  return (
    <svg
      viewBox="0 0 470 470" width="100%" height="100%" fill="none"
      className="graph-float max-w-[500px]"
      role="img"
      aria-label="An insurance product manager at the focal point, continuously informed by inward-flowing streams from the platform: live market news, the product's coverages and forms branching from a coverages node, an AI copilot, rating, and intelligent tasks."
    >
      <defs>
        <radialGradient id="ig-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity=".32" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ig-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity=".18" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity=".6" />
        </linearGradient>
        <linearGradient id="ig-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent-bright)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </linearGradient>
        <linearGradient id="ig-medallion" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-bright)" />
          <stop offset="100%" stopColor="var(--color-accent-strong)" />
        </linearGradient>
      </defs>

      {/* Converging edges: self-drawing base + inward-flowing pulse + arrowhead */}
      {EDGES.map((e, i) => (
        <g key={`e${i}`}>
          <path d={e.d} stroke="url(#ig-edge)" strokeWidth={1.5} strokeLinecap="round"
            className={`constellation-line ${drawn ? 'drawn' : ''}`}
            style={{ '--dash-len': `${e.len}px`, '--draw-delay': `${e.drawDelay}ms`, strokeDasharray: e.len } as React.CSSProperties} />
          <path d={e.d} stroke="url(#ig-flow)" strokeWidth={2} strokeLinecap="round" className="edge-flow"
            style={{ '--flow-delay': `${e.flowDelay}ms` } as React.CSSProperties} />
          <polygon points={e.head} fill="var(--color-accent)" opacity={drawn ? 0.75 : 0}
            style={{ transition: 'opacity .5s ease', transitionDelay: `${e.drawDelay + 700}ms` }} />
        </g>
      ))}

      {/* Coverage leaves branching out of the Coverages node */}
      {COV_LEAVES.map((leaf, i) => (
        <g key={`cov${leaf.letter}`} className="rise-in" style={{ '--rise-delay': `${1100 + i * 70}ms` } as React.CSSProperties}>
          <line x1={COV.x} y1={COV.y} x2={leaf.x} y2={leaf.y} stroke="var(--color-accent-line)" strokeWidth={1} />
          <circle cx={leaf.x} cy={leaf.y} r={9} fill="rgba(255,255,255,.95)" stroke="var(--color-accent-line)" strokeWidth={1}
            style={{ filter: 'drop-shadow(0 1px 5px rgba(139,31,224,.10))' }} />
          <text x={leaf.x} y={leaf.y + 3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="var(--color-accent)"
            style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>{leaf.letter}</text>
        </g>
      ))}

      {/* Feature source nodes */}
      {FEATURES.map((f, i) => (
        <g key={f.id} className="rise-in" style={{ '--rise-delay': `${250 + i * 110}ms` } as React.CSSProperties}>
          <circle cx={f.x} cy={f.y} r={RN + 7} fill="url(#ig-glow)" className="node-glow"
            style={{ '--breathe-delay': `${i * 420}ms` } as React.CSSProperties} />
          <circle cx={f.x} cy={f.y} r={RN} fill="rgba(255,255,255,.96)" stroke="var(--color-accent-line)" strokeWidth={1}
            style={{ filter: 'drop-shadow(0 3px 12px rgba(139,31,224,.12))' }} />
          <g transform={`translate(${f.x} ${f.y})`}><Glyph id={f.id} /></g>
          <text x={f.x} y={f.y - RN - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill="#131318">{f.label}</text>
          <text x={f.x} y={f.y + RN + 13} textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--color-accent)"
            style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>{f.chip}</text>
        </g>
      ))}

      {/* Focal point — the product manager, aggregating every stream */}
      <g className="rise-in" style={{ '--rise-delay': '150ms' } as React.CSSProperties}>
        <circle cx={PM.x} cy={PM.y} r={RPM + 22} fill="url(#ig-glow)" className="node-glow" />
        {/* Orbiting intake ring (reuses the edge-flow dash animation) */}
        <circle cx={PM.x} cy={PM.y} r={RPM + 9} fill="none" stroke="var(--color-accent-line)" strokeWidth={1.25}
          className="edge-flow" style={{ strokeDasharray: '3 9' } as React.CSSProperties} />
        <circle cx={PM.x} cy={PM.y} r={RPM} fill="url(#ig-medallion)"
          style={{ filter: 'drop-shadow(0 8px 26px rgba(139,31,224,.34))' }} />
        {/* Product-manager glyph: head + shoulders */}
        <g fill="#fff">
          <circle cx={PM.x} cy={PM.y - 9} r={11} />
          <path d={`M${PM.x - 19} ${PM.y + 22} C${PM.x - 19} ${PM.y + 6} ${PM.x + 19} ${PM.y + 6} ${PM.x + 19} ${PM.y + 22} Z`} />
        </g>
        <text x={PM.x} y={PM.y + RPM + 20} textAnchor="middle" fontSize="12" fontWeight="700" fill="#131318">Product Manager</text>
        <text x={PM.x} y={PM.y + RPM + 35} textAnchor="middle" fontSize="8.5" fill="#5B5C6B"
          style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}>informed · in control</text>
      </g>
    </svg>
  )
}

// ─── Feature cards ────────────────────────────────────────────────────────────

const CARDS = [
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
    title: 'Every signal, aggregated',
    body: 'Live market news, readiness checks, reviews awaiting you and a living task board — the whole picture converges on you, so nothing slips.',
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
        style={{ background: 'var(--gradient-accent-soft)' }}>
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
          <Logo size={32} rounded={9} className="shadow-[0_2px_10px_rgba(139,31,224,.3)]" />
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
      <main className="relative z-10 flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16 px-6 sm:px-10 pt-8 pb-16 flex-1 max-w-6xl mx-auto w-full">
        <div className="flex flex-col gap-7 max-w-lg text-center lg:text-left">
          <span className="rise-in inline-flex items-center gap-2 self-center lg:self-start text-xs font-medium text-accent bg-accent-soft rounded-full px-3 py-1"
            style={{ '--rise-delay': '0ms' } as React.CSSProperties}>
            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> AI-native · P&amp;C insurance
          </span>

          <h1 className="rise-in text-display text-[2.75rem] leading-[1.04] sm:text-6xl font-bold text-text"
            style={{ '--rise-delay': '70ms' } as React.CSSProperties}>
            Ship insurance<br />products{' '}
            <span className="gradient-text">faster.</span>
          </h1>

          <p className="rise-in text-base sm:text-lg text-dim leading-relaxed max-w-md mx-auto lg:mx-0"
            style={{ '--rise-delay': '150ms' } as React.CSSProperties}>
            The product manager sits at the centre. Coverages, rating, live market news,
            intelligent tasks and an AI copilot all flow to you — grounded, governed and
            fully traceable, from first draft to state filing.
          </p>

          <div className="rise-in flex justify-center lg:justify-start" style={{ '--rise-delay': '230ms' } as React.CSSProperties}>
            <button
              onClick={() => navigate('/sign-in')}
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-[13px] text-white font-semibold text-[15px] transition-all duration-200 hover:scale-[1.02] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 6px 22px var(--glow-accent)' }}
            >
              Enter the Hub
              <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Insight graph */}
        <div className="relative shrink-0 w-[360px] h-[360px] sm:w-[480px] sm:h-[480px] flex items-center justify-center">
          <div className="absolute inset-10 rounded-full blur-3xl opacity-[.16] pointer-events-none"
            style={{ background: 'radial-gradient(circle, var(--color-accent-bright), transparent 70%)' }} aria-hidden="true" />
          <InsightGraph />
        </div>
      </main>

      {/* Feature cards */}
      <section className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5 px-6 sm:px-10 pb-16 max-w-5xl mx-auto w-full" aria-label="What the Hub does">
        {CARDS.map((f, i) => <FeatureCard key={f.title} {...f} delay={280 + i * 90} />)}
      </section>

      {/* Footer */}
      <footer className="relative z-10 flex items-center justify-center py-6 text-xs text-faint" style={{ borderTop: '1px solid var(--color-border)' }}>
        Product Reinvention Hub · P&amp;C Insurance Product Management · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
