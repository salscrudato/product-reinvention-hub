// Route chunk prefetch helpers — call prefetchRoute(importFn) on hover or
// IntersectionObserver to warm the module before the user navigates.
const prefetched = new Set<string>()

export function prefetchRoute(key: string, importFn: () => Promise<unknown>): void {
  if (prefetched.has(key)) return
  prefetched.add(key)
  // requestIdleCallback so prefetches never block user interaction.
  const schedule = typeof requestIdleCallback !== 'undefined'
    ? (fn: () => void) => requestIdleCallback(fn, { timeout: 2000 })
    : (fn: () => void) => setTimeout(fn, 0)
  schedule(() => void importFn().catch(() => prefetched.delete(key)))
}
