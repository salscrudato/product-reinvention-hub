// import/split.ts — multi-product and multi-coverage-part splitting.
// One upload can yield several Products (e.g. HO3/HO4/HO6 sibling products) or one
// Product with form-scoped coverages. Splitting rules come from the TranslationRecipe.
// Pure function — no I/O, no AI calls.

import type { SplitProductProposal, ExtractionPlan } from '@pf/shared'

/** Derive a list of product proposals from the extraction plan and any form variants
 *  detected in the document content (e.g. HO3 / HO4 / HO6 column headers). */
export function planProductSplit(
  plan: ExtractionPlan,
  detectedFormVariants: string[],
): SplitProductProposal[] {
  const recipe = plan.archetype.translationRecipe

  if (recipe.productSplitStrategy === 'SINGLE_PRODUCT') {
    return [{ productToken: 'default', name: plan.archetype.displayName }]
  }

  if (recipe.productSplitStrategy === 'SINGLE_PRODUCT_MULTI_FORM') {
    return [{ productToken: 'default', name: plan.archetype.displayName }]
  }

  // SIBLING_PRODUCTS_PER_FORM — one product per distinct form variant in the upload.
  // If no variants were detected fall back to a single product.
  if (detectedFormVariants.length === 0) {
    return [{ productToken: 'default', name: plan.archetype.displayName }]
  }

  return detectedFormVariants.map(form => ({
    productToken: form.replace(/[\s\-]/g, '_').toUpperCase(),
    formScope:    form,
    name:         `${plan.archetype.displayName} (${form})`,
  }))
}

/** Extract form-variant labels from ISO workbook sheet names.
 *  Returns tokens like ['HO3', 'HO4', 'HO6'] or ['DP1', 'DP3']. */
export function detectFormVariantsFromSheets(sheetNames: string[]): string[] {
  const variants = new Set<string>()
  for (const name of sheetNames) {
    // ISO HO: HO-3, HO3, HO 3, etc.
    const hoMatch = name.match(/\b(HO[- ]?[2-8])\b/i)
    if (hoMatch) variants.add(hoMatch[1]!.replace(/[- ]/g, '').toUpperCase())
    // Dwelling Fire: DP-1/2/3
    const dpMatch = name.match(/\b(DP[- ]?[123])\b/i)
    if (dpMatch) variants.add(dpMatch[1]!.replace(/[- ]/g, '').toUpperCase())
    // Commercial Package: CPP coverage parts (property / GL / IM)
    const cppMatch = name.match(/\b(property coverage|gl coverage|inland marine)\b/i)
    if (cppMatch) variants.add(cppMatch[1]!.toLowerCase().replace(/\s+/g, '_'))
  }
  return [...variants]
}
