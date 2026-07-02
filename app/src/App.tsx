// Top-level router — routes are lazy-loaded; auth guard at /app shell.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'

const Landing = lazy(() => import('./routes/Landing'))
const AppShell = lazy(() => import('./routes/AppShell'))
const ShareView = lazy(() => import('./routes/ShareView'))

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100svh', color: '#8E90A0', fontFamily: 'Inter, sans-serif' }}>Loading…</div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app/*" element={<AppShell />} />
          <Route path="/share/:token" element={<ShareView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
