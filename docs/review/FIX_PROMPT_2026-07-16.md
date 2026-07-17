# Claude Code Fix Prompt — Hardening Pass (2026-07-16)

You are hardening the Product Reinvention Hub. A four-lane security/perf/quality review produced
`docs/review/HARDENING_FINDINGS_2026-07-16.md` (F1–F33). Fix the findings below **at the cause**,
respecting every CLAUDE.md non-negotiable. Do NOT weaken any test, canary, threshold, or golden.
The gate must stay green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Work in order;
commit in logical groups; verify each behavioral claim by running code, not by reading it.

## Ground rules
- All app reads/writes go through the adapter; every entity write through `adapter.db.mutate()` /
  the envelope. Never hardcode a model string. Never log/echo secrets. Design tokens only (no hex
  outside `app/src/index.css`). Strict TypeScript. WCAG 2.2 AA. App bundle ≤175 KB gzip.
- The four rating canaries (PH $1,528 / PA $1,002 / GL $2,635 / filing $1,281) must stay exact.
- `/api/db/audit/verify` must stay green; do not write around the mutation envelope.
- Preserve existing sound controls listed in the "Verified clean" section — don't regress them.

## GROUP A — Secret exposure (do first; some steps need the human)
1. **F1 Foundry key.** Redact the literal key + endpoint from `hardening/ledger.md` and
   `hardening/WAVES.md` (replace with `<redacted>`). Then STOP and tell the human, in the summary,
   to: rotate `AZURE_FOUNDRY_KEY` in the Foundry portal, update App Service settings, and history-scrub
   (`git filter-repo`) `tmp.md` + the key literal followed by a force-push + re-clone. Do not attempt
   the rotation or history rewrite autonomously — flag it as BLOCKED-ON-HUMAN.
2. **F17.** Move `shared/src/seed/personalHome.ts:788-802` seed passwords to env-injected values (e.g.
   `process.env.SEED_PW_*` with a random dev fallback generated at seed time). Confirm/assert the seed
   path cannot run against prod Cosmos.
3. **F19.** Add `.firebase/` and `status.txt` to root `.gitignore`. Delete `status.txt`. Leave
   `.firebaserc`/`firebase.json` tracked.

## GROUP B — Auth (P0/P1)
4. **F2 magic-link origin.** In `server/lib/auth.js` require `PUBLIC_APP_ORIGIN`; if unset, do not emit a
   magic link (return the OTP-only response) and log a warning. Never fall back to `req.headers.origin`.
   If a header allowlist is preferred, validate against a fixed server-side list. Add a test proving a
   forged `Origin` header does not appear in the generated link.
5. **F6 passkey origin fail-open.** In `server/lib/passkeys.js` `rpFrom`, require `PASSKEY_RP_ID` +
   `PASSKEY_ORIGINS` in any deployed env; fail closed (refuse verify) if unset. Header derivation only
   under an explicit local-dev opt-in flag (mirror `BOOTSTRAP_USERS_ENABLED`). Add a test.
6. **F8 user verification.** Set `userVerification:'required'` in both option builders and
   `requireUserVerification:true` in both verify calls in `passkeys.js` (mandatory for any credential that
   can mint a privileged/SUPER_ADMIN session). Update tests accordingly.
