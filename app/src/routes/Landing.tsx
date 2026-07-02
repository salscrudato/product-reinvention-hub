// Public landing page — aurora + SVG hierarchy showcase (Prompt 3).
// Placeholder until the full landing is built.
export default function Landing() {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100svh', gap: 16, fontFamily: 'Inter, sans-serif', background: '#F7F7FA' }}>
      <h1 style={{ fontSize: 36, fontWeight: 600, color: '#131318', margin: 0, background: 'linear-gradient(135deg, #C026D3, #EC4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        Product Factory
      </h1>
      <p style={{ color: '#5B5C6B', margin: 0 }}>AI-native insurance product management</p>
      <a href="/app" style={{ marginTop: 8, padding: '10px 24px', borderRadius: 14, background: 'linear-gradient(135deg, #C026D3, #EC4899)', color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
        Open app →
      </a>
    </main>
  )
}
