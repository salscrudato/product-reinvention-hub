// Single export point for the active backend adapter.
// AWS-SWAP: flip this export to aws.adapter once implemented.
export { adapter } from './firebase.adapter'
export type { BackendAdapter, AuthUser, Session, Query, MutationPayload } from './types'
export { MutationConflictError } from './types'
