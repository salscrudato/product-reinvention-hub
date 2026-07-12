// tests/fixtures/import/index.ts — barrel for the importer's golden fixtures.
export * from './types'
export * from './registry'
export { HO_EXPECTED } from './expected.ho'
export { GL_EXPECTED } from './expected.gl'
export { IM_EXPECTED } from './expected.im'
export { PR_EXPECTED } from './expected.pr'

import { HO_EXPECTED } from './expected.ho'
import { GL_EXPECTED } from './expected.gl'
import { IM_EXPECTED } from './expected.im'
import { PR_EXPECTED } from './expected.pr'
import type { LineExpected } from './types'

/** All four line snapshots (the seeded HO + GL, plus the authored IM + PR). */
export const LINE_EXPECTATIONS: readonly LineExpected[] = [
  HO_EXPECTED, GL_EXPECTED, IM_EXPECTED, PR_EXPECTED,
]
