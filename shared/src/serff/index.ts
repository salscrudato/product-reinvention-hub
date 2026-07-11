// serff/ — Texas SERFF-ready bundle assembler + DOI reviewer lens.
// Exports all pure-TypeScript domain functions; server/lib/serff.js wires the
// Express router (Cosmos fetch + AI memo prose generation).
export * from './types'
export * from './redline'
export * from './rateExhibit'
export * from './memo'
export * from './bundle'
export * from './reviewer'
