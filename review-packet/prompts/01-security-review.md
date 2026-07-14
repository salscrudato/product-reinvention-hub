# Prompt 01 — Security Review

> Paste everything below into the external AI. Attach `00-CONTEXT-DOSSIER.md`, the system + data-flow
> SVG diagrams, and give the reviewer access to the `server/` and `shared/` source (GitHub mirror or
> pasted files — at minimum the files named under "What to focus on").

---

## Role & goal

You are a senior application-security engineer performing an adversarial audit of an insurance
product-management SaaS ("Product Reinvention Hub"). It is a pnpm monorepo: a React SPA (`app/`) that
talks **only** to a same-origin Express host (`server/`) backed by Cosmos DB, Azure Foundry (Claude +
OpenAI), and Blob storage. Authentication, tenancy, and all AI calls are **hand-rolled server-side**.
Your job is to find real vulnerabilities and misconfigurations, prove them with concrete exploit
scenarios, and give precise fixes. Assume a motivated attacker who can register a tenant, hold a
`VIEWER` token, and upload documents to the AI ingestion path.

Do **not** hand back generic OWASP boilerplate. Every finding must be anchored to a real code path.

## What to focus on

Work through these areas in order. For each, name the exact file and function.

1. **Hand-rolled JWT (`server/lib/auth.js`).** HS256, `crypto.timingSafeEqual` signature compare, `jti`
   revocation list, 8h TTL. Assess vs a vetted library (`jose`/`jsonwebtoken`): algorithm-confusion
   (`alg:none`, RS/HS confusion), missing `exp`/`nbf`/`iat` checks, `jti` revocation store correctness
   and eviction, secret strength/rotation, replay window, and whether `timingSafeEqual` is fed
   equal-length buffers (it throws otherwise — is that caught safely or does it leak via error path?).
2. **OTP flow.** HMAC-at-rest storage of the code, lockout after N failures, resend throttling,
   constant-time compare, and **user-enumeration resistance** (does a valid vs unknown email return
   different status, timing, or message?). Check for OTP reuse and code entropy.
3. **Tenant isolation.** Every Cosmos read/write is scoped by partition key `${tenantId}|${base}` **and**
   a `c.tenantId = @tenantId` filter in the query text. Audit **every** query builder in
   `server/lib/data.js` (and any ad-hoc query elsewhere) for a query that omits the `c.tenantId` filter
   or derives `tenantId` from client-controlled input instead of the verified token. One missing filter
   is a cross-tenant data breach — treat it as critical.
4. **Break-glass + impersonation.** Platform/admin roles can impersonate into a tenant. Verify a
   platform-scope claim can **never** silently widen into a tenant-scoped token, that impersonation is
   audited, time-boxed, and that the resulting token cannot re-escalate back to platform scope.
5. **Global write gate + capability model.** `VIEWER` is read-only, enforced server-side. Confirm the
   gate is applied on **every** mutation entry point (not just the UI), including AI handlers that write
   (grounding chunks, import results) and any batch/admin path. Look for a write that bypasses the guard.
6. **Prompt-injection defense in AI handlers that ingest untrusted documents** (`/api/ai/*`, import
   brain). Uploaded PDFs/workbooks are attacker-controlled. Can injected instructions in a document
   exfiltrate other tenants' context, flip the citation/verification logic, escalate the model past the
   cost guard, or cause the model to emit unescaped content that is later rendered/executed? Assess how
   ingested text is delimited/sandboxed from system instructions.
7. **Secret handling.** Secrets are env-only (`process.env` in `server/lib/*`), never in the client
   bundle; a gitleaks gate runs in CI. Confirm no secret is reachable from the SPA, logged, returned in
   an error body, or embedded at build time. Flag any `VITE_`-prefixed secret (those ship to the browser).
8. **Rate-limiter / cost-guard bypass.** Limiters are in-process and keyed on client IP. Check whether
   `x-forwarded-for` (or `x-real-ip`) is trusted blindly — an attacker who spoofs the header can rotate
   the key and defeat both the rate limiter and the AI cost guard. Identify the correct trusted-proxy
   handling for Azure App Service.

Also opportunistically flag: CORS/`SameSite`/cookie flags, CSRF on cookie-session endpoints, SSRF in any
server-side fetch, unbounded request/upload sizes, ReDoS in parsers, and error responses that leak stack
traces or internal identifiers.

## Constraints you must respect

- The architecture is fixed: SPA → same-origin `/api/*` → Cosmos/Foundry/Blob. Do not propose moving
  auth to a third-party IdP as the *only* fix — if you recommend it, also give a fix that hardens the
  existing hand-rolled path.
- All AI is server-side; never suggest a client-side model call.
- Every mutation must remain a single atomic Cosmos batch through `/api/db/mutate` — security fixes must
  not break atomicity or the audit hash-chain.
- The app currently assumes a **single App Service instance** (in-memory jti cache, limiters, cost
  guard). Note where that assumption is itself a security weakness (e.g. revocation not shared across
  instances) but keep fixes actionable.

## Output format

Produce a **severity-ranked findings table**, Critical → High → Medium → Low, then details.

| # | Severity | Title | File:line (or file + symbol) | Confidence |
|---|---|---|---|---|

For each finding, below the table, give:

- **Location** — `file:line` and the function/symbol.
- **Exploit scenario** — concrete, step-by-step, from the attacker's starting position (e.g. "holding a
  VIEWER token for tenant A…"). Include the request/payload where relevant.
- **Impact** — what an attacker gains (cross-tenant read, privilege escalation, cost blow-up, etc.).
- **Fix** — specific code change or config, with a snippet or diff sketch. Prefer minimal, targeted fixes
  that preserve the invariants above.
- **Effort** — S/M/L.

Finish with a **top-5 "fix these first"** list and any systemic pattern you saw (e.g. "IP trust is wrong
everywhere it's used"). If you could not verify something without seeing more code, say exactly which
file you need.
