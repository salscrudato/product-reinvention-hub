// Overview — the product's EXECUTIVE REPORT. Full-width, reads as numbers →
// narrative → evidence: a deterministic vital-signs band (exact counts, each a
// shortcut into its tab), then a two-column spread — the AI product summary and
// editable details as the report body, with a visual rail alongside (the
// geographic-footprint choropleth and deterministic coverage-composition bars).
// The coverages themselves live on the Coverages tab, so this stays a clean
// boardroom read rather than a second coverage list. Generous bottom margin so
// the report never ends flush against the viewport.
import { useProductCtx } from '../../context/useProductCtx'
import { Skeleton } from '../../components/ui'
import { ProductVitals } from '../../components/product/ProductVitals'
import { ProductSummaryDashboard } from '../../components/product/ProductSummaryDashboard'
import { ProductDetailsCard } from '../../components/product/ProductDetailsCard'
import { FootprintPanel, CompositionPanel } from '../../components/product/OverviewInsights'

export default function ProductOverview() {
  const { loading } = useProductCtx()

  if (loading) {
    return (
      <div className="w-full flex flex-col gap-6 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-[92px] rounded-[14px]" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 flex flex-col gap-6">
            <Skeleton className="h-64 rounded-[16px]" />
            <Skeleton className="h-56 rounded-[16px]" />
          </div>
          <div className="flex flex-col gap-6">
            <Skeleton className="h-72 rounded-[16px]" />
            <Skeleton className="h-40 rounded-[16px]" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col gap-6 pb-20">
      {/* KPI band — deterministic vital signs, full report width */}
      <div className="rise-in" style={{ '--rise-delay': '0ms' } as React.CSSProperties}>
        <ProductVitals />
      </div>

      {/* Report spread: narrative + identity on the left, visuals on the right rail */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 flex flex-col gap-6 min-w-0">
          <div className="rise-in" style={{ '--rise-delay': '70ms' } as React.CSSProperties}>
            <ProductSummaryDashboard />
          </div>
          <div className="rise-in" style={{ '--rise-delay': '140ms' } as React.CSSProperties}>
            <ProductDetailsCard />
          </div>
        </div>

        <aside className="flex flex-col gap-6 min-w-0 xl:sticky xl:top-4" aria-label="Product visuals">
          <div className="rise-in" style={{ '--rise-delay': '110ms' } as React.CSSProperties}>
            <FootprintPanel />
          </div>
          <div className="rise-in" style={{ '--rise-delay': '180ms' } as React.CSSProperties}>
            <CompositionPanel />
          </div>
        </aside>
      </div>
    </div>
  )
}
