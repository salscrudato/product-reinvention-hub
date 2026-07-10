/*
 * HOSTILE SELF-REVIEW — required per spec:
 *
 * Q: "If a reviewer claims this registry just hardcodes seven lines rather than making
 *     ANY line registerable data-first, which specific types, factories, and fixtures
 *     prove them wrong, and where is the one place a new line would still require a
 *     code change rather than a data change?"
 *
 * A: The reviewer is wrong on four counts:
 *
 *  1. TYPES (lines/types.ts) define a CLOSED VOCABULARY for any P&C line as pure data:
 *     LineArchetype + LineFamily + ExposureBase + TriggerType + LineLimitStructure +
 *     AggregatePattern + RatingStageArchetype + DocumentRoleFingerprint + TranslationRecipe.
 *     These 9 types cover every known P&C programme structure. A new line is registerable
 *     by writing data values into these types — no new type is needed.
 *
 *  2. FACTORY (ratingKit.ts: ratingKitGenerator) converts ANY LineArchetype instance into
 *     a working RatingKit (RT getter + LD getter + inputSpec) using genericRtLookup +
 *     makeLdGetter — zero line-specific code. resolveRatingKit() (kits.ts) now falls back
 *     to ratingKitGenerator(archetype) for any line in LINE_INTELLIGENCE_REGISTRY that
 *     lacks a bespoke kit, so NO change to kits.ts is needed for a new line.
 *
 *  3. FIXTURES (__fixtures__/*.golden.ts) — 17 self-contained archetype instances + RT/LD
 *     tables + worked examples cover: Homeowners, Personal Auto, Dwelling, Personal Umbrella,
 *     Inland Marine, Flood, General Liability, Commercial Property, Commercial Auto, Workers
 *     Comp, BOP, Commercial Package, Cyber, D&O/EPL, Professional Liability, Crime, and
 *     Commercial Excess/Umbrella. Each auto-derives a verified canary via ratingKitGenerator
 *     without any line-specific code. (lineIntelligence.canary.test.ts wires them all.)
 *
 *  4. REGISTRY (this file) is driven by data: LINE_INTELLIGENCE_REGISTRY is a plain
 *     Record<string, LineArchetype> keyed by lobRefId. resolveLineArchetype(lobRefId) and
 *     resolveLineArchetypeByFamily(family) give the importer two stable lookup paths.
 *     Registering a NEW line is: (a) add a LobDefinition to LOB_REGISTRY (data), (b) add
 *     a LineArchetype here (data), (c) add a fixture file (data + a canary number).
 *
 *  THE ONE PLACE A NEW LINE STILL REQUIRES A CODE CHANGE:
 *     When a rating step's table-lookup logic is NON-SIMPLE — specifically when a single
 *     RatingStep must combine multiple table lookups OR multiply a lookup result by an input
 *     value within the SAME step (as the production GL PCO step does: pcoRate × pcoExposureThousands)
 *     — genericRtLookup cannot express this compound computation. That case requires a bespoke
 *     makeRtGetter override registered in kits.ts. The generic path covers everything that
 *     resolves to a single-row RT lookup per step; compound steps need code.
 */

// lines/registry.ts — the Line Intelligence Registry.
// Exports one LineArchetype per P&C family and a complete LINE_INTELLIGENCE_REGISTRY map.
// Also augments the existing LOB_REGISTRY entries (PH, PA, GL) with their lineIntelligence
// field via a side-effectful mutation (no circular import: lobRegistry.ts imports only the
// TYPE from lines/types.ts; this file imports the mutable LOB objects and populates them).
// Pure TypeScript; zero platform imports.
import type { LineArchetype } from './types'
import { PH_LOB, PA_LOB, GL_LOB } from '../insurance/lobRegistry'

