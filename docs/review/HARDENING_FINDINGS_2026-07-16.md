# Application Hardening Review — 2026-07-16

Four-lane review (auth/passkey security · server API robustness · client quality/perf ·
config/secrets/infra). Findings are ordered by severity. Each has been verified against the
working-tree source; the one live-secret claim was independently re-confirmed with `git grep`.

Severity key: **P0** = fix before next deploy/push · **P1** = fix this cycle · **P2** = scheduled cleanup.

---

## P0 — Critical

### F1. Live Azure Foundry API key committed in tracked files
`hardening/ledger.md:746,748` and `hardening/WAVES.md` contain the full `AZURE_FOUNDRY_KEY`
(`C0S1LR7A…GjwNo`) plus the resource endpoint. Anyone with repo/clone/mirror access can bill
AI spend or exfiltrate prompts against the Foundry account. Key was also historically leaked via
a deleted `tmp.md` (`f6c7611e`→`866f728f`), so history is exposed too.
**Fix:** rotate the key in the Foundry portal → update App Service settings → redact both docs →
scrub history (`git filter-repo`) for `tmp.md` + these literals → force-push → re-clone.

### F2. Account takeover via attacker-controlled magic-link origin
`server/lib/auth.js:304-305` (`POST /api/auth/otp/request`). When `PUBLIC_APP_ORIGIN` is unset the
magic-link base is taken from the forgeable request `Origin` header. Attacker POSTs a victim's real
email with `Origin: https://evil.com`; the platform emails the victim a legit-looking link pointing
at evil.com, whose JS harvests the single-use token and replays it → one-click ATO.
**Fix:** require `PUBLIC_APP_ORIGIN`; fail closed (no link) if unset. Never derive email origin from a
request header, or validate it against a fixed server-side allowlist.

### F3. Cross-tenant / cross-session cache repopulation race in the adapter
`app/src/lib/backend/azure.adapter.ts:110-115,315-325`. `setSuperAdminTenant`/`clearClientCaches`
clear `snapshotCache`/`dataCache` but **not** `pathFetches`, so a poked poller re-awaits the previous
tenant's in-flight request (sent with the old `X-Tenant-Id`) and caches tenant-A rows under tenant B.
Same hole on logout: an in-flight fetch resolving post-logout repopulates the cache and the next
sign-in's SWR paint serves the prior session's data.
**Fix:** `pathFetches.clear()` in both paths + a generation counter checked before delivering/caching.

---

## P1 — High

### F4. Per-IP rate limiters bypassed via spoofed `X-Forwarded-For`
`server/server.js:36-37`, `server/lib/homecheck.js:159-160`. Limiter key is the leftmost XFF value,
fully client-controlled (App Service appends but does not strip client XFF; `trust proxy` unset).
Rotating the header per request defeats OTP/bootstrap brute-force and tenant-enumeration limits.
**Fix:** `app.set('trust proxy', <hops>)` and key on `req.ip`, or read the rightmost (front-end-appended) XFF entry.

### F5. Unbounded attacker-seeded in-memory maps (memory-exhaustion DoS)
`server/server.js:33,127`, `server/lib/metering.js:39,124`, `homecheck.js` buckets — none evict/expire.
With F4, random XFF values mint permanent Map entries until the instance OOMs.
**Fix:** bound the maps (LRU / periodic sweep by `lastMs`), cap distinct keys.

### F6. WebAuthn origin/rpID validation is fail-open (request-derived)
`server/lib/passkeys.js:49-64`. When `PASSKEY_ORIGINS`/`PASSKEY_RP_ID` unset, `expectedOrigin`/`rpID`
come from the caller's own `Origin`/`Host`, so the anti-phishing origin check becomes `origin===origin`.
**Fix:** require both env vars in any deployed env; fail closed if unset; header derivation only under an
explicit local-dev opt-in (mirror `BOOTSTRAP_USERS_ENABLED`).

### F7. nodemailer `<7.0.7` — SMTP/CRLF injection + TLS-validation advisories
`server/package.json:21` (`^6.9.16`). GHSA-vvjj-xcjg-gr5g, -c7w3-x93f-qmm8, -r7g4-qg5f-qqm2 on the
OTP/magic-link SMTP path (`server/lib/email.js:38`).
**Fix:** bump to `>=8.0.8`; verify `_sendSmtp` still works; re-run gate.

