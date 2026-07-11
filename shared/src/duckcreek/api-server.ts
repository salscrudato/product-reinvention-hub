// duckcreek/api-server.ts — entry point for the server-side CJS bundle of the DuckCreek
// module. Compiled by scripts/build-server-duckcreek.mjs to server/lib/duckcreek-shared.cjs.js.
// Contains only what the REST endpoints need: no seed data, no rating engine, no rules engine.
// Run `pnpm build:duckcreek` whenever the shared DuckCreek source changes.
export { buildPdm } from '../pdm/build'
export type { DomainProductBundle } from '../pdm/build'
export type { PdmProduct } from '../pdm/types'

export { serializePdmToDuckCreek } from './serialize'
export { validateDuckCreek, summarizeReport } from './validate'
export type { ValidationReport } from './validate'

export {
  DEFAULT_DUCKCREEK_MAPPING,
  composeManuscriptId,
  composeManuscriptVersionId,
  composeTableManuscriptIdForScope,
} from './mapping'
export type { DuckCreekMapping, DcLayerKey } from './mapping'

// LOB_REGISTRY — used server-side to resolve the LobDefinition from a product's lob.refId.
export { LOB_REGISTRY } from '../insurance/lobRegistry'
export type { LobDefinition } from '../insurance/lobRegistry'
