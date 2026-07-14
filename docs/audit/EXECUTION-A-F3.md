# EXECUTION-A-F3 — Live agent visualizer + screen elevation (F3 · Lane A)

> Agent visualizer · StreamRenderer · screen pass · news images · collaboration UI.
> Shared checkout with parallel agents — see [orchestration.md](../../orchestration.md).
> **User directive mid-session: DO NOT PUSH** — all work lands as local commits only;
> deploy + live test deferred until the user releases the hold.

**Started:** 2026-07-13 · **Branch:** `main` · **Budget envelope:** $26 (stop at 80%).

---

## Orientation (truth over docs — live code wins)

| Claim in the prompt | Reality found in the tree | Action |
|---|---|---|
| `docs/orchestration.md` | Lives at repo-root `orchestration.md` (same as F1 found). | Followed there. |
| `AI_REVIEW.md` at root | Lives at `docs/AI_REVIEW.md`. | Read it there. |
| Precondition: F1 row done, icon registry exists | ✅ `public-surfaces (F1·A)` row is done; `app/src/components/icons/` has 93 glyphs incl. the 7 F3 pre-cuts. | Proceeded. |
| "Build StreamRenderer for Home + Claims" | **Already built** — `app/src/components/ai/StreamRenderer.tsx` ships per-block fade-in, citation hover cards, collapsible reasoning sections, coverage-comparison table headers, and hand-rolled SVG sparklines; consumed by `Home.tsx:291` and `Claims.tsx:113`. | **Verify, do not rebuild.** Zero server protocol changes confirmed. |
| "News images: every item pictured" | **Already built** — `News.tsx` `ArticleImage` renders real `image.url`/`imageUrl` when present, `onError` → deterministic token-gradient + category-glyph placeholder. | **Verify, do not rebuild.** See honesty note below. |
| "Presence avatars + conflict diff view" | **Already built** — `PresenceAvatars` + `ConflictDiffDialog` wired in `ProductWorkspace.tsx:213/265`; both covered by axe tests. | Verify, not rebuild. |
| "Extend axe to every modal + palette" | Axe already covers CommandPalette, UnifiedImportModal, PromoteDraftDialog, ConflictDiffDialog, DisagreementHeatmap, HomeCheck. | Extended with 2 AgentVisualizer cases (inline + expanded overlay dialog). |
| "gpt-5.1 decorrelation in stage 5" | Confirmed in code: `stage5-validate.js` runs VALIDATOR on gpt-5.1 (OpenAI), decorrelated from the Anthropic extractors. | Rendered explicitly (cross-provider badge + info hue). |
| Agent visualizer | **Did not exist** (no `AgentVisualizer`/"Watch the agents" anywhere). | **Built** — the flagship of this lane. |
| refreshNews server file | `server/lib/ai/refresh-news.js` — news is **AI-generated** with plausible publication-style slugs; there is **no real source image to fetch** (fetching og:image from fabricated URLs would 404 or mislead). | **Claimed but NOT edited.** Every item renders the deterministic license-safe SVG placeholder — the truthful degradation of "prefer real, else fallback". |
| HOLD: import-brain row in progress | Row still 🔄. | **Zero edits** to `server/lib/ai/unified-import.js`, `server/lib/import-brain/**`, fleet files, `server/server.js`. Visualizer consumes existing SSE events only; wanted additive fields recorded in my orchestration row. |

## Files this lane touched

- `app/src/import/AgentVisualizer.tsx` (new — flagship)
- `app/src/import/agentVisualizer.test.ts` (new — 8 reducer tests)
- `app/src/import/unifiedImportClient.ts` (client-side additive: forwards existing `json` SSE events + client receipt timestamps; existing consumers filter by `kind` and are untouched)
- `app/src/import/UnifiedImportModal.tsx` ("Watch the agents" opt-in toggle in the streaming pane; visualizer persists into the error pane with the stream error)
- `app/src/a11y.axe.test.tsx` (+2 cases)
- `app/src/index.css` (additive only: `viz-pulse`, `viz-ring` keyframes — both neutralised by the global reduced-motion guard)
- Elevation pass: `app/src/routes/Landing.tsx` (HeroSignIn eye-toggle `tabIndex={-1}` removed — the scoreboard's one flagged a11y follow-up), `app/src/lib/useLiveCollection.ts` (additive `retry()`), `app/src/routes/News.tsx`, `app/src/routes/Tasks.tsx`, `app/src/routes/Explorer.tsx` (subscribe-error → recoverable error states with Retry — the scoreboard's flagged "states 4.5" nit on all three)
- `orchestration.md` (row + log) · this ledger