// Re-export all archetype instances from the fixture files so callers can import them
// directly from the registry without reaching into the fixtures directory.
export { HOMEOWNERS_ARCHETYPE }           from './__fixtures__/homeowners.golden'
export { PERSONAL_AUTO_ARCHETYPE }        from './__fixtures__/personalAuto.golden'
export { DWELLING_ARCHETYPE }             from './__fixtures__/dwelling.golden'
export { PERSONAL_UMBRELLA_ARCHETYPE }    from './__fixtures__/personalUmbrella.golden'
export { INLAND_MARINE_ARCHETYPE }        from './__fixtures__/inlandMarine.golden'
export { FLOOD_ARCHETYPE }                from './__fixtures__/flood.golden'
export { GENERAL_LIABILITY_ARCHETYPE }    from './__fixtures__/generalLiability.golden'
export { COMMERCIAL_PROPERTY_ARCHETYPE }  from './__fixtures__/commercialProperty.golden'
export { COMMERCIAL_AUTO_ARCHETYPE }      from './__fixtures__/commercialAuto.golden'
export { WORKERS_COMP_ARCHETYPE }         from './__fixtures__/workersComp.golden'
export { BOP_ARCHETYPE }                  from './__fixtures__/bop.golden'
export { COMMERCIAL_PACKAGE_ARCHETYPE }   from './__fixtures__/commercialPackage.golden'
export { CYBER_ARCHETYPE }                from './__fixtures__/cyber.golden'
export { MANAGEMENT_LIABILITY_ARCHETYPE } from './__fixtures__/managementLiability.golden'
export { PROFESSIONAL_LIABILITY_ARCHETYPE } from './__fixtures__/professionalLiability.golden'
export { CRIME_ARCHETYPE }                from './__fixtures__/crime.golden'
export { EXCESS_UMBRELLA_ARCHETYPE }      from './__fixtures__/excessUmbrella.golden'

// Import the concrete archetype instances to build the registry and augment the LOBs.
import { HOMEOWNERS_ARCHETYPE }           from './__fixtures__/homeowners.golden'
import { PERSONAL_AUTO_ARCHETYPE }        from './__fixtures__/personalAuto.golden'
import { DWELLING_ARCHETYPE }             from './__fixtures__/dwelling.golden'
import { PERSONAL_UMBRELLA_ARCHETYPE }    from './__fixtures__/personalUmbrella.golden'
import { INLAND_MARINE_ARCHETYPE }        from './__fixtures__/inlandMarine.golden'
import { FLOOD_ARCHETYPE }                from './__fixtures__/flood.golden'
import { GENERAL_LIABILITY_ARCHETYPE }    from './__fixtures__/generalLiability.golden'
import { COMMERCIAL_PROPERTY_ARCHETYPE }  from './__fixtures__/commercialProperty.golden'
import { COMMERCIAL_AUTO_ARCHETYPE }      from './__fixtures__/commercialAuto.golden'
import { WORKERS_COMP_ARCHETYPE }         from './__fixtures__/workersComp.golden'
import { BOP_ARCHETYPE }                  from './__fixtures__/bop.golden'
import { COMMERCIAL_PACKAGE_ARCHETYPE }   from './__fixtures__/commercialPackage.golden'
import { CYBER_ARCHETYPE }                from './__fixtures__/cyber.golden'
import { MANAGEMENT_LIABILITY_ARCHETYPE } from './__fixtures__/managementLiability.golden'
import { PROFESSIONAL_LIABILITY_ARCHETYPE } from './__fixtures__/professionalLiability.golden'
import { CRIME_ARCHETYPE }                from './__fixtures__/crime.golden'
import { EXCESS_UMBRELLA_ARCHETYPE }      from './__fixtures__/excessUmbrella.golden'

// ─── LINE_INTELLIGENCE_REGISTRY ───────────────────────────────────────────────

