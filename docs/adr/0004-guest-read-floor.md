# ADR 0004 — Guest (anonymous) read-only floor + `VITE_ALLOW_GUEST`

- **Status:** Accepted 2026-07-09
- **Supersedes / relates to:** none
- **Numbering note:** the SEC-03 work order requested `0002-guest-read-floor.md`, but `0002`
  (agent-workflow) and `0003` (enhancement-baseline) already exist. To preserve the ADR sequence
  invariant, this is filed as `0004`.

## Context

The Firebase adapter auto-connects an **anonymous** Firebase Auth session on load
(`signInAnonymously`) so a visitor can browse the app without signing in. Anonymous users carry
a real ID token but **no role claim**, so the Firestore rules already deny them every
role-gated write (`canEdit()` / `isAdmin()` surfaces). This "guest floor" is desirable for a
showcase app — but it was neither a deliberate, toggleable decision nor fully airtight:

1. It was unconditional (no way to require sign-in for a locked-down deployment).
2. A handful of write rules were gated only by `isAuthed()`, which an anonymous session
   satisfies. So a guest could **write** to `feedback` (create + vote), `comments`, their own
   `newsPrefs` and `presence`, and — via the mutate envelope — `auditEvents` / `versions`.
   That contradicts the intended "guests are read-only" posture.

## Decision

### 1. `VITE_ALLOW_GUEST` (public flag, default `true`)

Defined once in `app/src/lib/backend/firebase.adapter.ts`:

```ts
const ALLOW_GUEST = import.meta.env.VITE_ALLOW_GUEST !== 'false'
```

- **`true` (default)** — behavior is unchanged: the adapter auto-connects an anonymous
  read-only session; the Landing page shows its inline sign-in form; anonymous visitors stay on
  Landing (only a real, email-bearing session redirects to `/app`).
- **`false`** — the automatic `signInAnonymously` is skipped. With no guest session the app
  requires a real credentialed sign-in; the Landing page offers **sign-in only** (it already has
  no "browse as guest" affordance, so no UI change is needed).

Documented in `app/.env.development`. Being a `VITE_*` value it is inlined into the client
bundle — that is fine; it is a public feature flag, not a secret.

### 2. Rules audit — gap found, tightened

The four server-only collections named in the work order already **deny anonymous reads**
(no change needed — cited from `firestore.rules`):

| Collection | Read rule | Anonymous read |
|---|---|---|
| `aiUsage` | `allow read: if isAdmin()` | denied (no role claim) |
| `groundingChunks` | `allow read, write: if false` | denied |
| `semanticCache` | `allow read, write: if false` | denied |
| `costCounters` | `allow read, write: if false` | denied |

For **writes**, a gap existed: the `isAuthed()`-gated write paths admitted anonymous sessions.
Closed by introducing two helpers and requiring a real (non-anonymous) account on every write
that was previously `isAuthed()`-only:

```
function isGuest()   { return isAuthed() && request.auth.token.firebase.sign_in_provider == 'anonymous'; }
function isMember()  { return isAuthed() && !isGuest(); }
```

Tightened rules (create/write predicates changed from `isAuthed()` → `isMember()`, reads
untouched): `auditEvents` create, `versions` create, `feedback` create + vote-update,
`comments` create, `newsPrefs` write, `presence` write. Every role-gated surface
(`canEdit()` / `isAdmin()`) was already guest-proof.

**Net effect:** anonymous sessions can **read** wherever `isAuthed()` reads allow (the guest
floor) but can **write nowhere**. Real `VIEWER` / `EDITOR` / `ADMIN` behavior is unchanged —
`isMember()` is true for every non-anonymous account, so VIEWER feedback + votes still work.

Covered by tests in `tests/rules.test.ts` (guest can read a product; guest cannot submit
feedback, vote, forge an auditEvent, or write presence/newsPrefs).

## Consequences

- A deployment can lock the app to credentialed users with one public flag, with no code change.
- The "guests are read-only" property is now enforced two-sided and regression-tested, not
  merely implied by the absence of a role claim.
- `feedback`/`comments`/`presence`/`newsPrefs` writes now require a real account. This is a
  deliberate behavior change for anonymous visitors (previously they could submit feedback and
  vote); it realizes the intended read-only-guest model. The client already fails these writes
  gracefully (toast on error) rather than crashing.