## Agent visualizer — design + honesty contract

Renders **only** what the server already streams. Three event families detected from real
events (never assumed): **brain** (`brain:stage0..6` + `brain:*` json — workbooks/CSV via
server), **filing** (`filing:classify/extract:*/reconcile` — PDFs), **fallback**
(`extract:coverages`). Until the family is known, only the router stage renders.

| Rendered element | Source of truth |
|---|---|
| Stage status queued/thinking/done/error | `tool` events `phase: start/progress/end`; stream failure marks active stages error |
| Elapsed tickers | Client receipt timestamps of the real events (1s text tick, not motion) |
| Stage detail lines + stage-4 batch notes | `summary` on the live events (incl. `progress` phase) |
| Workbook identity (name, sheet count/names) | `brain:input` json |
| Validator findings panel | `brain:stage5` json (count + first 5, defensively mapped); full detail lands in the existing review DisagreementHeatmap |
| Output counts | `brain:output` json |
| Fleet telemetry table (calls, in/out tokens, USD per deployment, no-cap badge) | `brain:spend` / `import:spend` json — shown at run end, labelled as such |
| Degrade banner | Real `notice kind:'degrade'` event |
| Ensemble composition per stage (BULK/REASONER_A/REASONER_B/VALIDATOR/LADDER chips, provider hues, "cross-provider adversarial check" on stage 5) | The pipeline's **code configuration** (`server/lib/import-brain/*`), labelled in-UI as design, not observed activity |
| Edge pulses | One pulse per REAL received event (keyed by event count); idle rails are still |

