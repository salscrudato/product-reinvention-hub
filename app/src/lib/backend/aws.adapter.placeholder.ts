// AWS adapter placeholder — mirrors BackendAdapter; every method throws NotImplemented
// and carries a comment mapping it to the AWS service that would replace it.
// AWS-SWAP: implement this file to complete the Firebase → AWS migration.
// See docs/AWS_SWAP.md for the full service mapping and swap procedure.
import type { BackendAdapter } from './types'
import { MutationConflictError } from './types'

function notImplemented(method: string): never {
  throw new Error(`AWS adapter: ${method} is not yet implemented. See docs/AWS_SWAP.md.`)
}

export const adapter: BackendAdapter = {
  auth: {
    // AWS-SWAP: Cognito signIn — Auth.signIn(username, password)
    signIn: (_email, _password) => notImplemented('auth.signIn'),
    // AWS-SWAP: Cognito signOut — Auth.signOut()
    signOut: () => notImplemented('auth.signOut'),
    // AWS-SWAP: Hub.listen('auth') → dispatch AuthUser from Cognito JWT
    onUser: (_cb) => notImplemented('auth.onUser'),
    // AWS-SWAP: Auth.changePassword(oldPassword, newPassword)
    changePassword: (_next) => notImplemented('auth.changePassword'),
  },
  db: {
    // AWS-SWAP: DynamoDB GetItem or Aurora SELECT
    get: (_path) => notImplemented('db.get'),
    // AWS-SWAP: DynamoDB Query/Scan or Aurora SELECT with WHERE
    list: (_path, _q) => notImplemented('db.list'),
    // AWS-SWAP: AppSync GraphQL subscription (or polling fallback)
    subscribe: (_pathOrQuery, _cb) => notImplemented('db.subscribe'),
    // AWS-SWAP: DynamoDB TransactWriteItems (entity + auditEvent + version + searchIndex)
    mutate: (_m) => notImplemented('db.mutate'),
    // AWS-SWAP: DynamoDB UpdateItem with ADD (votes.voters, votes.count)
    vote: (_path, _uid) => notImplemented('db.vote'),
    // AWS-SWAP: DynamoDB TransactGetItems + condition expressions for optimistic lock
    tx: (_fn) => notImplemented('db.tx'),
  },
  storage: {
    // AWS-SWAP: S3 presigned PUT upload
    upload: (_path, _file) => notImplemented('storage.upload'),
    // AWS-SWAP: S3 presigned GET URL
    getUrl: (_path) => notImplemented('storage.getUrl'),
  },
  fns: {
    // AWS-SWAP: API Gateway + Lambda invoke (Amplify API.post or aws-sdk invoke)
    call: (_name, _data) => notImplemented('fns.call'),
    // AWS-SWAP: Lambda URL + streaming response (same SSE pattern over HTTPS)
    stream: (_name, _data, _onChunk) => notImplemented('fns.stream'),
  },
  presence: {
    // AWS-SWAP: DynamoDB TTL heartbeat or AppSync mutation
    join: (_pid) => notImplemented('presence.join'),
    // AWS-SWAP: AppSync subscription or polling
    watch: (_pid, _cb) => notImplemented('presence.watch'),
  },
}

export { MutationConflictError }
