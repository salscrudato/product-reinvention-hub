// Feedback context — lets any page publish the entity the user is viewing so the
// ⌘. quick-capture pre-links feedback to the exact coverage, form or rule.
import { createContext, useContext, useEffect } from 'react'

export interface FeedbackEntity { entityPath?: string; refId?: string; label?: string }

interface FeedbackCtxValue {
  entity:      FeedbackEntity | null
  setEntity:   (c: FeedbackEntity | null) => void
  openCapture: () => void
}

export const FeedbackContext = createContext<FeedbackCtxValue | null>(null)

/** Open the quick-capture sheet from anywhere. */
export function useFeedback(): FeedbackCtxValue {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider')
  return ctx
}

/** Register (and auto-clear) the entity in view so captured feedback links to it. */
export function useFeedbackEntity(entity: FeedbackEntity | null): void {
  const ctx = useContext(FeedbackContext)
  useEffect(() => {
    if (!ctx) return
    ctx.setEntity(entity)
    return () => ctx.setEntity(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, entity?.entityPath, entity?.refId, entity?.label])
}
