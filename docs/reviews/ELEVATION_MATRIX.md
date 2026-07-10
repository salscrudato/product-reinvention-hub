# ELEVATION_MATRIX.md — the four-state completeness matrix

Established **2026-07-10** by reading live code (companion to `GROUND_TRUTH.md` V11 →
this session's dark-mode + a11y elevation). One row per user-facing surface; the four
columns are the states every data surface owes the user:

- **LOADING** — a *skeleton* that previews the shape of the content, not a bare spinner.
- **EMPTY** — an invitation to act, with the primary action **inline** and **role-aware**
  (EDITOR/ADMIN see the create affordance; VIEWER gets a read-only explanation).
- **ERROR** — *what happened* **and** *how to recover* — never vague, never a silent
  degrade-to-empty.
- **POPULATED** — the real content.

Legend: ✅ shipped · ⚠️ partial/weak · ❌ missing · n/a not applicable.

## The systemic ERROR finding (root cause)

`adapter.db.subscribe()` (`app/src/lib/backend/firebase.adapter.ts`) catches listener
errors, logs `console.warn`, and **degrades to `[]` (collections) / `null` (documents)**.
Any surface that only checks `Array.isArray(d)` therefore **cannot distinguish "empty" from
"failed"** — the subscribe-error is swallowed. Only three surfaces surface a load error
today: **Dictionary** and **Home rail** (via `useLiveCollection`'s awaited `list()` probe),
and **Feedback** (a try/catch around subscribe *setup*). This is the single weakest axis and
the scoreboard has flagged it for many sessions ("subscribe-error not surfaced").

**Remedy adopted this session:** `subscribe()` gains an optional 3rd `onError` argument
(backward-compatible — existing 2-arg callers unaffected). The two highest-value surfaces wire
it now: the **Products** hub (a recoverable "Couldn't load products / Retry" `EmptyState`) and
the **product workspace** (`ProductContext` flags a load-bearing product-doc error → the
workspace shows "Couldn't load this product / Retry / Products" instead of hanging on the
skeleton or silently redirecting). Explorer / Tasks / Builder can adopt the same one-line
`onError` hook as a mechanical follow-up (the adapter + pattern now exist).

## Matrix

| # | Surface | Route / file | LOADING | EMPTY (role-aware) | ERROR | POPULATED | Highest-leverage fix |
|---|---|---|:--:|:--:|:--:|:--:|---|
| 1 | Products grid | `routes/Products.tsx` | ✅ skeleton | ✅ (label "Go to Builder") | ❌→✅ | ✅ | Surface subscribe-error; make empty action read "Create a product" |
| 2 | Product › Overview | `routes/product/ProductOverview.tsx` | ✅ skeleton | n/a | ❌→✅ | ✅ | Workspace error via ProductContext |
| 3 | Product › Coverages | `routes/product/ProductCoverages.tsx` | ✅ skeleton | ✅ ("Add coverage") | ❌→✅ | ✅ | Workspace error |
| 4 | Product › Forms | `routes/product/ProductForms.tsx` | ⚠️ 1 block | ⚠️ not role-aware | ❌→✅ | ✅ | Shaped skeleton + role-aware empty |
| 5 | Product › Pricing | `routes/product/ProductPricing.tsx` | ✅ skeleton | ⚠️ bespoke | ✅ eval-error | ✅ | (Eval error already good) |
| 6 | Product › States | `routes/product/ProductStates.tsx` | ✅ skeleton | n/a (registry) | ❌→✅ | ✅ | Workspace error |
| 7 | Product › Rules | `routes/product/ProductRules.tsx` | ⚠️ 1 block | ⚠️ **no inline "Draft rule"** | ❌→✅ | ✅ | **Inline "Draft rule" in empty state** |
| 8 | Explorer | `routes/Explorer.tsx` | ✅ skeleton | ✅ (read-only browser) | ❌ (hook available) | ✅ | Adopt `onError` (follow-up) |
| 9 | Tasks | `routes/Tasks.tsx` | ✅ skeleton | ✅ ×2 (project / board) | ❌ (hook available) | ✅ | Adopt `onError` (follow-up) |
| 10 | News | `routes/News.tsx` | ✅ skeleton | ✅ (ADMIN→Refresh, others→settings) | ⚠️ | ✅ | (Empty matches prompt) |
| 11 | Feedback | `routes/Feedback.tsx` | ✅ skeleton | ⚠️ lane text | ✅ retryable banner | ✅ | (Error already good) |
| 12 | Data Dictionary | `routes/Dictionary.tsx` | ✅ skeleton | ✅ ("New field") | ✅ useLiveCollection | ✅ | Reference surface |
| 13 | Claims | `routes/Claims.tsx` | ✅ skeleton | ✅ + hero + starters | ⚠️ stream ✅ / load ❌ | ✅ | (Stream/AI status → workstream G) |
| 14 | Home | `routes/Home.tsx` | ✅ skeleton (rail) | ✅ hero + rail | ✅ rail error | ✅ | Reference surface |
| 15 | Admin (5 tabs) | `routes/Admin.tsx` | ✅ skeleton | ✅ (Users ⚠️) | ⚠️ folded into empty | ✅ | Live breaker state (workstream G) |
| 16 | Builder / Drafts | `routes/Builder.tsx` | ✅ skeleton | ✅ role-aware | ❌ (hook available) | ✅ | Adopt `onError` (follow-up) |
| 17 | Filing import | `components/product/FilingImportModal.tsx` | ⚠️ progress by design | n/a (role gate ✅) | ✅ "Try again" | ✅ | AI notice level honesty (workstream G) |

Additional user-facing surfaces from the scoreboard (Landing, Sign-in, Must-Change-Password,
Command palette) are static/auth/utility surfaces with no data-fetch state matrix and are
covered by the theming + a11y workstreams, not here.

## What this session changes (worst surfaces first)

1. **Product › Rules** — add an **inline, role-aware "Draft rule"** action to the empty state
   (EDITOR/ADMIN only; VIEWER keeps the read-only explanation). Closes the one prompt-named
   EMPTY gap. *(workstream D)*
2. **Product › Forms** — replace the single `h-64` block with a **shaped master-detail
   skeleton**, and make the empty state **role-aware** (EDITOR is told forms come from seeding
   or base-form extraction). *(workstream D)*
3. **Products** — the empty EDITOR action reads **"Create a product"** (routing to Builder,
   the real create path) so the label states what it does. *(workstream D)*
4. **subscribe-error surfacing** — `adapter.db.subscribe` gains an optional `onError`;
   **Products** and the **product workspace** (`ProductContext`) render a recoverable
   `EmptyState` ("Couldn't load … Check your connection or permissions and try again." + Retry)
   instead of a silent empty / infinite spinner. Explorer / Tasks / Builder can adopt the same
   hook as a mechanical follow-up. *(workstream D)*
5. **AI surfaces** (Claims load, Admin breaker, RuleBuilder/Scaffold/Filing notices) — handled
   in **workstream G** (honest AI status), not duplicated here.

Copy discipline held throughout: labels say what the control does, sentence case, one job per
element, verbs consistent within a flow ("Create a product", "Draft rule", "Add coverage",
"Retry").
