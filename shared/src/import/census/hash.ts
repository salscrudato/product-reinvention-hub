// shared/src/import/census/hash.ts — FNV-1a 64-bit over UTF-16 code units.
// Deterministic, dependency-free, platform-free (BigInt is universal). Used for
// cell value hashes and sheet fingerprints — a stable identity for "same bytes",
// NOT a cryptographic commitment (the audit chain owns that).

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

/** fnv1a64(s) -> 16-hex-char lowercase digest of the string's code units. */
export function fnv1a64(s: string): string {
  let h = FNV_OFFSET
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i)
    // Mix both bytes of the UTF-16 code unit so non-ASCII text hashes fully.
    h = ((h ^ BigInt(cu & 0xff)) * FNV_PRIME) & MASK64
    h = ((h ^ BigInt(cu >>> 8)) * FNV_PRIME) & MASK64
  }
  return h.toString(16).padStart(16, '0')
}