### F8. Passwordless passkey accepts no user verification (privileged)
`server/lib/passkeys.js:159,245` (`requireUserVerification:false`; options `userVerification:'preferred'`).
A stolen/unlocked device signs in with no second factor — and a bootstrap account mints **SUPER_ADMIN**
(`authVerify:266-268`).
**Fix:** `userVerification:'required'` in both option builders + `requireUserVerification:true` in both
verify calls (mandatory at least for any credential that can mint a privileged session).

### F9. ~50 concurrent infinite paint-bound animations on the sign-in page
`Landing.tsx:216-268` + `index.css:490-616`. 18 field-motes, 10 spoke-motes, 6 `stroke-dashoffset`
edge-flows (pure paint, never composited), node-glows, orbits, aurora — all run forever, even scrolled
out of view. Constant main-thread/GPU load + battery drain on the login screen.
**Fix:** pause via IntersectionObserver / `visibilitychange` (`animation-play-state:paused`); cut mote
counts; prefer opacity-only. (Reduced-motion is already handled.)

### F10. Adapter session JWT in `localStorage`
`azure.adapter.ts:19-22,88-94` (`pf.azure.token`). Any XSS anywhere in the SPA exfiltrates the session
for its full 8h lifetime, no server-side revocation on the bearer path.
**Fix:** move to the httpOnly cookie session the server already supports, or short-lived tokens + rotation.

---

## P1/P2 — Medium

### F11. SSRF: news refresh fetches model-supplied article URLs with no host validation
`server/lib/ai/refresh-news.js:124-206`. `sanitizeNewsUrl` is applied only to the image candidate, never
the article URL that `headIsAlive`/`resolveImage` fetch; `redirect:'follow'` allows external→internal.
Tenant-controlled `newsPrefs.instruction` can steer the model to emit `http://169.254.169.254/…` (IMDS).
**Fix:** run every fetched URL (article + image + post-redirect) through `sanitizeNewsUrl`; deny
private/link-local/loopback ranges; disable or manually vet redirects.

### F12. Internal error messages leaked to clients on 500 paths
`server/lib/data.js:260,548,591,651,696,744`, `server/lib/storage.js:80`,
`server/lib/passkeys.js:162,249`. Raw exception text (Cosmos strings, SQL fragments, webauthn
validation detail) returned to callers — contradicts the global handler's no-leak posture.
**Fix:** log server-side, return opaque error codes.

### F13. Adapter `api()` has no timeout / AbortSignal
`azure.adapter.ts:39-52`. A hung connection stalls every call forever; the poller `inFlight` guard then
permanently blocks that subscription's ticks (view silently stops updating).
**Fix:** `signal: AbortSignal.timeout(30_000)` (longer for `/ai/*` + uploads); map `TimeoutError` to retryable.

### F14. Transient `/auth/me` failure signs a valid user out
`azure.adapter.ts:250-255` — any network blip `.catch(() => setUser(null))` bounces a validly-signed-in
user to the landing page.
**Fix:** only `setUser(null)` on `err.message==='unauthenticated'`; keep the decoded-token user on network errors.

### F15. No HTTP security headers (CSP/HSTS/nosniff/frame-ancestors)
`server/server.js` (only `x-powered-by` disabled), `firebase.json` (no headers), `app/index.html` (no CSP).
Both the Azure host and the Firebase landing ship zero security headers → clickjacking, MIME-sniff XSS, SSL-strip.
**Fix:** headers middleware (or `helmet`) on Express + a `headers` array in `firebase.json`.

### F16. Outbound external `fetch` calls have no timeout
`server/lib/external/{hazards,azureMaps,vpic,txFilings,edgar,newsdata}.js`, `foundry.js:22` (`dispatch`).
A hung upstream ties up the Node request with no ceiling; several are on the portfolio request path.
`edgar.companyFacts` also pulls multi-MB with no size cap.
**Fix:** wrap every outbound fetch in `AbortSignal.timeout(...)`; bound response sizes.

### F17. Seed users ship plaintext passwords in tracked source
`shared/src/seed/personalHome.ts:788-802` (`'scrudato'`, `'freeman'`, `'jones'`).
**Fix:** env-injected or generate-on-seed; confirm the seed path is dev-only and cannot run against prod Cosmos.

