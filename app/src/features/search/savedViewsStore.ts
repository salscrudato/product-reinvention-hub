// Saved views / presets — named filter combinations a user can recall ("My QA queue",
// "Unreviewed optional coverages"). Scoped per tab (e.g. "rules:<pid>") and namespaced
// per user so they don't leak across accounts on a shared machine.
//
// Storage: this uses localStorage keyed by uid. Saved views are a personal UI preference,
// not a governed insurance entity, so they deliberately do NOT flow through the audited
// mutate() envelope (which would emit audit + version + searchIndex events and require a
// firestore.rules migration for a new collection). The store is a thin abstraction so a
// Firestore-backed implementation can drop in later without touching callers. The URL is
// always the shareable artifact; saved views are quick-recall bookmarks on top of it.

import type { FilterState } from './facetTypes'

export interface SavedView {
  id:        string
  name:      string
  scope:     string
  state:     FilterState
  createdAt: number
}

const keyFor = (uid: string) => `pf.savedViews.${uid || 'anon'}`

function readAll(uid: string): SavedView[] {
  try {
    const raw = localStorage.getItem(keyFor(uid))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as SavedView[]) : []
  } catch {
    return []
  }
}

function writeAll(uid: string, views: SavedView[]): void {
  try { localStorage.setItem(keyFor(uid), JSON.stringify(views)) } catch { /* storage full / disabled — non-fatal */ }
}

export function listSavedViews(uid: string, scope: string): SavedView[] {
  return readAll(uid).filter((v) => v.scope === scope).sort((a, b) => a.name.localeCompare(b.name))
}

export function saveView(uid: string, scope: string, name: string, state: FilterState): SavedView {
  const all = readAll(uid)
  const trimmed = name.trim()
  // Overwrite a same-named view in this scope rather than duplicating it.
  const existing = all.find((v) => v.scope === scope && v.name.toLowerCase() === trimmed.toLowerCase())
  const view: SavedView = existing
    ? { ...existing, state, createdAt: Date.now() }
    : { id: `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name: trimmed, scope, state, createdAt: Date.now() }
  const next = existing ? all.map((v) => (v.id === existing.id ? view : v)) : [...all, view]
  writeAll(uid, next)
  return view
}

export function deleteView(uid: string, id: string): void {
  writeAll(uid, readAll(uid).filter((v) => v.id !== id))
}
