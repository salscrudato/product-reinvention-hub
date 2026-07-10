# Polling policy — Azure Cosmos read discipline (2026-07-10)

The app runs on Azure now; Cosmos has **no browser `onSnapshot`**, so the adapter's `subscribe()`
degrades to polling (`app/src/lib/backend/azure.adapter.ts`, "smart polling" block). Naive
fixed-interval polling turns every open tab into a permanent Cosmos read (and RU) drain. This
documents the policy and the before/after read volume.

## Closing answer

**On an idle tab left open an hour, how many Cosmos reads does this now issue versus before, and
where could a mutation still be slow to appear?**

- **Before:** a fixed **3,500 ms** interval per subscription, regardless of tab visibility →
  `3600 / 3.5 ≈ 1,029 reads/hour per subscription`. A Product workspace holds several live
  subscriptions at once (product doc + coverages + rules + forms + rating + tasks/presence), so an
  idle workspace issued on the order of **~6,000 Cosmos reads/hour doing nothing** — and re-rendered
  every 3.5 s even when the payload was identical.
- **After:**
  - **Backgrounded tab (the usual "left open an hour" case): 0 reads.** The Page Visibility guard
    stops every poller when `document.hidden`; on refocus each one does a single immediate fetch and
    resumes.
  - **Foreground but idle:** the interval backs off `3.5 → 5.6 → 9.0 → 14.3 → 22.9 → 30 s (cap)` as
    successive fetches come back unchanged, settling at **~120 reads/hour per subscription (~88%
    fewer)**. Identical payloads are no longer re-delivered, so idle re-renders drop to zero too.
  - So a workspace left open in a background tab drops from **~6,000 reads/hour → 0**; left visible
    and idle, from ~6,000 → ~720/hour.
- **Where a mutation can still be slow to appear:**
  1. A change made by **another user/session** while this tab sits **foreground-idle** appears on the
     next backed-off tick — **up to 30 s**. (`pokeAll()` only fires for *local* writes through this
     adapter, which snap back to the fast interval + an instant refetch immediately.)
  2. A change made anywhere while this tab is **hidden** is not seen until refocus (then an immediate
     fetch) — by design; a backgrounded tab intentionally shows nothing.
  3. There is no server push/ETag yet, so cross-session propagation latency is bounded by `POLL_MAX`
     (30 s), not instantaneous. See "Future" below.

## Policy (implemented)

| Lever | Behaviour |
|---|---|
| **Pause when hidden** | `visibilitychange` → `document.hidden` stops all pollers; refocus (`visibilitychange`/`window focus`) resets each to `POLL_MIN` and fetches immediately. |
| **Idle backoff** | Unchanged payload ⇒ `interval = min(interval × 1.6, POLL_MAX)`. Any change ⇒ reset to `POLL_MIN`. `POLL_MIN = 3500 ms`, `POLL_MAX = 30000 ms`. |
| **Post-mutation speedup** | `mutate` / `mutateBatch` / `vote` / `setNewsPins` call `pokeAll()` → every active poller resets to `POLL_MIN` and refetches at once, so a local write shows immediately. |
| **In-flight dedupe** | A poller never overlaps a fetch for its subscription (`inFlight` guard) — slow networks can't pile up requests. |
| **Stale-while-revalidate** | The last value per path is cached in memory; a new subscription to a known path paints it instantly (microtask), then revalidates. |
| **Change-gated delivery** | The callback fires only when the JSON snapshot actually changed (plus the first delivery), cutting wasted React renders on idle re-delivery. |

Optimistic concurrency is untouched: writes still carry `expectedRev`; a stale write gets a `409`
→ `MutationConflictError`. Presence heartbeats (`join`/`watch`) also skip while `document.hidden`.

## Future (not in this pass)

- **Conditional reads (ETag / `updatedAt` cursor).** The `/api/db` host would return `304`/empty when
  a collection's max `updatedAt` is unchanged, so even foreground-idle polls cost ~0 RU. Needs a
  server change (`server/lib/data.js`) — deferred to keep this pass client-only and behavior-neutral.
- **Server push (SSE/WebSocket) for cross-session freshness**, which would remove the ≤30 s
  foreground propagation ceiling entirely.
