// webauthn.ts — browser-side passkey helpers.
//
// The server speaks @simplewebauthn JSON (base64url strings everywhere); the browser's
// navigator.credentials API speaks ArrayBuffers. These helpers convert in both
// directions by hand — ~60 lines beats a dependency, and it works on every browser
// that has WebAuthn at all (the native parse/toJSON helpers are newer than WebAuthn).
//
// Two flows:
//   getPasskeyAssertion()      — sign-in. mediation:'conditional' arms the browser's
//                                autofill surface (zero-UI until the user taps the
//                                suggestion); 'optional' opens the modal immediately.
//   createPasskeyCredential()  — enrollment (post-auth).

type Json = Record<string, unknown>

function b64uToBuf(s: string): ArrayBuffer {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function bufToB64u(buf: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** True when the browser has a WebAuthn implementation at all. */
export function supportsPasskeys(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window
}

/** True when the browser can surface passkeys through form autofill (conditional UI). */
export async function supportsConditionalUI(): Promise<boolean> {
  if (!supportsPasskeys()) return false
  try {
    return (await window.PublicKeyCredential.isConditionalMediationAvailable?.()) ?? false
  } catch { return false }
}

interface CredDescriptorJson { id: string; type?: string; transports?: string[] }

/** Sign in with a discoverable passkey. Returns the assertion serialized for the server. */
export async function getPasskeyAssertion(
  optionsJson: Json,
  opts?: { conditional?: boolean; signal?: AbortSignal },
): Promise<Json> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...(optionsJson as object),
    challenge: b64uToBuf(String(optionsJson.challenge)),
    allowCredentials: ((optionsJson.allowCredentials as CredDescriptorJson[] | undefined) ?? []).map((c) => ({
      id: b64uToBuf(c.id),
      type: 'public-key' as const,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  } as PublicKeyCredentialRequestOptions
  const cred = (await navigator.credentials.get({
    publicKey,
    mediation: opts?.conditional ? ('conditional' as CredentialMediationRequirement) : undefined,
    signal: opts?.signal,
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('passkey_cancelled')
  const r = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufToB64u(r.clientDataJSON),
      authenticatorData: bufToB64u(r.authenticatorData),
      signature: bufToB64u(r.signature),
      userHandle: r.userHandle ? bufToB64u(r.userHandle) : undefined,
    },
  }
}

/** Enroll a new passkey. Returns the attestation serialized for the server. */
export async function createPasskeyCredential(optionsJson: Json): Promise<Json> {
  const user = optionsJson.user as { id: string; name: string; displayName: string }
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...(optionsJson as object),
    challenge: b64uToBuf(String(optionsJson.challenge)),
    user: { ...user, id: b64uToBuf(user.id) },
    excludeCredentials: ((optionsJson.excludeCredentials as CredDescriptorJson[] | undefined) ?? []).map((c) => ({
      id: b64uToBuf(c.id),
      type: 'public-key' as const,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  } as PublicKeyCredentialCreationOptions
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null
  if (!cred) throw new Error('passkey_cancelled')
  const r = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufToB64u(r.clientDataJSON),
      attestationObject: bufToB64u(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
  }
}
