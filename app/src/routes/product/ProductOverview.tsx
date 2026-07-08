// Overview — a focused, at-a-glance read of the product. It reads top-to-bottom as
// numbers → narrative → identity: a deterministic vital-signs strip (exact counts, each a
// shortcut into its tab), then the AI product summary centrepiece (headline, key facts,
// coverage highlights, considerations), then the editable product details. The coverages
// themselves live on the Coverages tab, so this stays a clean executive view rather than a
// second coverage list.
import { useProductCtx } from '../../context/useProductCtx'
import { Skeleton } from '../../components/ui'
import { ProductVitals } from '../../components/product/ProductVitals'
import { ProductSummaryDashboard } from '../../components/product/ProductSummaryDashboard'
import { ProductDetailsCard } from '../../components/product/ProductDetailsCard'

export default function ProductOverview() {
  const { loading } = useProductCtx()

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-[92px] rounded-[14px]" />)}
        </div>
        <Skeleton className="h-64 rounded-[16px]" />
        <Skeleton className="h-56 rounded-[16px]" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <div className="rise-in" style={{ '--rise-delay': '0ms' } as React.CSSProperties}>
        <ProductVitals />
      </div>
      <div className="rise-in" style={{ '--rise-delay': '70ms' } as React.CSSProperties}>
        <ProductSummaryDashboard />
      </div>
      <div className="rise-in" style={{ '--rise-delay': '140ms' } as React.CSSProperties}>
        <ProductDetailsCard />
      </div>
    </div>
  )
}
