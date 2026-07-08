# Brand mark — “Composed Stack”

The Product Reinvention Hub brand mark. Three precisely aligned plates descending through
the brand violet: the composed, versioned **parts** of an insurance product (coverages,
forms, rules, rating) stacked into one **governed whole**. Layers read as composition +
versioning; the shared centre axis reads as precision and governance. Flat, calm,
Apple-restrained — a transparent glyph with no container.

Open [`icon-preview.html`](./icon-preview.html) for the full contact sheet (every size /
variant on light and dark).

## Construction grid

- **Canvas:** `viewBox="0 0 32 32"`, optical centre `(16, 16)`.
- **Plate:** an isometric diamond, ~2.2 : 1 (half-width 7, half-height 3.2), corners
  softened with a ~1.4-unit quadratic round.
- **Stack:** three plates on the centre axis, centres at `y = 8.4 / 16 / 23.6` — an even
  **1.2-unit gap** between plates.
- **Safe area:** the glyph lives within `x ∈ [9, 23]`, `y ∈ [5.2, 26.8]`. Keep clear space
  of ≥ 25% of the mark height around it. For maskable icons the stack is scaled to **0.9**
  so it sits inside the 80% safe zone under any launcher mask.

## Colour

Three tones sampled from the canonical brand gradient (top → bottom = light → deep):

| Plate | Token (components) | Hex (assets) |
|------|--------------------|--------------|
| Top   | `--color-accent-bright` | `#A100FF` |
| Middle| `--color-accent`        | `#8B1FE0` |
| Bottom| `--color-accent-strong` | `#7A00E6` |

It also holds in **one flat colour** — the mono / white / black variants carry the layer
depth with opacity (`1 / 0.72 / 0.5`).

## Files

| File | Use |
|------|-----|
| `mark.svg` | Master glyph — full colour, transparent |
| `mark-mono.svg` | `currentColor`, transparent (recolour via `color`) |
| `mark-white.svg` / `mark-black.svg` | One-colour, transparent |
| `app-icon.svg` | OS/PWA icon — stack on a deep near-black squircle |
| `lockup.svg` | Horizontal lockup: mark + “Product Factory” wordmark |
| `alt-monogram.svg`, `alt-aperture.svg` | Alternate directions considered (not shipped) |
| `icon-preview.html` | Contact sheet |

The served copies live in [`/app/public`](../../public): `favicon.svg` (transparent),
`icon.svg` + `icon-maskable.svg` (opaque OS tiles), and `icon-512.png` / `og-card.png`
(rasterised from the SVGs with Playwright — re-run if the SVGs change). The in-app mark is
[`../components/ui/Logo.tsx`](../components/ui/Logo.tsx).

## Rules

- **Component code is token-driven** (`var(--color-accent-*)`) — no raw hex. These
  standalone `.svg` asset files and the `/public` icons are the documented exception: they
  carry the literal brand hex as the canonical definition (SVG serialised to disk can’t use
  CSS vars).
- **Transparent by default.** The only marks with a filled field are the OS/PWA icons,
  because launchers require an opaque background.
- **Don’t** add a box/tile behind the in-app mark, recolour outside the violet family, skew
  the plates off the centre axis, or reintroduce drop-shadows on the transparent glyph.

## Naming note

The lockup spells the product name **“Product Factory”** (matching the repo’s `@pf/…`
package alias), per the brand brief. The running app currently still displays
**“Product Reinvention Hub”** in the UI and metadata; that in-app copy was left unchanged
(this task is presentational). Reconcile the two when the product name is finalised.
