// theme.ts — light/dark theme resolution, persistence and a React binding.
//
// The app is LIGHT by default with a DARK toggle. Precedence:
//   1. the persisted preference in localStorage (`pf.theme`), else
//   2. the OS `prefers-color-scheme` (first-run default).
// The no-FOUC inline script in index.html applies `data-theme` BEFORE paint using the
// same precedence; this module is the single source of truth for reading/flipping it
// at runtime. Components never read this — they consume the CSS tokens, which the
// `data-theme` attribute re-casts (see the dark block in index.css).
import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'pf.theme'
const EVENT = 'pf:themechange'

const colorSchemeMedia = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function systemTheme(): Theme {
  return colorSchemeMedia()?.matches ? 'dark' : 'light'
}

export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

/** The theme currently applied to the document (set pre-paint by the inline script). */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/**
 * Apply a theme to <html>. Persists by default; a system-driven change passes
 * `persist:false` so it doesn't pin the preference. Animates a short cross-fade unless
 * the user prefers reduced motion.
 */
export function applyTheme(theme: Theme, { persist = true, animate = true }: { persist?: boolean; animate?: boolean } = {}) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (animate && !prefersReducedMotion()) {
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), 340)
  }
  root.setAttribute('data-theme', theme)
  // Browser-chrome colour comes from the --chrome-color token (set per theme in index.css) so
  // no colour literal lives here; read AFTER setting data-theme so it reflects the new theme.
  const chrome = getComputedStyle(root).getPropertyValue('--chrome-color').trim()
  if (chrome) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome)
  if (persist) {
    try { localStorage.setItem(KEY, theme) } catch { /* private mode — session only */ }
  }
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function setTheme(theme: Theme) { applyTheme(theme) }
export function toggleTheme() { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark') }

// ── React binding ────────────────────────────────────────────────────────────
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  const media = colorSchemeMedia()
  // While the user hasn't pinned a preference, keep following the OS live.
  const onSystem = () => { if (!storedTheme()) applyTheme(systemTheme(), { persist: false }) }
  media?.addEventListener?.('change', onSystem)
  return () => {
    window.removeEventListener(EVENT, onChange)
    media?.removeEventListener?.('change', onSystem)
  }
}

/** `[theme, toggle]` — re-renders on any theme change (toggle, or live OS change). */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme)
  return [theme, toggleTheme]
}
