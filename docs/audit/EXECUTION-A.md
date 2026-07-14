# EXECUTION-A — Public surfaces (F1 · Lane A)

> Icon system · landing · share link · pricing. Shared checkout with a parallel
> agent — see [orchestration.md](../../orchestration.md). Lane A owns only the files
> listed under "Files this lane touches" below; everything else is off-limits.

**Started:** 2026-07-13 · **Branch:** `main` · **Budget envelope:** $12 (stop at 80%).

---

## Orientation (truth over docs — live code wins)

| Claim in the prompt | Reality found in the tree | Action |
|---|---|---|
| `AI_REVIEW.md` at root | Lives at `docs/AI_REVIEW.md` | Read it there. |
| `docs/orchestration.md` | Lives at repo-root `orchestration.md` | Followed its 5 rules. |
| "Build the easter egg" | **Already built** — `app/src/lib/perf/reportWebVitals.ts` (`_MA`/`_MB` base64 split, `atob` decode, `_CK` checksum gate, styled console card). Content is base64 → invisible to plain greps + bundle analysis. | **Verify, do not rebuild.** |
| "Resolve RISK-013" | **Already resolved** — `server/lib/sys-diag.js` banner is organizational-only (Accenture / Product Hub); personal acknowledgment moved to the browser egg. Wired at `server/server.js:56`. | **Verify, do not rebuild.** |
| "Remove the icon package if one exists" | No third-party icon dep exists — the app already ships a hand-drawn family in `app/src/components/ui/icons.tsx`. | Promote it to `components/icons/`, pre-cut F3 glyphs. |
| `HANDOFF.md` (egg spec) | Does not exist in the tree. | Egg spec inferred from the live implementation + `sys-diag.js` REQ-4/S4 note. |
| prefers-reduced-motion | Global guard already in `index.css` (collapses all animation/transition to 0.01ms). | New motion inherits the guard for free. |

## Files this lane touches

- `app/src/components/icons/**` (new registry) · `app/src/components/ui/icons.tsx` (→ re-export shim)
- `app/src/lib/pricing.ts` (new) · `app/src/lib/pricing.test.ts` (new)
- `app/src/routes/Pricing.tsx` (new) · `app/src/App.tsx` (add `/pricing` route)
- `app/src/routes/Landing.tsx` (nav + footer link, light refinement)
- `app/src/index.css` (only additive tokens/keyframes if strictly needed)
- Share seam (if reached): `server/lib/share.js` (new) + one mount line in `server/server.js` + `app/src/routes/SharedView.tsx` (new)
- `docs/audit/EXECUTION-A.md` · `orchestration.md` (own workstream row + deploy log)

## Budget log (/cost at milestones)

> NOTE: `/cost` is a user-run slash command; the agent cannot self-invoke it. Milestones
> are logged here by proxy so the human can reconcile against `/cost`.

| Milestone | Note |
|---|---|
| Orientation complete | Read orchestration, AI_REVIEW, landing, icons, pricing wiring, bundle budget, server banner. |

## Icon registry — full export list (`app/src/components/icons/index.tsx`)

93 named glyph exports (all hand-drawn, 24-grid, `currentColor`, `aria-hidden` by
default with an optional `title`; zero third-party icon deps app-wide). `components/ui/icons.tsx`
is now a `export * from '../icons'` shim, so the ~77 existing importers are untouched.

**8 added this lane** — `IconShare` (share surface) + the 7 F3 pre-cuts:
`IconAgent`, `IconStage`, `IconEscalate`, `IconVerify`, `IconReconcile`, `IconDisagreement`, `IconStream`.
F3 should import these from `components/icons`.

Full set: IconProduct, IconCoverage, IconLimit, IconDeductible, IconStates, IconForm,
IconPricing, IconRule, IconEndorsement, IconSingle, IconLayers, IconSplit, IconCombine,
IconScheduled, IconPercent, IconClock, IconPeril, IconCards, IconList, IconPlus, IconClose,
IconCheck, IconCheckCircle, IconCheckSquare, IconChevronRight, IconChevronDown, IconChevronUp,
IconSort, IconEdit, IconTrash, IconSearch, IconFilter, IconDownload, IconDrag, IconArrowUp,
IconArrowRight, IconTasks, IconInfo, IconBack, IconExpand, IconRefresh, IconRestore, IconArchive,
IconCopy, IconExternalLink, IconTable, IconUpload, IconCamera, IconMic, IconFile, IconFileCode,
IconFileSpreadsheet, IconFileClock, IconSpinner, IconStar, IconSparkle, IconWand, IconChat,
IconHome, IconExplorer, IconNews, IconChart, IconBook, IconSettings, IconSignOut, IconUser,
IconUserCheck, IconUserX, IconShield, IconKey, IconChevronLeft, IconRecent, IconIdea, IconBug,
IconHeart, IconLink, IconActivity, IconClipboard, IconUsers, IconWarning, IconAlertCircle,
IconEye, IconEyeOff, IconSun, IconMoon, **IconShare**, **IconAgent**, **IconStage**,
**IconEscalate**, **IconVerify**, **IconReconcile**, **IconDisagreement**, **IconStream**.

Plus the `IconType` type alias. Stroke default kept at **1.6** (the existing family's weight)
rather than the prompt's 1.5, to avoid a drive-by restroke of all 85 pre-existing glyphs.

## Wave plan

1. **Wave 1** (app-only, zero server collision): icons registry + F3 glyphs · pricing page + constants + ROI + test · landing `/pricing` nav + refinement · verify egg/banner. Gate → push.
2. **Wave 2** (if budget remains): share-link seam (server mint + public render route + client view). Gate → push.
