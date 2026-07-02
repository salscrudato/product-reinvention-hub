// Products list — will show product cards with health indicators and lifecycle badges.
import { Package } from 'lucide-react'
import { EmptyState, Button } from '../components/ui'

export default function Products() {
  return (
    <EmptyState
      icon={<Package size={32} />}
      title="Product catalog"
      description="Browse, create and manage insurance products. Each product tracks coverages, pricing rules, forms and multi-state approvals."
      action={<Button variant="primary" size="sm">New product</Button>}
    />
  )
}
