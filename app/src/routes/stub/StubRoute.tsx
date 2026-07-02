// Stub component for routes not yet built — displays a premium empty state.
import { EmptyState } from '../../components/ui'
import type { LucideIcon } from 'lucide-react'

interface StubProps { title: string; description: string; icon: LucideIcon }

export function StubRoute({ title, description, icon: Icon }: StubProps) {
  return <EmptyState icon={<Icon size={32} />} title={title} description={description} />
}
