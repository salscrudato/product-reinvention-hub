// baseForm.ts — the base-form lifecycle rules the Claims library leans on, kept pure so the
// "honest identification" invariant is unit-tested: a form we could not identify is marked
// NEEDS_REVIEW (never a silent empty-metadata READY), and only a genuinely READY form with a
// stored document is analyzable. Shared by BaseFormsLibrary (status on upload) and Claims
// (composer gate) so both sides agree.

// PROCESSING → the server identify pass is running; READY → identified + analyzable;
// NEEDS_REVIEW → identify returned neither a form number nor a recognised line (or failed),
// so the form is surfaced but held back from analysis until an editor resolves it.
export type BaseFormStatus = 'PROCESSING' | 'READY' | 'NEEDS_REVIEW'

/** The status to set once the identify pass returns. A confident read yields EITHER a printed
 *  form number OR a recognised line; with neither, we cannot ground analysis honestly, so the
 *  form is NEEDS_REVIEW rather than a silent empty-metadata READY. */
export function statusAfterIdentify(meta: { formNumber?: string | null; lob?: string | null }): 'READY' | 'NEEDS_REVIEW' {
  const identified = !!(meta.formNumber?.trim() || meta.lob?.trim())
  return identified ? 'READY' : 'NEEDS_REVIEW'
}

/** Whether a base form may be used for analysis: it must be READY (identified) and carry a
 *  stored document. A PROCESSING or NEEDS_REVIEW form — or one missing its PDF — is not
 *  analyzable, so the composer stays disabled. */
export function isFormAnalyzable(form: { status?: string | null; storagePath?: string | null } | null | undefined): boolean {
  return !!form && form.status === 'READY' && !!form.storagePath?.trim()
}
