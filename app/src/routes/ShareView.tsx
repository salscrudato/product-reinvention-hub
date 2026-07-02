// Public share view — renders a read-only product snapshot by token (Prompt N).
import { useParams } from 'react-router-dom'

export default function ShareView() {
  const { token } = useParams<{ token: string }>()
  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100svh', fontFamily: 'Inter, sans-serif', color: '#5B5C6B' }}>
      <p>Share view for token <code style={{ fontFamily: 'JetBrains Mono, monospace', background: '#F3F3F8', padding: '2px 6px', borderRadius: 4 }}>{token}</code> — coming soon.</p>
    </main>
  )
}
