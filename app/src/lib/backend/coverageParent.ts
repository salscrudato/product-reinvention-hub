/**
 * Pure, side-effect-free guard: throw if a non-null parentId isn't present in
 * the product's known coverage refIds. Extracted here so it can be unit-tested
 * without Firebase. The adapter fetches `existingRefIds` via getDocs before the
 * transaction, then calls this; a missing parent throws before the batch commits.
 */
export function validateCoverageParent(
  parentId: string | null | undefined,
  existingRefIds: string[],
): void {
  if (!parentId) return
  if (!existingRefIds.includes(parentId)) {
    throw new Error(`Sub-coverage parent "${parentId}" not found in this product`)
  }
}
