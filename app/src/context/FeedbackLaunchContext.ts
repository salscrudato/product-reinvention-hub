// FeedbackLaunchContext — lets any surface open the global feedback drawer PREFILLED and run
// the normal shape → review → submit flow. FeedbackProvider (mounted at the shell) provides the
// value; the Claims coverage-gap → "Create product feedback" action is the first caller. Kept in
// its own file so FeedbackProvider satisfies react/only-export-components.
import { createContext } from 'react'
import type { FeedbackType } from '@pf/shared'

/** A prefilled capture: seeds the feedback box (`note` — first line becomes the title) and the
 *  attached context, optionally forces the shaped story's type, and fires `onSubmitted` with the
 *  created feedback id after a successful submit (so the caller can render a "Linked feedback" chip). */
export interface FeedbackPrefill {
  note:    string
  /** Force the shaped story's type (e.g. a coverage gap is always an IDEA). */
  type?:   FeedbackType
  context?: {
    label?:          string
    route?:          string
    entityPath?:     string
    refId?:          string
    baseFormNumber?: string
    matchedProductId?: string
  }
  onSubmitted?: (feedbackId: string) => void
}

export interface FeedbackLaunchValue {
  openFeedback: (prefill: FeedbackPrefill) => void
}

export const FeedbackLaunchCtx = createContext<FeedbackLaunchValue | null>(null)
