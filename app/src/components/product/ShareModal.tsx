// Share modal — calls createShareLink function, shows URL + copy button.
import { useState } from 'react'
import { Copy, Check, ExternalLink, Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { adapter } from '../../lib/backend'

interface Props { onClose: () => void; productId: string; productName: string }

export function ShareModal({ onClose, productId, productName }: Props) {
  const [token,   setToken]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [error,   setError]   = useState('')

  const shareUrl = token ? `${window.location.origin}/share/${token}` : null

  async function handleCreate() {
    setLoading(true); setError('')
    try {
      const result = await adapter.fns.call<{ productId: string }, { token: string }>(
        'createShareLink', { productId },
      )
      setToken(result.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open title={`Share "${productName}"`} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-dim">
          Share links create a read-only public snapshot of this product that expires in 30 days.
        </p>

        {!token ? (
          <Button variant="primary" onClick={handleCreate} disabled={loading}>
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Creating link...' : 'Create share link'}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
              <span className="flex-1 text-xs font-mono text-dim truncate">{shareUrl}</span>
              <button onClick={handleCopy} className="text-faint hover:text-accent transition-colors" title="Copy link">
                {copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
              </button>
              <a href={shareUrl!} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-accent transition-colors" title="Open">
                <ExternalLink size={14} />
              </a>
            </div>
            <p className="text-xs text-faint">Link expires in 30 days. Anyone with the link can view this product.</p>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
