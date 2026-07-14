# Hardening Corpus - exported from Claude.ai Project Knowledge 2026-07-14

Unzip at repo root. Tier A (samples/ goldens), E (pairs.json), F (manifest),
and G (adjudicated slices) are repo-native or IH1/IH2-generated and are
intentionally absent.

## Duplicate findings (verify before IH1 assertions)

1. EXACT DUPLICATE: Product_Component_Model_Framework_Coverages.xlsx and
   _1.xlsx are byte-identical (md5 ca729a8b...). The "older near-duplicate"
   premise in Tier C is wrong as uploaded. Exact-dup detection still works
   as a fixture, but a true near-dup pair requires modifying one copy.
2. EXACT DUPLICATES: sampleGL{framework,rules,pricing,forms}.xlsx are
   byte-identical to the 20ISO*GL.xlsx set. Tier B double-counts GL.
3. NOT duplicates: the HO3 trio (20BaseFormHO3Homeowners, samplePHbaseformHO3,
   Homeowners__HO3) share identical byte size (4,982,942) but differ in
   content (three distinct md5s). This defeats size-based dedupe - keep all
   three; it is a stronger fixture than intended.
4. Extensionless "1._Product_Framework_-_SECURA_-_Property" confirmed as a
   ZIP/OOXML container - magic-byte routing fixture is valid.

CHECKSUMS.md5 covers every file for IH1 path/integrity verification.
