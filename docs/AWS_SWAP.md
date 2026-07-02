# AWS_SWAP.md — Backend portability seam (Firebase → AWS)

Firebase is the active backend. Every Firebase touchpoint sits behind one typed
interface so the swap is an adapter implementation + infra, not an app rewrite.

## The seam
`app/src/lib/backend/`
- `types.ts` — the contract. Sketch:
  ```ts
  export interface BackendAdapter {
    auth: {
      signIn(email, password): Promise<Session>; signOut(): Promise<void>;
      onUser(cb): Unsubscribe;            // session + role (custom claim)
      changePassword(next): Promise<void>;
    };
    db: {
      get<T>(path): Promise<T | null>;
      list<T>(path, q?: Query): Promise<T[]>;
      subscribe<T>(path | q, cb): Unsubscribe;   // realtime
      mutate(m: Mutation): Promise<void>;         // entity + audit + version + index, atomic
      tx<T>(fn): Promise<T>;                      // rev-checked saves
    };
    storage: { upload(path, file): Promise<string>; getUrl(path): Promise<string> };
    fns: {
      call<TIn, TOut>(name, data): Promise<TOut>; // callable
      stream(name, data, onChunk): Promise<void>; // SSE (AI chat)
    };
    presence: { join(pid): Unsubscribe; watch(pid, cb): Unsubscribe };
  }
  ```
- `firebase.adapter.ts` — active implementation (modular SDK; connects to the
  Emulator Suite when `VITE_USE_EMULATORS=true`).
- `aws.adapter.placeholder.ts` — same interface; every method throws
  `NotImplemented` and carries a comment mapping it to its AWS service.
- `index.ts` — the one-line switch:
  ```ts
  // AWS-SWAP: flip this export to aws.adapter once implemented.
  export { adapter } from "./firebase.adapter";
  ```

Grep `AWS-SWAP:` to find every seam decision in the codebase.

## Service mapping
| Concern | Firebase (now) | AWS (later) |
|---|---|---|
| Auth + roles | Firebase Auth, custom claims | Cognito user pool, groups/claims in JWT |
| Database | Firestore | DynamoDB (single-table) or Aurora Postgres + Prisma |
| Realtime | onSnapshot | AppSync subscriptions (or polling fallback) |
| Functions/AI | Cloud Functions v2 (SSE onRequest) | Lambda + API Gateway (or Lambda URLs) w/ streaming |
| Scheduled agents | onSchedule | EventBridge Scheduler → Lambda |
| File storage | Cloud Storage | S3 (presigned uploads) |
| Hosting | Firebase Hosting | S3 + CloudFront or Amplify Hosting |
| Secrets (Anthropic key) | functions:secrets / .env.local | AWS Secrets Manager |
| Share snapshot (public) | Hosting rewrite → Function | CloudFront → Lambda@Edge or API GW route |

## Swap procedure
1. Implement `aws.adapter.ts` against `types.ts` (start with auth + db.get/list/
   mutate; `subscribe` may temporarily poll — the UI already tolerates it).
2. Port `functions/src/*` handlers to Lambda; they already isolate all
   Anthropic/Admin-SDK usage and import pure logic from `shared/` unchanged.
3. Stand up infra (table/pool/bucket/API), load secrets into Secrets Manager,
   run `scripts/seed.ts` against the new DB driver.
4. Flip the export in `index.ts`. Delete nothing Firebase until parity verified.

## Design rules that keep the swap cheap
- No `firebase/*` imports outside `lib/backend` (app) and `functions/` (server).
- `shared/` stays 100% pure TypeScript — engines, types and seed constants have
  zero platform imports and move as-is.
- Documents address by string `path`; the AWS adapter maps paths → keys/tables.
- Streaming AI uses plain SSE over HTTPS — identical pattern on Lambda.
- Security lives in rules **and** server checks; on AWS the server checks remain
  and rules translate to IAM/authorizer logic.
