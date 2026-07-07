// Overview — a focused, at-a-glance read of the product. The AI product summary is
// the centrepiece (headline, key facts, coverage highlights, considerations); the
// coverages themselves live on the Coverages tab, so this stays a clean executive
// view rather than a second coverage list.
import { useProductCtx } from '../../context/useProductCtx'
import { Skeleton } from '../../components/ui'
import { ProductSummaryDashboard } from '../../components/product/ProductSummaryDashboard'

export default function ProductOverview() {
  const { loading } = useProductCtx()

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-[14px]" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <ProductSummaryDashboard />
    </div>
  )
}
