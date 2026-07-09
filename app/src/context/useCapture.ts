// useCapture — separate file satisfies the react/only-export-components rule.
import { useContext } from 'react'
import { CaptureCtx } from './CaptureContext'

export function useCapture() {
  const ctx = useContext(CaptureCtx)
  if (!ctx) throw new Error('useCapture must be used inside CaptureProvider')
  return ctx
}
