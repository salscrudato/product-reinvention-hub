// CaptureContext — publishes "what the user is currently viewing" so the global feedback
// drawer (mounted at the shell, above any product workspace) can auto-attach the exact
// coverage / form / rule and its refId the user was looking at when they pressed ⌘..
//
// Two layers, resolved as `focus ?? base`:
//   • base  — the product + active tab, set once by the product workspace.
//   • focus — a specific in-view entity (an open coverage/form detail), set by that surface.
// A specific focus always wins; when neither is set the drawer falls back to the route label.
// Kept deliberately tiny (no data, just the pointer) so it never couples the drawer to a route.
import { createContext, useMemo, useState, type ReactNode } from 'react'

export interface ViewedEntity {
  /** Firestore path of the entity in view, e.g. `products/abc` or `products/abc/coverages/xyz`. */
  entityPath?: string
  /** The on-screen refId or ISO form number — the load-bearing chip echoed into the story. */
  refId?: string
  /** Human label for the surface, e.g. "Personal Home · Coverages" or "Dwelling". */
  label: string
}

interface CaptureContextValue {
  viewed:   ViewedEntity | null
  setBase:  (v: ViewedEntity | null) => void
  setFocus: (v: ViewedEntity | null) => void
}

const CaptureCtx = createContext<CaptureContextValue | null>(null)

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [base,  setBase]  = useState<ViewedEntity | null>(null)
  const [focus, setFocus] = useState<ViewedEntity | null>(null)
  // The setters from useState are stable, so publisher effects that depend on them never loop.
  const value = useMemo<CaptureContextValue>(
    () => ({ viewed: focus ?? base, setBase, setFocus }),
    [base, focus],
  )
  return <CaptureCtx value={value}>{children}</CaptureCtx>
}

export { CaptureCtx }
