// Authenticated app shell — sidebar nav, ⌘K palette, auth gate (Prompt 3).
// Placeholder until the full shell is built.
import { Routes, Route } from 'react-router-dom'

export default function AppShell() {
  return (
    <div style={{ minHeight: '100svh', background: '#F7F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#5B5C6B' }}>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8E90A0', marginBottom: 8 }}>APP SHELL</p>
        <p>Auth + navigation scaffold coming in Prompt 3.</p>
      </div>
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </div>
  )
}