**Not rendered (not in today's stream), recorded as wanted additive fields:** live
per-reasoner call activity, per-stage token subtotals, escalation-ladder fire events.
The escalation animation therefore never fires today — by design, since faking it would
violate "display only real events."

A11y: `aria-live="polite"` announcer for stage transitions; `prefers-reduced-motion`
swaps pulses/rings for a static stepper (double-guarded: component check + global CSS
guard); expanded view is a `role="dialog" aria-modal` overlay with Escape-to-close;
axe-clean in both forms.

Routing truth (recorded, not changed): pure-XLSX uploads short-circuit to the **local**
deterministic mapper (no SSE), so the brain constellation lights up for CSV/mixed
uploads; PDFs light the filing lane. Mid-run disconnects cannot resume (POST stream) —
the visualizer says so honestly and notes nothing was written.

## Screen elevation pass (user directive upgraded this from verification to elevation)

Baseline: `docs/ELEVATION_SCOREBOARD.md` — every surface already 4.65–4.95 after three
hostile passes + a dark-mode pass. Elevation therefore targeted the **explicitly flagged
residual defects** rather than churning reference-grade screens:

1. **Landing a11y (flagged follow-up confirmed REAL):** HeroSignIn password eye-toggle
   was `tabIndex={-1}` — keyboard-unreachable. Fixed (parity with the batch-1 `/sign-in`
   fix). Scoreboard's own note: this lifts Landing a11y → 5.
2. **News / Tasks / Explorer "states 4.5" (flagged on all three):** hard subscribe
   failures previously rendered an **infinite skeleton** (News/Tasks) or dead column
   (Explorer). All three now surface a recoverable error state with Retry, via
   `useLiveCollection` + a new additive `retry()`. Tasks' optimistic done-toggle was
   preserved through an override map (flip instant, rollback on failure).
3. **Feedback `●○○` text glyphs (flagged):** already replaced in the tree — verified, no
   change needed.
4. **Innovative accents:** the AgentVisualizer itself is the session's centerpiece —
   provider-hued agent chips (accent = Anthropic, info = OpenAI, faint = deterministic),
   breathing active-node ring, event-driven rail pulses, spend table with tabular
   numerals — all tokens, all hand-rolled SVG, dark-parity by construction.

## Gate & bundle

Gate green locally (typecheck · lint · full test suite incl. canaries · build; exit 0).
Bundle: the first budget run caught the visualizer pushing the **Builder** route chunk to
25.1/25 kB gz (Builder imports UnifiedImportModal). Fixed by lazy-loading the visualizer
(`React.lazy` — it's opt-in, so its code loads only when someone watches): Builder
25.1 → **20.4/25**, first-load critical JS 147.8 → **143.6/175**, CSS 17.8/25. Budget ✓.
Lesson recorded in orchestration.md: local `pnpm build` does NOT run the budget script —
run `node scripts/check-bundle-budget.mjs` explicitly before any push.

## Deploy + live test

**Deferred — user directive "DO NOT PUSH".** The prompt's live-test matrix (real workbook
import with visualizer open, escalation render, heatmap flow, tab-kill recovery, News
source-missing case, conflict diff, mobile viewport, both themes) remains open until the
push hold is lifted; the deterministic layers (reducer tests, axe, gate) are green locally.

## SELF-REVIEW LEDGER

**SSE event types consumed vs rendered:**

| Event | Consumed | Rendered |
|---|---|---|
| `tool brain:stage0..6 (start/progress/end)` | ✅ | ✅ stage states, details, notes, pulses |
| `json brain:input / stage5 / output / spend` | ✅ | ✅ identity, findings, counts, telemetry |
| `json brain:stage1..4` | ✅ forwarded | ➖ not rendered (payloads are internal shapes; counts already arrive via tool summaries — deliberate) |
| `tool filing:classify/extract:*/reconcile` | ✅ | ✅ filing lane |
| `tool extract:coverages` | ✅ | ✅ fallback lane |
| `notice (incl. degrade)` | ✅ | ✅ banner (existing NoticeBanner path untouched) |
| `json bundle` / `token` | ✅ (pre-existing) | review pane (unchanged) |
| `error` / `done` | ✅ (pre-existing) | error pane keeps the visualizer + failure point |
| `:hb` heartbeat comments | ❌ not visible — the adapter forwards only `data:` lines | honestly not rendered; disconnects surface via the stream promise rejection |

**Protocol changes:** **NONE** (client-only). No server file was edited at all — including
the claimed `refresh-news.js`. Wanted additive fields recorded in orchestration.md.

**Icon registry coverage:** visualizer uses only `components/icons` glyphs (IconAgent,
IconStage, IconVerify, IconReconcile, IconDisagreement, IconStream, IconSplit, IconTable,
IconCombine, IconWarning, IconCheckCircle, IconClose, IconExpand) — 6 of the 7 F3
pre-cuts in service (IconEscalate reserved for when escalation events exist). No new
third-party icons; app-wide dep count stays 0.

**Three hostile questions — where could the visualizer show something untrue?**

1. *Does the ensemble fan-out imply live per-model activity that isn't streamed?* Risk:
   yes if unlabelled. Mitigation: agent chips are static design labels; the in-UI
   footnote states "per-call activity inside a stage is not streamed"; chips carry no
   spinners or fake activity. Only the stage-level state animates, and only on real events.
2. *Could a stage show "done" that actually failed?* The stream's `error` event rejects
   the promise → active stages flip to **error**, never done; queued stages stay queued.
   A silent socket death surfaces the same way (fetch rejection). What it can't catch: a
   server that lies in its own events — out of client scope.
3. *Do the elapsed tickers/spend imply server-side precision they don't have?* Elapsed is
   client receipt time (labelled in the tooltip: "measured client-side from live events")
   — includes network jitter, honest as a wall-clock view. Spend is the pipeline's own
   telemetry event, shown only after it arrives and labelled "measured at run end".
   Nothing is extrapolated live.
