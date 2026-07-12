// shared/src/import/index.ts — unified ingestion service types barrel.
export * from './types'
// Canonical field dictionary (grounding data for the model-driven mapper) + the pure
// offline validation scorer (precision/recall/F1, refId-exactness, parentId integrity,
// enum conformance, silent drops).
export * from './canonicalMap'
export * from './validateAgainstExpected'
// Structural extraction layer — deterministic StructuralModel + pure shaping helpers.
export * from './structure'
