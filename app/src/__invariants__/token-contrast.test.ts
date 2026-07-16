/* Token contrast gate — WCAG 2.2 AA, both themes, enforced from the token source.
 *
 * The axe component tests disable jsdom's `color-contrast` rule and point at a
 * "separate" palette check; this file IS that check, automated. It parses
 * `app/src/index.css` (the single design-token source of truth) and derives the
 * chip / badge / status-pill / metadata foreground-on-surface matrix
 * PROGRAMMATICALLY from the token names — no copied pair list that can drift:
 *
 *   - ink tiers (text / dim / faint) on every surface (page/surface/raised/hover)
 *     and on the `--color-chip` count-badge wash composited over each badge host;
 *   - every semantic family `--color-X` that ships a `-soft` / `-badge` /
 *     `-hover` / `-press` companion wash (accent, good, warn, danger, info,
 *     stage-warm, stage-cool today; any future family joins automatically):
 *     X as plain text on every surface, and X on each of its washes composited
 *     over the real badge hosts (page/surface/raised);
 *   - every `--color-on-X` ink over its solid `--color-X` fill (on-accent today);
 *   - white ink over each stop of the theme-stable `--gradient-accent` /
 *     `--gradient-accent-vivid` fills (components render Tailwind `text-white`
 *     on these — white is a literal there, not a token);
 *   - `--color-gtm-phase-ink` over the two light GTM ramp phases documented to
 *     carry on-bar ink labels (phase-1 / phase-2);
 *   - `--color-accent` over `--fill-glass` composited on the page (the Landing
 *     insight-graph / coverage node letters).
 *
 * Chips, badges, pills and metadata all render at 10–13px medium — normal text —
 * so every text pair must clear 4.5:1. Non-text status indicators (dots,
 * sparklines) reuse the same foregrounds on the same surfaces, so the 4.5:1
 * assertions subsume their 3:1 graphic requirement.
 *
 * Pure fs + arithmetic: node environment, zero network, zero DOM.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(dir, '../index.css'), 'utf8');

// ── Parsing ──────────────────────────────────────────────────────────────────

type Rgba = { r: number; g: number; b: number; a: number };

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `--name: value;` declaration inside blocks opened by `selector {`. */
function declsFor(selectorRe: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`${selectorRe.source}\\s*\\{([^}]*)\\}`, 'g');
  for (const block of stripped.matchAll(re)) {
    for (const d of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      out.set(d[1], d[2].trim());
    }
  }
  return out;
}

function parseColor(value: string): Rgba | null {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
  return null;
}

// Light = the `@theme` block plus every top-level `:root` block; dark = the
// `html[data-theme="dark"]` overrides cascading over light.
const lightDecls = new Map([
  ...declsFor(/@theme/),
  ...declsFor(/:root/),
]);
const darkDecls = declsFor(/html\[data-theme="dark"\]/);

function theme(overrides: Map<string, string>): Map<string, Rgba> {
  const merged = new Map([...lightDecls, ...overrides]);
  const out = new Map<string, Rgba>();
  for (const [name, value] of merged) {
    const c = parseColor(value);
    if (c) out.set(name, c);
  }
  return out;
}

const themes = {
  light: theme(new Map()),
  dark: theme(darkDecls),
} as const;

/** Hex stops of a gradient token (theme-stable — defined once in `:root`). */
function gradientStops(token: string): Rgba[] {
  const value = lightDecls.get(token) ?? '';
  return [...value.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => parseColor(m[0])!);
}

// ── WCAG math ────────────────────────────────────────────────────────────────

const over = (fg: Rgba, bg: Rgba): Rgba => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

