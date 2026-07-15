// Test/fixture assembly: the seeded PA.PROD.001 as an ExportInput — the same
// canonical dataset the $1,002 canary rates. Used by the export test suites and
// the round-trip harness; production exports assemble the identical shape from
// Cosmos in server/lib/export-duckcreek.js.

import {
  PA_PRODUCT, PA_COVERAGES, PA_FORMS, PA_RULES, PA_FORM_RULES,
  PA_RATING_PROGRAM, PA_LD_TABLES, PA_RT_TABLES, PA_RATING_INPUT_SPEC,
} from '../../seed/personalAuto'
import type { ExportInput } from './types'

export const FIXED_EXPORT_DATE = new Date('2026-07-15T12:00:00.000Z')

export function paExportInput(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    tenantName: 'Hub',
    product: { ...PA_PRODUCT },
    coverages: PA_COVERAGES.map((c) => ({ ...c })),
    forms: PA_FORMS.map((f) => ({ ...f })),
    rules: PA_RULES.map((r) => ({ ...r })),
    formRules: PA_FORM_RULES.map((r) => ({ ...r })),
    ratingProgram: { ...PA_RATING_PROGRAM },
    ldTables: PA_LD_TABLES,
    rtTables: PA_RT_TABLES,
    ratingInputSpec: PA_RATING_INPUT_SPEC,
    now: FIXED_EXPORT_DATE,
    ...overrides,
  }
}
