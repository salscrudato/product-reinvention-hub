// pdm/source.ts — assembles the two seeded products into DomainProductBundles and
// exposes ready-built PDMs for Personal Home and Personal Auto. This is the seam where
// the seed constants meet the neutral builder; keeping it separate keeps build.ts a pure
// bundle-in/PDM-out function (testable with any bundle, not just the seeds).
import { PH_LOB, PA_LOB, GL_LOB } from '../insurance/lobRegistry'
import {
  PH_PRODUCT, PH_COVERAGES, PH_FORMS, PH_RULES, PH_FORM_RULES,
  PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES,
} from '../seed/personalHome'
import {
  PA_PRODUCT, PA_COVERAGES, PA_FORMS, PA_RULES, PA_FORM_RULES,
  PA_RATING_PROGRAM, PA_RT_TABLES, PA_LD_TABLES,
} from '../seed/personalAuto'
import {
  GL_PRODUCT, GL_COVERAGES, GL_FORMS, GL_RULES, GL_FORM_RULES,
  GL_RATING_PROGRAM, GL_RT_TABLES, GL_LD_TABLES,
} from '../seed/generalLiability'
import { buildPdm, type DomainProductBundle, type BuildPdmOptions } from './build'
import type { PdmProduct } from './types'

/** The Personal Home domain bundle (HO-3 Special Form). */
export const PERSONAL_HOME_BUNDLE: DomainProductBundle = {
  product:       PH_PRODUCT,
  lob:           PH_LOB,
  coverages:     PH_COVERAGES,
  forms:         PH_FORMS,
  rules:         PH_RULES,
  formRules:     PH_FORM_RULES,
  ratingProgram: PH_RATING_PROGRAM,
  rtTables:      PH_RT_TABLES,
  ldTables:      PH_LD_TABLES,
}

/** The Personal Auto domain bundle (PAP PP 00 01). */
export const PERSONAL_AUTO_BUNDLE: DomainProductBundle = {
  product:       PA_PRODUCT,
  lob:           PA_LOB,
  coverages:     PA_COVERAGES,
  forms:         PA_FORMS,
  rules:         PA_RULES,
  formRules:     PA_FORM_RULES,
  ratingProgram: PA_RATING_PROGRAM,
  rtTables:      PA_RT_TABLES,
  ldTables:      PA_LD_TABLES,
}

/** The General Liability domain bundle (ISO CGL, CG 00 01 occurrence form). */
export const GENERAL_LIABILITY_BUNDLE: DomainProductBundle = {
  product:       GL_PRODUCT,
  lob:           GL_LOB,
  coverages:     GL_COVERAGES,
  forms:         GL_FORMS,
  rules:         GL_RULES,
  formRules:     GL_FORM_RULES,
  ratingProgram: GL_RATING_PROGRAM,
  rtTables:      GL_RT_TABLES,
  ldTables:      GL_LD_TABLES,
}

/** All seeded product bundles, keyed by product refId. */
export const DOMAIN_BUNDLES: Record<string, DomainProductBundle> = {
  [PH_PRODUCT.refId!]: PERSONAL_HOME_BUNDLE,
  [PA_PRODUCT.refId!]: PERSONAL_AUTO_BUNDLE,
  [GL_PRODUCT.refId!]: GENERAL_LIABILITY_BUNDLE,
}

export function buildPersonalHomePdm(options?: BuildPdmOptions): PdmProduct {
  return buildPdm(PERSONAL_HOME_BUNDLE, options)
}

export function buildPersonalAutoPdm(options?: BuildPdmOptions): PdmProduct {
  return buildPdm(PERSONAL_AUTO_BUNDLE, options)
}

export function buildGeneralLiabilityPdm(options?: BuildPdmOptions): PdmProduct {
  return buildPdm(GENERAL_LIABILITY_BUNDLE, options)
}

/** Build the PDM for every seeded product (Personal Home + Personal Auto + General Liability). */
export function buildAllPdms(options?: BuildPdmOptions): PdmProduct[] {
  return [buildPersonalHomePdm(options), buildPersonalAutoPdm(options), buildGeneralLiabilityPdm(options)]
}
