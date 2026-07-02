// Home — dashboard placeholder; will show health scores, activity feed, quick actions.
import { LayoutDashboard } from 'lucide-react'
import { EmptyState } from '../components/ui'
import { Button } from '../components/ui/Button'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={<LayoutDashboard size={32} />}
      title="Your workspace"
      description="A live dashboard of product health, recent changes and quick access to active filings — coming in the next prompt."
      action={<Button variant="primary" size="sm" onClick={() => navigate('/app/products')}>View Products</Button>}
    />
  )
}
