// baseForm.ts — the base-form lifecycle rules the Claims library leans on, kept pure so the
// "honest identification" invariant is unit-tested: a form we could not identify at all is
// marked NEEDS_REVIEW (never a silent empty-metadata READY), and only a genuinely READY form
// with a stored document is analyzable. Shared by BaseFormsLibrary (status on upload) and
// Claims (composer gate) so both sides agree.

// PROCESSING → the server identify pass is running; READY → identified + analyzable;
// NEEDS_REVIEW → identify returned neither a form number nor a recognised line (or failed),
// so the form is surfaced but held back from analysis until an editor resolves it.
export type BaseFormStatus = 'PROCESSING' | 'READY' | 'NEEDS_REVIEW'

/** The status to set once the identify pass returns. A confident read yields EITHER a printed
 *  form number OR a recognised line; with neither, we cannot ground analysis at all, so the
 *  form is NEEDS_REVIEW rather than a silent empty-metadata READY.
 *
 *  `verified` does NOT gate the status. When the server read a form number that the forms
 *  catalogue couldn't confirm (`verified:false`), the form is still READY + analyzable — the
 *  ATTACHED DOCUMENT is the authority for coverage, and the catalogue is only a convenience
 *  cross-check. Such a form carries `verified:false` so the UI can flag it with an "Unverified"
 *  chip + tooltip (see BaseFormsLibrary / Claims), without disabling the composer. */
export function statusAfterIdentify(meta: { formNumber?: string | null; lob?: string | null; verified?: boolean }): 'READY' | 'NEEDS_REVIEW' {
  const identified = !!(meta.formNumber?.trim() || meta.lob?.trim())
  return identified ? 'READY' : 'NEEDS_REVIEW'
}

/** Whether an identified form's number could not be confirmed against the forms catalogue.
 *  Analysis still runs (the attached document is the authority); the UI shows an Unverified
 *  chip. Only meaningful once a form is READY. */
export function isUnverified(form: { verified?: boolean } | null | undefined): boolean {
  return !!form && form.verified === false
}

/** Whether a base form may be used for analysis: it must be READY (identified) and carry a
 *  stored document. A PROCESSING or NEEDS_REVIEW form — or one missing its PDF — is not
 *  analyzable, so the composer stays disabled. */
export function isFormAnalyzable(form: { status?: string | null; storagePath?: string | null } | null | undefined): boolean {
  return !!form && form.status === 'READY' && !!form.storagePath?.trim()
}
