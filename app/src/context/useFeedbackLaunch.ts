// useFeedbackLaunch — read the feedback-drawer launcher. Returns null when no FeedbackProvider
// is mounted (callers guard), so a surface can render the "Create product feedback" affordance
// only when the drawer is actually available.
import { useContext } from 'react'
import { FeedbackLaunchCtx } from './FeedbackLaunchContext'

export function useFeedbackLaunch() {
  return useContext(FeedbackLaunchCtx)
}
