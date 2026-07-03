// ErrorBoundary — catches render-time crashes and shows a calm, plain-language
// recovery screen (never a raw stack) with a way forward. React error boundaries
// must be class components; this is the one intentional class in the app.
import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Surface for local debugging; never rendered to the user.
    console.error('[ErrorBoundary]', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-svh flex items-center justify-center bg-page p-6">
        <div className="max-w-md w-full bg-surface rounded-[16px] p-8 flex flex-col items-center text-center gap-4"
          style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <div className="w-12 h-12 rounded-[14px] flex items-center justify-center" style={{ background: 'var(--gradient-accent-soft)' }}>
            <AlertTriangle size={22} className="text-accent" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-text">Something went wrong</h1>
          <p className="text-sm text-dim leading-relaxed">
            This page hit an unexpected error. Your data is safe — reload to try again,
            or head back to your workspace.
          </p>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 h-9 rounded-[10px] text-white text-sm font-semibold transition-transform hover:scale-[1.02] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ background: 'var(--gradient-accent)', boxShadow: '0 1px 3px var(--glow-accent)' }}
            >
              Reload page
            </button>
            <a
              href="/app"
              className="inline-flex items-center px-4 h-9 rounded-[10px] bg-raised text-text text-sm font-medium hover:bg-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Back to home
            </a>
          </div>
        </div>
      </div>
    )
  }
}