function luminance({ r, g, b }: Rgba): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Contrast of (possibly translucent) fg composited over an opaque bg. */
function contrast(fg: Rgba, bg: Rgba): number {
  const l1 = luminance(over(fg, bg));
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Pair derivation ──────────────────────────────────────────────────────────

const SURFACES = ['color-page', 'color-surface', 'color-raised', 'color-hover'] as const;
const BADGE_HOSTS = ['color-page', 'color-surface', 'color-raised'] as const;
const INK_TIERS = ['color-text', 'color-dim', 'color-faint'] as const;
const WASH_SUFFIXES = ['soft', 'badge', 'hover', 'press'] as const;
const AA_NORMAL_TEXT = 4.5;
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

type Pair = { label: string; fg: Rgba; bg: Rgba };

function pairsFor(themeName: keyof typeof themes): Pair[] {
  const t = themes[themeName];
  const get = (name: string): Rgba => {
    const c = t.get(name);
    if (!c) throw new Error(`token --${name} missing from ${themeName} theme`);
    return c;
  };
  const host = (name: (typeof SURFACES)[number]): Rgba => {
    const c = get(name);
    if (c.a !== 1) throw new Error(`surface --${name} must be opaque`);
    return c;
  };

  const pairs: Pair[] = [];

  // 1. Ink tiers on every surface, and on the chip wash over each badge host.
  for (const ink of INK_TIERS) {
    for (const s of SURFACES) pairs.push({ label: `${ink} on ${s}`, fg: get(ink), bg: host(s) });
    for (const h of BADGE_HOSTS) {
      pairs.push({ label: `${ink} on color-chip@${h}`, fg: get(ink), bg: over(get('color-chip'), host(h)) });
    }
  }

  // 2. Semantic families: any --color-X with a -soft/-badge/-hover/-press wash.
  // Text foregrounds are opaque by construction; a translucent base (e.g.
  // color-border, whose -hover companion is a stroke weight, not a wash) is a
  // stroke/wash itself and never carries text.
  const families = new Set<string>();
  for (const name of t.keys()) {
    for (const suffix of WASH_SUFFIXES) {
      const base = name.endsWith(`-${suffix}`) ? name.slice(0, -(suffix.length + 1)) : null;
      if (base && base.startsWith('color-') && t.get(base)?.a === 1) families.add(base);
    }
  }
  expect([...families].sort()).toContain('color-accent'); // derivation sanity
  for (const base of [...families].sort()) {
    // Ink tiers and surfaces participate in rule 1; `-hover` on a *surface* token
    // would be a surface, not a wash — none exist today, the guard is the t.has().
    if ((INK_TIERS as readonly string[]).includes(base)) continue;
    if ((SURFACES as readonly string[]).includes(base)) continue;
    for (const s of SURFACES) pairs.push({ label: `${base} on ${s}`, fg: get(base), bg: host(s) });
    for (const suffix of WASH_SUFFIXES) {
      const wash = t.get(`${base}-${suffix}`);
      if (!wash) continue;
      for (const h of BADGE_HOSTS) {
        pairs.push({ label: `${base} on ${base}-${suffix}@${h}`, fg: get(base), bg: over(wash, host(h)) });
      }
    }
  }

  // 3. Every on-X ink over its solid X fill.
  for (const name of t.keys()) {
    const m = /^color-on-(.+)$/.exec(name);
    if (m && t.has(`color-${m[1]}`)) {
      pairs.push({ label: `${name} on color-${m[1]}`, fg: get(name), bg: over(get(`color-${m[1]}`), host('color-surface')) });
    }
  }

  // 4. White ink over each vivid gradient fill stop (theme-stable fills).
  for (const grad of ['gradient-accent', 'gradient-accent-vivid']) {
    const stops = gradientStops(grad);
    expect(stops.length).toBeGreaterThan(0);
    stops.forEach((stop, i) => pairs.push({ label: `white on ${grad} stop ${i}`, fg: WHITE, bg: stop }));
  }

  // 5. GTM on-bar ink over the two documented light ramp phases.
  for (const phase of ['color-gtm-phase-1', 'color-gtm-phase-2']) {
    pairs.push({ label: `color-gtm-phase-ink on ${phase}`, fg: get('color-gtm-phase-ink'), bg: over(get(phase), host('color-surface')) });
  }

  // 6. Accent letters on the glassy node fill (Landing insight graph).
  pairs.push({ label: 'color-accent on fill-glass@page', fg: get('color-accent'), bg: over(get('fill-glass'), host('color-page')) });

  return pairs;
}

// ── The gate ─────────────────────────────────────────────────────────────────

describe('design-token contrast (WCAG 2.2 AA, enumerated from index.css)', () => {
  it('parses a plausible token set from the source of truth', () => {
    expect(lightDecls.size).toBeGreaterThan(40);
    expect(darkDecls.size).toBeGreaterThan(20);
    expect(themes.light.get('color-page')).toBeTruthy();
    expect(themes.dark.get('color-page')).toBeTruthy();
    // The two themes must actually differ (dark override block is live).
    expect(themes.light.get('color-page')).not.toEqual(themes.dark.get('color-page'));
  });

  for (const themeName of ['light', 'dark'] as const) {
    it(`${themeName}: every chip/badge/status/metadata pair clears ${AA_NORMAL_TEXT}:1`, () => {
      const failures: string[] = [];
      const pairs = pairsFor(themeName);
      expect(pairs.length).toBeGreaterThan(60); // matrix sanity — derivation stays live
      for (const { label, fg, bg } of pairs) {
        const ratio = contrast(fg, bg);
        if (ratio < AA_NORMAL_TEXT) failures.push(`${label}: ${ratio.toFixed(2)}:1`);
      }
      expect(failures, `pairs below ${AA_NORMAL_TEXT}:1 in ${themeName} theme:\n${failures.join('\n')}`).toEqual([]);
    });
  }
});
