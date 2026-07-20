import { IconShield } from '../components/ui/icons'

export default function Claims() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-24">
      <IconShield size={40} className="text-faint" />
      <div>
        <h1 className="text-lg font-semibold text-text">Claims Analysis</h1>
        <p className="text-sm text-dim mt-1">Coming soon.</p>
      </div>
    </div>
  )
}
