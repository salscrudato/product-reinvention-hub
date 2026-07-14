// icons.tsx — back-compat re-export. The canonical icon registry now lives in
// `app/src/components/icons`. This shim keeps the many existing `../ui/icons`
// importers working unchanged; prefer importing from `components/icons` in new code.
// Re-exporting named members preserves tree-shaking (Rollup/Vite shakes through
// `export *` — only the glyphs a chunk imports ship in that chunk).
//
// This barrel defines no components of its own, so it does not affect React Fast
// Refresh; the rule can't see through `export *`, hence the targeted disable.
// eslint-disable-next-line react/only-export-components
export * from '../icons'
