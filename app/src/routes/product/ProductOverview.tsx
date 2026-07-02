// Overview — SVG hierarchy tree, health panel, quick-stats.
import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react'
import { useProductCtx } from '../../context/useProductCtx'
import { Card, Skeleton } from '../../components/ui'
import { Button } from '../../components/ui/Button'
import type { WithId } from '../../context/ProductContext'
import type { Coverage } from '@pf/shared'

// ─── SVG hierarchy tree ──────────────────────────────────────────────────────

const NODE_W = 148; const NODE_H = 48; const H_GAP = 12; const V_GAP = 56

interface TreeNode { cov: WithId<Coverage>; children: TreeNode[]; x: number; y: number; w: number }

function buildTree(cov: WithId<Coverage>, all: WithId<Coverage>[], depth: number): TreeNode {
  const children = all.filter(c => c.parentId === cov.refId).map(c => buildTree(c, all, depth + 1))
  const w = Math.max(NODE_W, children.reduce((s, c) => s + c.w + H_GAP, -H_GAP))
  return { cov, children, x: 0, y: depth * (NODE_H + V_GAP), w }
}

function assignX(node: TreeNode, left: number): void {
  node.x = left + (node.w - NODE_W) / 2
  let cx = left
  for (const child of node.children) {
    assignX(child, cx)
    cx += child.w + H_GAP
  }
}

function collectEdges(node: TreeNode): Array<{ x1:number; y1:number; x2:number; y2:number }> {
  const edges: ReturnType<typeof collectEdges> = []
  for (const child of node.children) {
    const px = node.x + NODE_W / 2; const py = node.y + NODE_H
    const cx = child.x + NODE_W / 2; const cy = child.y
    const mid = py + V_GAP / 2
    edges.push({ x1: px, y1: py, x2: px, y2: mid }, { x1: px, y1: mid, x2: cx, y2: mid }, { x1: cx, y1: mid, x2: cx, y2: cy })
    edges.push(...collectEdges(child))
  }
  return edges
}

function collectNodes(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(collectNodes)]
}

const STATUS_DOT: Record<string, string> = { ACTIVE: '#059669', INACTIVE: '#8E90A0', FUTURE: '#2563eb' }

