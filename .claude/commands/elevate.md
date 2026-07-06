---
description: Critique-then-fix one surface against the 10-axis elevation rubric.
argument-hint: <surface> — e.g. Home, Explorer, "Product › Pricing"
---

Elevate a single surface to the design North Star: **$ARGUMENTS**.

Keep the run cheap and deterministic — load **only** what this surface needs, in this order:

1. `docs/ELEVATION_PROMPT.md` — the persona ("Vesper"), the mandated changes (§8–§10) and
   the **§11 ten-axis rubric + recursive loop**. This is the spec; follow §11 exactly.
2. The route + its components for **$ARGUMENTS** only (find them under `app/src/routes/…`
   and `app/src/components/…`; use the route map in `app/CLAUDE.md`).
3. `docs/BASELINE_AUDIT.md` — the scored baseline for **$ARGUMENTS** (its current per-axis
   scores and the named, file-cited gaps to close).
4. Only the domain docs the surface actually touches: `docs/DOMAIN_HO.md` and/or
   `docs/DATA_MODEL.md`. Skip the rest.
5. `app/CLAUDE.md` for the design tokens, adapter seam, and component conventions.

Then run the §11 loop for this **one** surface: critique against the 10 axes
(**L**ayout · **T**ypography · **S**pacing · **C**olor/depth · **M**otion ·
**I**conography/SVG · **A**ffordance · **St**ates · **D**omain-truth · **A11y**),
score each 1–5 (accept only ≥ 4.5), then **rebuild to hit the bar** (restructure, don't
just restyle).

Guardrails (never violate): the adapter seam — no `firebase/*` in app code; every write via
`adapter.db.mutate()`; roles enforced in rules **and** Functions; grounded AI in Functions
only; **no hard-coded hex** (use the tokens in `app/src/index.css`); no `lucide-react`;
preserve refIds / form numbers; keep **$1,528** correct. (See `docs/adr/`.)

Finish: run `/gate`; drive the changed flow against the emulators (`pnpm spinup`); do a
hostile self-review as a senior designer + engineer and fix what you find; then make one
small, gate-green local commit for this surface. Do **not** push or deploy.