### F18. Adapter `fns.stream()` bypasses the `api()` error contract
`azure.adapter.ts:462-485`. A 401 mid-stream throws a generic error but does **not** trigger sign-out; the
app keeps polling with a dead token.
**Fix:** on 401 run the same `setToken(null)/setUser(null)/clearClientCaches()` path; read `body.detail` on non-OK.

### F19. `.firebase/` deploy cache not gitignored
Repo-root `.gitignore` lacks `.firebase/`; it holds a manifest of every deployed asset and will be committed on `git add -A`.
**Fix:** add `.firebase/` (and `status.txt`) to `.gitignore`. (`.firebaserc`/`firebase.json` are fine to commit.)

---

## P2 — Low

- **F20.** OTP lockout is dead code — record deleted on lockout so `lockedUntil` never applies (`otp.js:66-72`). Keep the record.
- **F21.** Pointermove handler reads `getBoundingClientRect()` + writes `--mx/--my` per event, repainting a 480px radial gradient (`Landing.tsx:68-78`). Cache the rect on `pointerenter`; write in the existing rAF `tick()`.
- **F22.** `/api/db/list` accepts unbounded `where`/`orderBy` clauses (`data.js:156-177`) → RU/parse DoS. Cap at ≤16.
- **F23.** `/api/db/presence/watch` reachable by POLICYHOLDER (`data.js:621`, exempt in `server.js:102`) → enumerate viewer uids. Gate with `requireCapability('product:read')`.
- **F24.** Prototype-pollution-shaped keys (`__proto__`/`constructor`) persisted into docs (`data.js:374,464`). Scrub alongside the reserved-key strip.
- **F25.** Duplicated main-thread chunked-base64 encoders for large uploads (`azure.adapter.ts:438-450,572-582`). Extract one helper; use `FileReader.readAsDataURL` / multipart.
- **F26.** `webauthn.ts:52,87` — `atob(String(undefined))` on missing server options throws a raw DOMException. Assert required fields, throw typed `passkey_options_invalid`.
- **F27.** Uncancelled `setTimeout` navigates 1.8s later after possible unmount (`Landing.tsx:507`); uncancelled `listTenants()` effect overwrites a user-pinned tenant (`Landing.tsx:388-396`). Add cleanup/cancellation.
- **F28.** Client-supplied `tenant` body fallback baked into JWT (`auth.js:338`); passkey session tenant is a stale enrollment snapshot (`passkeys.js:274`). Derive tenant server-side / from the live user record.
- **F29.** Hard-coded literal color outside index.css (`Landing.tsx:734`). Move to a token in `.wave-shine-span`.
- **F30.** `_P2` footer string is corrupt base64 → mojibake glyph shipped every load (`Landing.tsx:27,864`). Re-encode.
- **F31.** Sign-in form fights password managers (`autoComplete="off"`/`"new-password"`, decoy names — `Landing.tsx:602,656`). Use `current-password`.
- **F32.** `exceljs@^4.4.0` moderate advisory (transitive `uuid`); no non-major fix. Track upstream; document as accepted.
- **F33.** In-memory cost guard / per-tenant budget / rate limiters are per-instance and break under scale-out (`fleet.js`, `metering.js`, `server.js`). Add a startup single-instance assertion or shared-store backing before scaling.

---

## Verified clean (do not re-chase)
- JWT verify: timing-safe, alg-confusion-proof, exp enforced. Bootstrap login: equal-length hashes + `timingSafeEqual`, gated.
- Session cookie: HttpOnly/SameSite=Lax/Secure-when-TLS/8h/jti-revoke. Impersonation refuses SUPER_ADMIN/SUPPORT, dual-attributed.
- Cosmos queries parameterized; field names regex-constrained; tenant isolation double-enforced (pk + `c.tenantId` + `scopeDoc`); audit chainHead etag-guarded with bounded 412 retry.
- No hardcoded model strings; import no-cap path still meters telemetry.
- no-bare-writes invariant NOT weakened — the +4 lines are the sanctioned DEF-0047 allowlist entry for `passkeys.js` (count 1).
- Reduced-motion comprehensively handled for all new animations. No XSS / `dangerouslySetInnerHTML`. Adapter seam intact.
- `keys.md` gitignored + untracked; `app/.env*` covered; no secrets in `app/dist` / source maps absent.