7. **F28.** Drop the client-supplied `tenant` body fallback in `auth.js:338` (derive server-side only or
   validate against the user's memberships). In `passkeys.js:274` resolve tenant from the live user record
   at sign-in, not the enrollment snapshot.
8. **F20.** Fix `otp.js:66-72` so the record is retained on lockout and `lockedUntil` (`:55`) is honored.
   Add a test that a locked email is rejected for the full lockout window.
9. **F12 (auth slice) / F26.** In `passkeys.js:162,249` log `err.message` server-side and return a generic
   code. In `app/src/lib/webauthn.ts:52,87` assert required option fields and throw typed
   `passkey_options_invalid` instead of letting `atob(undefined)` throw a raw DOMException.

## GROUP C — Server robustness
10. **F4 XFF.** Set `app.set('trust proxy', <n>)` for the App Service front end and key rate limiters on
    `req.ip` (or the rightmost, front-end-appended XFF entry). Apply to `server/server.js:36-37` and
    `server/lib/homecheck.js:159-160`. Add a test that a forged leftmost XFF does not reset the bucket.
11. **F5 unbounded maps.** Bound `_authBuckets`, `_tenantBuckets` (`server.js`), `_meters`/`_requests`
    (`metering.js`), homecheck buckets — periodic sweep of stale entries by `lastMs` + a max-key cap.
12. **F11 SSRF.** In `server/lib/ai/refresh-news.js` run the article URL (and every post-redirect URL)
    through `sanitizeNewsUrl` before `headIsAlive`/`resolveImage`/`persistImageToBlob`; deny
    private/link-local/loopback IP ranges; set `redirect:'manual'` (or vet each hop).
13. **F16 outbound timeouts.** Wrap every outbound `fetch` in `server/lib/external/*` and `foundry.js:22`
    `dispatch` in `AbortSignal.timeout(...)` (match `_shared.js`). Bound `edgar.companyFacts` response size.
14. **F12 (data slice).** In `data.js:260,548,591,651,696,744` and `storage.js:80` log full detail
    server-side and return opaque error codes (no raw `e.message` to clients).
15. **F15 headers.** Add a security-headers middleware in `server.js` (or `helmet`): HSTS, `nosniff`,
    CSP with `frame-ancestors 'none'`, `Referrer-Policy`. Add a matching `headers` array to `firebase.json`
    for the Firebase-served landing page. Verify the SPA still loads (tune CSP for Vite assets).
16. **F22 / F23 / F24-proto.** Cap `where`/`orderBy` length at ≤16 in `data.js:156-177` (400 past it);
    gate `/api/db/presence/watch` with `requireCapability('product:read')`; scrub
    `__proto__`/`constructor`/`prototype` keys in `data.js:374,464` alongside the reserved-key strip.
17. **F7 nodemailer.** Bump `server/package.json` nodemailer to `>=8.0.8`, `npm install --prefix server`,
    confirm `_sendSmtp` in `email.js` still works, re-run the gate.
18. **F33.** Add a startup assertion / documented invariant that the in-memory cost guard, per-tenant
    budget, and rate limiters assume a single instance; refuse to start (or warn loudly) if scale-out is
    detected. (Full shared-store backing is a follow-up, not this pass.)

## GROUP D — Client perf/quality
19. **F3 cache race (highest client priority).** In `azure.adapter.ts`, `pathFetches.clear()` inside both
    `setSuperAdminTenant`/`setActiveTenant` and `clearClientCaches`, and add a generation counter that
    every fetch captures and checks before delivering/caching results (drop stale-generation results).
    Add a test simulating a tenant switch mid-flight.
20. **F9 idle animations.** In `Landing.tsx`/`index.css`, pause the orbit/aurora/sweep animations when the
    hero is offscreen (IntersectionObserver) or the tab is hidden (`visibilitychange`) via a class toggling
    `animation-play-state:paused`; reduce mote counts; prefer opacity/transform over paint properties
    (`stroke-dashoffset`, `background`). Keep the reduced-motion behavior.
21. **F21 pointermove.** Cache `getBoundingClientRect()` on `pointerenter` (invalidate on resize) and move
    the `--mx/--my` writes into the existing rAF `tick()` so all style writes are once-per-frame.
22. **F10 token storage.** Move the adapter session to the httpOnly cookie the server already issues (or, if
    that's too large a change this pass, document it and switch to short-lived tokens + refresh). If deferred,
    say so explicitly in the summary.
23. **F13 / F14 / F18.** Add `AbortSignal.timeout(30_000)` to `api()` (longer for `/ai/*` + uploads); only
    `setUser(null)` on `unauthenticated` in `/auth/me`; make `fns.stream()` run the sign-out path on 401 and
    read `body.detail` on non-OK.
24. **F25.** Extract the duplicated chunked-base64 encoder into one helper; prefer `FileReader.readAsDataURL`
    (off-thread) for large uploads.
25. **F27.** Ref + cleanup the `setTimeout` in `Landing.tsx:507`; add a `cancelled` flag and pinned-state ref
    to the `listTenants()` effect (`:388-396`).
26. **F29 / F30 / F31.** Move the `Landing.tsx:734` literal color to a token in `.wave-shine-span`; re-encode
    the corrupt `_P2` footer string (`:27,864`); use `autoComplete="current-password"` on the login password
    field and drop the manager-hostile decoy naming (`:602,656`).

## Closeout
- Run the full gate + the four canaries after each group; do not proceed on red.
- Where a fix depends on a new env var (`PUBLIC_APP_ORIGIN`, `PASSKEY_RP_ID`, `PASSKEY_ORIGINS`, `SEED_PW_*`),
  add it to the deploy docs and list it in the final summary as an App Service setting the human must set.
- Final summary must call out: F1 rotation/history-scrub (BLOCKED-ON-HUMAN), any deferred item (e.g. F10/F33
  shared-store), and every new required env var.
