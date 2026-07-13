// api-server.ts — server-facing entry for the AI fleet registry.
//
// Bundled to CommonJS at server/lib/fleet-shared.cjs (see `pnpm build:fleet`) so the Azure
// Express host (plain CJS, no TS build step) can consume the SAME fleet registry, deployment
// names, and pricing as the rest of the monorepo. This keeps `fleet.ts` the SINGLE SOURCE OF
// TRUTH for Foundry deployment names in production — no hardcoded model strings in server/lib.
//
// Mirrors the shared/src/serff/api-server.ts bridge convention.
export * from './fleet'
