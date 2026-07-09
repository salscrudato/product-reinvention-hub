# Brand mark — “Greater Ascent”

The Product Reinvention Hub brand mark. A play on the Accenture **greater-than**: a bold
`>` chevron tipped into an upward **ascent** — the forward, “greater” vector — aimed at a
**crescent moon** resting in the corner. The quiet twist is a rocket to the moon: the
chevron reads as a thrust vector / vapour trail climbing toward its destination.
Confident, modern, Apple-restrained — a transparent glyph with no container.

Open [`icon-preview.html`](./icon-preview.html) for the full contact sheet (every size /
variant on light and dark).

## Construction grid

- **Canvas:** `viewBox="0 0 32 32"`.
- **Chevron:** a greater-than of two equal arms (length **12**) meeting at a vertex, drawn
  as one round-capped **stroke of 3.5**. It leans **~22°** into liftoff — the vertex points
  up-and-right at `(17.6, 15.4)`; the arms open down-left to `(5.69, 13.94)` and
  `(10.05, 24.73)`.
- **Moon:** a crescent (radius **3.15**) in the upper-right, centred near `(24.4, 7.4)`,
  its concave opening cradling the incoming ascent — the rocket arriving at the moon.
- **Safe area:** keep clear space of ≥ 25% of the mark height around it. For maskable icons
  the mark is scaled to **0.82** about the centre so it sits inside the 80% safe zone under
  any launcher mask.

## Colour

The chevron stroke and the moon share **one gradient** sampled from the brand violet
(top-left → bottom-right = light → deep):

| Stop | Token (components) | Hex (assets) |
|------|--------------------|--------------|
| 0    | `--color-accent-bright` | `#A100FF` |
| .55  | `--color-accent`        | `#8B1FE0` |
| 1    | `--color-accent-strong` | `#7A00E6` |

On the **opaque OS/PWA tiles** (deep near-black field) the gradient lifts to a brighter top
stop (`#B65CFF`) and the moon is painted a light violet (`#E9C6FF`) so it reads as a glowing
destination; a soft radial glow sits behind the moon. The mark also holds in **one flat
colour** — the mono / white / black variants carry the chevron at full weight and the moon
at `0.85` opacity for a touch of depth.

## Files

| File | Use |
|------|-----|
| `mark.svg` | Master glyph — full-colour gradient, transparent |
| `mark-mono.svg` | `currentColor`, transparent (recolour via `color`) |
| `mark-white.svg` / `mark-black.svg` | One-colour, transparent |
| `app-icon.svg` | OS/PWA icon — mark on a deep near-black squircle, glow behind the moon |
| `lockup.svg` | Horizontal lockup: mark + “Product Factory” wordmark |
| `alt-monogram.svg`, `alt-aperture.svg` | Alternate directions considered (not shipped) |
| `icon-preview.html` | Contact sheet |

The served copies live in [`/app/public`](../../public): `favicon.svg` (transparent),
`icon.svg` + `icon-maskable.svg` (opaque OS tiles), and `icon-512.png` / `og-card.png`
(rasterised from the SVGs with headless Chromium — re-run if the SVGs change). The in-app
mark is [`../components/ui/Logo.tsx`](../components/ui/Logo.tsx); the full in-house glyph
family lives in [`../components/ui/icons.tsx`](../components/ui/icons.tsx).

## Rules

- **Component code is token-driven** (`var(--color-accent-*)`) — no raw hex. These
  standalone `.svg` asset files and the `/public` icons are the documented exception: they
  carry the literal brand hex as the canonical definition (SVG serialised to disk can’t use
  CSS vars).
- **Transparent by default.** The only marks with a filled field are the OS/PWA icons,
  because launchers require an opaque background.
- **Don’t** add a box/tile behind the in-app mark, recolour outside the violet family,
  straighten the chevron flat or over-tilt it past a gentle lean, or detach the moon from
  the upper-right corner (it must read as the ascent’s destination, not a stray dot).

## Naming note

The lockup spells the product name **“Product Factory”** (matching the repo’s `@pf/…`
package alias), per the brand brief. The running app currently still displays
**“Product Reinvention Hub”** in the UI and metadata; that in-app copy was left unchanged
(this task is presentational). Reconcile the two when the product name is finalised.
