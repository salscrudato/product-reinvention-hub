# EXECUTION — R0 · Customer Experience Wave (7 surfaces)

> Lane: **cx-wave (R0)** · Started 2026-07-14 · Budget envelope $30 (/cost logged at milestones)
> Directive: **DO NOT PUSH** — build + gate + commit locally; push/deploy/live-verify only on user go.

## Scope (from prompt R0)

1. **Home** — Feedback → Platform panel (redirects kept); right pane collapsible (default collapsed, persisted); grounded AI task summary (MID_REASONER, cited task refIds, session-cached); StreamRenderer typographic upgrade; waveform loader replaces spinners; Ctrl+F/Ctrl+K search overlay replaces persistent bar.
2. **Products** — whole-card click, section chips deep-link, kebab w/ confirm, fuzzy search + highlight + keyboard, filter pills compose.
3. **Explorer** — headers w/ counts, selected-state, breadcrumb sync, keyboard legend, filter-all-panes.
4. **Tasks** — modal scroll/sticky fixes; seed-button root cause + self-explaining disabled; editable per-task SLA in review (forward-only recompute); board pass.
5. **News** — 5-day REAL backfill via existing agent path (idempotent, tenant-scoped); og:image → (image role only if a real deployment exists — **none does**, verified in fleet.ts) → branded gradient; blob persist + cache headers.
6. **Claims** — verdict-first structure on shared StreamRenderer upgrades; capped verdict; collapsible depth.
7. **Import** — warnings first-class panel; collapsible entity groups + virtualization (1,707 entities); write phase live stream + largest-safe batch chunking inside the atomic envelope (before/after timing recorded here); filing agent constellation (real events only).

## Fleet facts (verified)

- `MID_REASONER` = `claude-sonnet-5` exists in `shared/src/ai/fleet.ts` + `server/lib/fleet.js`.
- No image-generation-capable deployment exists in foundry-prodhub-dev (opus, sonnet, haiku, gpt-5.1, gpt-5-mini, text-embedding-3-small). Per prompt ("IF one exists"), news images = og:image fetch → branded gradient; no fabricated role/deployment added.

## Cost log

| When | Milestone | /cost |
|---|---|---|
| start | orientation + exploration fan-out | (logged at first wave commit) |

## Wave log

| Wave | Sha | Gate | Notes |
|---|---|---|---|

## Deferred-to-go (live) checklist

- [ ] Push waves → pipeline green → dev deploy
- [ ] Home walk: collapsed pane default, Ctrl+F overlay, task summary cites real refIds, waveform during real stream
- [ ] Products search + card actions; Explorer keyboard walk
- [ ] Create project → seed with edited SLA defaults → board arrival → idempotent re-seed
- [ ] News: run 5-day backfill (one curation run per past day, real articles only), verify pictures + premium feed
- [ ] Claims: new format on a real loss description
- [ ] One real workbook import + one real filing PDF upload in an **isolated tenant (never testco)** watching agent view; record 1,707-item write before/after wall time here
- [ ] Console clean; canaries exact; teardown
