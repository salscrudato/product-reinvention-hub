# Screenshots — Claims Analysis

Live captures of the Claims Analysis route (`/app/claims`), taken against the deployed Azure host
(`app-prodhub-dev`, `testco` tenant, authenticated as `SUPER_ADMIN`). These are the same images that
ship in the external `review-packet/` (routes `19-claims`), copied here so the dossier is self-contained.

| File | Theme | State shown |
|---|---|---|
| `claims-analysis.light.png` | Light | Pre-selection empty state |
| `claims-analysis.dark.png`  | Dark  | Pre-selection empty state |

## What the capture shows

The **pre-selection empty state** — the view before a base form is chosen:

- **Left pane — Base forms library.** The upload drop-zone (drag-drop / _Upload base form_, "PDF or text",
  EDITOR/ADMIN only) sits above the list. Two seeded forms are present, both `Ready`:
  - **HOMEOWNERS 3 – SPECIAL FORM** — form-number chip `HO 00 03 10 00`, line chip `HO`, `ed. 10 00`.
  - **PP_00_01_06_98.pdf** — form-number chip `PP 00 01`, line chip `PA`, `ed. 06 98`.
  These illustrate the two ends of identification: a clean official title vs. a filename-titled upload,
  each with its detected line and edition.
- **Right pane — conversation hero.** The animated shield + voice-wave SVG, the headline
  _"Describe a loss to check coverage"_, and the sub-line _"Speak or type in plain English — every
  determination cites the exact coverage, limit and exclusion it relied on."_
- **Composer (bottom).** Disabled until a form is selected — placeholder _"Select a base form on the left
  to begin"_, hint _"Select a base form to start a coverage conversation"_. A microphone affordance
  (voice input) is visible at the right edge.
- **Chrome.** Sidebar with **Claims Analysis** active under the INTELLIGENCE group; tenant switcher
  ("Test Company"); light/dark toggle.

## States not captured here (described in the dossier)

The live seed capture is the empty state. The following states are documented in
[../06-FRONTEND.md](../06-FRONTEND.md) and [../01-OVERVIEW.md](../01-OVERVIEW.md):

- **Selected-form context header** — shield glyph, form title, `RefChip` form number, line chip, and an
  `Unverified` chip when the catalogue couldn't confirm the number.
- **Line-aware quick starters** — one-tap loss scenarios sourced from the selected form's line profile
  (e.g. HO offers _"A pipe burst and flooded the kitchen"_).
- **A streaming turn** — honest tool-status chips (_Reading the policy… → Loading portfolio context →
  Analyzing claim coverage_) then the streamed answer.
- **The `DeterminationCard`** — verdict emblem + plain-language headline (Covered / Not covered / Partially
  covered / Not addressed), 3-sentence summary, **Why**, **Things to consider**, **Document citations**
  (accordion), **Limits & deductibles**, **Data citations** (refId chips), and — on a coverage gap — the
  **Create product feedback** action.

## Re-capturing

The capture harness is `review-packet/capture-current-state.mjs` (Playwright, walks all routes in light +
dark, injects a bearer token into `localStorage['pf.azure.token']`). See the review-packet README for the
bootstrap-credentials flow. To refresh these images, re-run that harness and copy `19-claims.*.png` here.

---

Related: [../README.md](../README.md) · [../01-OVERVIEW.md](../01-OVERVIEW.md) · [../06-FRONTEND.md](../06-FRONTEND.md)
