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
| Wave 1 built + gated | Icons registry, /pricing + ROI + test. Gate green (typecheck, lint, 919+186 tests, build, bundle 147.6/175). |
| Wave 1 shipped | `677d748` pushed (fast-forward, carried admin/auth `8c17381`); pipeline **succeeded**; live smoke green. |
| Budget line reached | Heavy session (large orientation reads + multiple gate/build runs). Per the $12 rule: finished the current wave, recorded the share design as the remainder, stopping before a second security-sensitive build+deploy cycle. |

## Live verification (dev — smoke level)

`https://app-prodhub-dev.azurewebsites.net`

- `GET /` → 200; `GET /pricing` → 200 (SPA route resolves).
- Deployed `index-*.js` references `Pricing-BhKepTqv.js`; that chunk is 200 and carries my
  content ("ILLUSTRATIVE — PENDING COMMERCIAL APPROVAL", "Model the value", "Priced on the value").
- Egg chunk `reportWebVitals-*.js`: base64 payload present, **zero plaintext personal-name leak**.
- **Not** covered by this smoke: interactive light/dark/mobile walkthrough and live ROI-slider
  recompute in a real browser. ROI math is covered by 12 unit tests (bands locked); the recompute
  is pure client React that builds + serves. A full manual walkthrough was deferred at the budget line.

## Share-link seam — disposition + token shape (recorded for F6)

**Disposition: ABSENT.** Grep across app + server for `shareLink|share-link|/api/share|publicShare|shareToken|signedToken|/s/` → **zero hits**. No share surface exists today. The build was **deferred at the budget boundary** (security-sensitive public token endpoints reading Cosmos demand their own careful build + live-test cycle; shipping them un-verified in the shared dev env would risk exactly the cross-tenant leak F6 exists to catch). The complete, minimal-correct, attackable design is recorded here so F6 can build + attack it.

**Token shape** — opaque, URL-safe, stateless-verifiable:
```
share_v1.<payloadB64url>.<sigB64url>
payload = { v:1, t:<tenantId>, b:<base>, id:<entityId>, exp:<unixSeconds>, jti:<rand>, scope:'read' }
sig     = HMAC-SHA256(<payloadB64url>, SHARE_SIGNING_SECRET)   // server-only secret in App Service config
```

**Endpoints**
- `POST /api/share` — auth + `product:write` (EDITOR+). Body `{ base, id }`. **`t` is forced to `req.auth.tenantId`, never client-supplied** → no cross-tenant mint. Returns `{ token, url:'/s/<token>', expiresAt }`.
- `GET /api/share/:token` — **public** (a GET passes the auth floor). Verifies sig → exp → not-revoked, then reads exactly one entity by the `${t}|${b}` partition key + `id`, returns a read-only projection (internal/audit fields stripped). Any verify failure → **404** (no oracle). **Zero write surface.**
- `POST /api/share/:token/revoke` — auth + `product:write`, same tenant. Adds `jti` to the revocation set.

**Revocation store** — minimal = in-memory `Set` (dev). ⚠️ Not durable across restarts; production must back it with a create-only Cosmos `shareRevocations` doc keyed by `jti` (through the mutate envelope). Flagged for F6.

**Client** — public `/s/:token` route (`SharedView.tsx`) calls `GET /api/share/:token` and renders a premium read-only card in the landing's visual language (Aurora, `Logo`, `var(--color-*)` tokens, `IconShare`), with **zero edit affordances and zero adapter writes**.

**Isolation guarantees (F6 attack matrix)** — forged sig; swapped `t` in payload (sig fails); expired `exp`; revoked `jti`; `id` from another tenant (partition-key miss → not found); path traversal in `base`/`id`; replay after revoke. All must 404, never leak, never write.

## Self-review ledger

**Icon inventory — before → after:** third-party icon deps **0 → 0** (already clean; nothing to remove). In-house glyphs **85 → 93** (registry promoted to `components/icons/`; `ui/icons.tsx` → re-export shim; +`IconShare` +7 F3 pre-cuts). Full export list above.

**Share-link seam disposition:** ABSENT → design recorded (above), build deferred at budget line.

**Pricing constants list (`lib/pricing.ts`, ILLUSTRATIVE):** `PLATFORM_TIERS` (Launch/Scale/Enterprise annual bands), `AI_USAGE` (overage $/1M), `SERVICES` (Strategy/Mobilize/AI Run figures), `TRANSFORMATION` (program-priced), `COMMERCIAL_LAYERS` (4), `ROI_BANDS` (25–35% / 10–15% / 15–20%), `ROI_DEFAULTS`, `ROI_SLIDERS`, `computeRoi`, formatters. No client/pipeline/engagement names anywhere.

**Three hostile questions I asked of my own work:**
1. *Does the ROI headline double-count?* No — headline = OpEx efficiency only; speed + onboarding stay in weeks, never dollarized+summed. Locked by a unit test (`headline annual value equals OpEx savings only`).
2. *Did I regress the 85 existing glyphs by "moving" them?* No — the move was a byte-for-byte `cp` + a `export *` shim; typecheck + 919 tests + build all green; no glyph path edited; bundle critical JS 147.6/175 (unused new glyphs tree-shake to ~0).
3. *Did I trample the parallel landing rewrite?* No — I detected its uncommitted rewrite, reverted my one stray import, never touched `Landing.tsx` again, and turned the required landing→/pricing link into an explicit cross-lane ask in `orchestration.md`.

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