// Keyed by lobRefId (or virtual refId for families without a seeded product yet).
// This registry is BROADER than LOB_REGISTRY: it covers all known P&C families, while
// LOB_REGISTRY contains only lines with seeded products. The two registries grow
// independently; a line need not have a seeded product to have an archetype here.
export const LINE_INTELLIGENCE_REGISTRY: Record<string, LineArchetype> = {
  // ── Seeded lines (lobRefId matches LOB_REGISTRY) ──────────────────────────
  'PH.LOB.001': HOMEOWNERS_ARCHETYPE,        // personal property → PERSONAL_PROPERTY
  'PA.LOB.001': PERSONAL_AUTO_ARCHETYPE,     // personal auto     → PERSONAL_AUTO
  'GL.LOB.001': GENERAL_LIABILITY_ARCHETYPE, // general liability  → GENERAL_LIABILITY

  // ── Virtual families (no seeded product; adaptive importer uses archetype alone) ─
  'DP.FAMILY':  DWELLING_ARCHETYPE,             // dwelling fire / landlord
  'PU.FAMILY':  PERSONAL_UMBRELLA_ARCHETYPE,    // personal umbrella
  'IM.FAMILY':  INLAND_MARINE_ARCHETYPE,        // inland marine / valuable articles
  'FL.FAMILY':  FLOOD_ARCHETYPE,                // flood (NFIP + private)
  'CP.FAMILY':  COMMERCIAL_PROPERTY_ARCHETYPE,  // commercial property
  'CA.FAMILY':  COMMERCIAL_AUTO_ARCHETYPE,      // commercial auto
  'WC.FAMILY':  WORKERS_COMP_ARCHETYPE,         // workers compensation
  'BP.FAMILY':  BOP_ARCHETYPE,                  // business owners policy
  'CPP.FAMILY': COMMERCIAL_PACKAGE_ARCHETYPE,   // commercial package policy
  'CY.FAMILY':  CYBER_ARCHETYPE,                // cyber
  'ML.FAMILY':  MANAGEMENT_LIABILITY_ARCHETYPE, // management liability (D&O, EPL)
  'PL.FAMILY':  PROFESSIONAL_LIABILITY_ARCHETYPE, // professional liability / E&O
  'CR.FAMILY':  CRIME_ARCHETYPE,                // crime / fidelity
  'XS.FAMILY':  EXCESS_UMBRELLA_ARCHETYPE,      // commercial excess / umbrella
}

// ─── LOB augmentation ─────────────────────────────────────────────────────────

// Populate the optional `lineIntelligence` field on the three existing seeded LOB
// definitions. This is a one-time side-effectful assignment — no circular import:
// lobRegistry.ts imports the LineArchetype TYPE only (from lines/types.ts);
// the VALUES come from here after lobRegistry.ts has fully initialised.
PH_LOB.lineIntelligence = HOMEOWNERS_ARCHETYPE
PA_LOB.lineIntelligence = PERSONAL_AUTO_ARCHETYPE
GL_LOB.lineIntelligence = GENERAL_LIABILITY_ARCHETYPE

// ─── Public API ───────────────────────────────────────────────────────────────

/** Resolve a LineArchetype by lobRefId (exact match) or by virtual family key.
 *  Returns undefined when the family is unknown. */
export function resolveLineArchetype(lobRefId: string): LineArchetype | undefined {
  return LINE_INTELLIGENCE_REGISTRY[lobRefId]
}

/** Resolve by LOB prefix (e.g. 'PH' from a product's lob.refId). Matches the first
 *  entry whose lobRefId starts with the prefix or IS the prefix. */
export function resolveLineArchetypeByPrefix(prefix: string): LineArchetype | undefined {
  const upper = prefix.toUpperCase()
  // Exact lobRefId match first.
  const exact = Object.values(LINE_INTELLIGENCE_REGISTRY).find(a => a.lobRefId === upper)
  if (exact) return exact
  // Prefix match: 'PH' matches 'PH.LOB.001' and 'PH.FAMILY'.
  return Object.values(LINE_INTELLIGENCE_REGISTRY).find(a => a.lobRefId.startsWith(`${upper}.`))
}

/** Resolve by LineFamily. When multiple archetypes share a family (e.g. UMBRELLA covers
 *  personal + commercial), returns the FIRST registered entry. Callers that need a
 *  specific variant should use resolveLineArchetype() with the lobRefId directly. */
export function resolveLineArchetypeByFamily(family: LineArchetype['family']): LineArchetype | undefined {
  return Object.values(LINE_INTELLIGENCE_REGISTRY).find(a => a.family === family)
}

/** All registered archetypes as an ordered array. Order follows LINE_INTELLIGENCE_REGISTRY
 *  insertion order (seeded lines first, then virtual families alphabetically). */
export function allLineArchetypes(): LineArchetype[] {
  return Object.values(LINE_INTELLIGENCE_REGISTRY)
}
