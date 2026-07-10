// Conflict-recovery toast — raised on MutationConflictError so the user has two explicit
// actions instead of a silent dead-end: "Reload latest" re-reads the entity into the open
// editor (no silent auto-retry that could clobber the other editor), and "Discard" dismisses.
// Callers supply callbacks appropriate to the editing context.
import { toast } from 'sonner'

/**
 * Show a conflict toast with Reload latest / Discard actions.
 *
 * @param reload  Re-reads the entity into the open editor and updates local form state.
 *                Omit when the call site has no open editor (e.g. a cascade delete).
 * @param discard Close / dismiss without reloading (default: toast auto-dismissal).
 */
export function conflictToast(opts: {
  reload?: () => void | Promise<void>
  discard?: () => void
}): void {
  const id = toast.error(
    'This record was modified by another editor.',
    {
      duration: Infinity,  // keep visible until the user chooses
      ...(opts.reload
        ? {
            action: {
              label: 'Reload latest',
              onClick: () => {
                toast.dismiss(id)
                void opts.reload!()
              },
            },
          }
        : {}),
      cancel: {
        label: 'Discard',
        onClick: () => {
          toast.dismiss(id)
          opts.discard?.()
        },
      },
    },
  )
}