function HierarchyTree({ coverages }: { coverages: WithId<Coverage>[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const roots  = coverages.filter(c => !c.parentId)
  if (!roots.length) return <p className="text-sm text-faint py-8 text-center">No coverages yet.</p>

  // Build forest
  const trees = roots.map(r => buildTree(r, coverages, 0))
  let totalW = trees.reduce((s, t) => s + t.w + H_GAP * 2, 0)
  let cx = 0
  for (const t of trees) {
    cx += H_GAP
    assignX(t, cx)
    cx += t.w + H_GAP
  }

  // Calculate max depth
  function depth(n: TreeNode): number { return n.children.length ? 1 + Math.max(...n.children.map(depth)) : 0 }
  const maxDepth = Math.max(...trees.map(depth))
  const svgH = (maxDepth + 1) * (NODE_H + V_GAP) + 20
  const svgW = Math.max(totalW, 400)

  const allEdges = trees.flatMap(collectEdges)
  const allNodes = trees.flatMap(collectNodes)

  function doExport() {
    const svg = svgRef.current; if (!svg) return
    const str = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([str], { type: 'image/svg+xml' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'coverage-hierarchy.svg'; a.click()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">Coverage hierarchy</span>
        <Button variant="ghost" size="sm" onClick={doExport}><Download size={12} />SVG</Button>
      </div>
      <div className="overflow-x-auto">
        <svg ref={svgRef} width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} fill="none"
          xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: 'JetBrains Mono Variable, monospace' }}
        >
          {/* Connector lines */}
          {allEdges.map((e, i) => (
            <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke="rgba(192,38,211,.25)" strokeWidth={1.5} />
          ))}

          {/* Coverage nodes */}
          {allNodes.map(node => {
            const { cov } = node
            const dotColor = STATUS_DOT[cov.status] ?? '#8E90A0'
            return (
              <g key={cov.id}>
                <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H}
                  rx={8} fill="white" stroke="rgba(192,38,211,.2)" strokeWidth={1}
                  style={{ filter: 'drop-shadow(0 2px 6px rgba(192,38,211,.06))' }} />
                {/* Status dot */}
                <circle cx={node.x + NODE_W - 12} cy={node.y + 12} r={4} fill={dotColor} />
                {/* Name */}
                <text x={node.x + 10} y={node.y + NODE_H / 2 - 4} fontSize={9} fontWeight={600} fill="#131318"
                  style={{ fontSize: 9 }}>
                  {cov.name.replace('Coverage ', 'Cov ').substring(0, 22)}
                </text>
                {/* refId */}
                <text x={node.x + 10} y={node.y + NODE_H / 2 + 10} fontSize={8} fill="#8E90A0">
                  {cov.refId ?? cov.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ─── Health panel ─────────────────────────────────────────────────────────────

function HealthPanel({ navigate: nav }: { navigate: ReturnType<typeof useNavigate> }) {
  const { pid, coverages, rules, ratingProgram, ldTables, rtTables, formRules } = useProductCtx()
  const findings: Array<{ severity: 'error'|'warning'; message: string; route: string }> = []

  // 1. Coverages missing limit terms
  coverages.forEach(cov => {
    if (cov.premiumGenerating && !cov.terms?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no terms defined`, route: `/app/products/${pid}/coverages` })
    }
  })

  // 2. Rules referencing missing LD tables
  rules.forEach(rule => {
    if (rule.ldTableRef && !ldTables[rule.ldTableRef]) {
      findings.push({ severity: 'error', message: `Rule ${rule.refId} references missing LD table ${rule.ldTableRef}`, route: `/app/products/${pid}/rules` })
    }
  })

  // 3. Rating steps referencing missing RT tables
  ratingProgram?.steps?.forEach(step => {
    if (step.source.type === 'RT' && step.source.ref && !rtTables[step.source.ref]) {
      findings.push({ severity: 'error', message: `Rating step "${step.label}" references missing RT table ${step.source.ref}`, route: `/app/products/${pid}/pricing` })
    }
  })

  // 4. Optional coverages without an attachment rule
  coverages.filter(c => c.requirement === 'OPTIONAL').forEach(cov => {
    const hasRule = formRules.some(fr => fr.formNumbers?.some(fn => cov.formNumbers?.includes(fn)))
    if (!hasRule && cov.formNumbers?.length) {
      findings.push({ severity: 'warning', message: `${cov.name} has no form attachment rule`, route: `/app/products/${pid}/forms` })
    }
  })

  // 5. Coverages with zero states
  coverages.forEach(cov => {
    if (!cov.allStates && (!cov.states || cov.states.length === 0)) {
      findings.push({ severity: 'warning', message: `${cov.name} has no states configured`, route: `/app/products/${pid}/states` })
    }
  })

  const score = findings.length === 0 ? 100 : Math.max(0, 100 - findings.filter(f => f.severity === 'error').length * 20 - findings.filter(f => f.severity === 'warning').length * 5)
  const scoreColor = score >= 80 ? '#059669' : score >= 60 ? '#B45309' : '#DC2626'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold border-2"
          style={{ borderColor: scoreColor, color: scoreColor, background: `${scoreColor}12` }}>
          {score}
        </div>
        <div>
          <p className="text-sm font-semibold text-text">Health score</p>
          <p className="text-xs text-dim">{findings.length} finding{findings.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-good">
          <CheckCircle size={14} />No issues found
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {findings.map((f, i) => (
            <button key={i} onClick={() => nav(f.route)}
              className="flex items-start gap-2 text-left px-3 py-2 rounded-[8px] bg-raised hover:bg-[rgba(192,38,211,.04)] transition-colors text-sm">
              {f.severity === 'error'
                ? <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                : <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />}
              <span className="text-dim">{f.message}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Overview route ───────────────────────────────────────────────────────────

export default function ProductOverview() {
  const navigate = useNavigate()
  const { coverages, ratingProgram, loading, product } = useProductCtx()

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-5"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Left: hierarchy tree */}
      <Card className="lg:col-span-2">
        <HierarchyTree coverages={coverages} />
      </Card>

      {/* Right: health + stats */}
      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-3">Health</p>
          <HealthPanel navigate={navigate} />
        </Card>

        <Card>
          <p className="text-xs font-medium text-faint uppercase tracking-wide mb-3">Quick stats</p>
          <div className="flex flex-col gap-2 text-sm">
            {[
              { label: 'Rating steps', value: ratingProgram?.steps?.length ?? 0 },
              { label: 'Min premium',  value: ratingProgram?.minimumPremium ? `$${ratingProgram.minimumPremium.toLocaleString()}` : '—' },
              { label: 'Owner',        value: product?.owner?.name ?? '—' },
              { label: 'Market',       value: product?.marketSegment ?? '—' },
            ].map(s => (
              <div key={s.label} className="flex justify-between">
                <span className="text-dim">{s.label}</span>
                <span className="font-medium text-text">{s.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
