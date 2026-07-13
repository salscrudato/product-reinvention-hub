# Identity Architecture

## Current auth method: email OTP

Near-term identity is email one-time passcode (OTP). A user submits their email; the server
checks it against a config-driven domain allowlist (`ALLOWED_EMAIL_DOMAINS`), generates a
single-use 6-digit code (hashed with HMAC-SHA256, stored in memory with a 10-minute TTL),
and sends it via the email adapter (`EMAIL_PROVIDER`). On verify the server JIT-provisions
the user at VIEWER role, resolves their tenantId from the domain map (`TENANT_DOMAIN_MAP`),
and mints a signed HS256 JWT (`{ sub, email, name, role, tenantId, method:'otp', jti }`).

Break-glass: two seed admins (`admin`, `sal`) authenticate with a username + password via
`POST /api/auth/bootstrap` and receive `role: SUPER_ADMIN`. Codes and passwords are never
logged or stored in plaintext. Every attempt writes an append-only `loginAudit` record in
Cosmos. Seed admins should migrate to normal admin management after the pilot.

## SSO seam: `discoverHomeRealm(email)`

`server/lib/auth.js` exports a stub `discoverHomeRealm(email)` that always returns `null`.
This is the intended insertion point for enterprise SSO. When implemented it should:

1. Parse the email domain.
2. Look up the domain in a configured IdP registry (Cosmos `kind:'idpMapping'` or an
   external directory).
3. Return `{ provider: 'oidc' | 'saml', entityId: string, redirectUrl: string }` so the
   request-OTP handler can redirect to the IdP instead of issuing an OTP.

## Future OIDC/SAML path (unimplemented)

```
POST /api/auth/otp/request { email }
  → discoverHomeRealm(email) returns a non-null IdP record
  → server responds with { redirect: '<idp-url>?state=<nonce>' }

Browser redirects to IdP.

IdP POSTs back to POST /api/auth/sso/callback { state, id_token|SAMLResponse }
  → server verifies the token against IdP public keys / certificate
  → server resolves tenantId from IdP claims (sub, email, groups)
  → server JIT-provisions user (VIEWER), mints platform JWT, sets session
```

### Key design constraints

- `tenantId` is ALWAYS server-derived (from OTP domain map or IdP claim mapping). It is
  never accepted from a client payload.
- `role` is ALWAYS server-derived (Cosmos user record or bootstrap grant). IdP group claims
  are ONLY used as hints to look up a pre-configured role; they never directly set the role.
- `method` in the JWT (`'otp'` | `'bootstrap'` | future `'oidc'` | `'saml'`) is available
  for audit queries and future step-up auth flows.
- All IdP credentials (client secrets, certificates) live in Key Vault / App Service config;
  they are never in the client bundle or source code.

### Recommended libraries (when the time comes)

| Path | Library |
|---|---|
| OIDC (Entra ID, Okta, Auth0) | `openid-client` (Node, no lock-in) |
| SAML | `samlify` or `passport-saml` |
| Azure AD-specific | `@azure/msal-node` |

### Env vars to add (OIDC example)

```
OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/.well-known/openid-configuration
OIDC_CLIENT_ID=<app-registration-client-id>
OIDC_CLIENT_SECRET=<Key Vault ref>
OIDC_REDIRECT_URI=https://prodhub.example.com/api/auth/sso/callback
IDP_DOMAIN_MAP={"accenture.com":"oidc:accenture"}   # domain → IdP entry in idpRegistry
```
