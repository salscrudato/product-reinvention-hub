# Hardening: Fixture Manifest

smoke.mjs checks every path in this manifest at startup before running any probe.
A missing fixture is an immediate hard failure — the harness never silently skips a path.

## Expected fixtures

| Path (repo-relative) | Description | Status |
|---|---|---|
| `samples/duckcreek/DuckCreekXML.xml` | AIG PCG Naples-FL coastal-wind PersonalHome DuckCreek OnlineData.loadPolicyRs | REQUIRED |
| `samples/duckcreek/PolicyXML.xml` | Byte-twin of DuckCreekXML.xml | REQUIRED |
| `samples/filings/nj-lemonade-ho/LEM 03 05 23 Lemonade Homeowners_FINAL.pdf` | Lemonade NJ HO-3 policy form filing (primary HO smoke fixture) | REQUIRED |
| `samples/filings/nj-lemonade-ho/NJ HO Manual 02.27.24.pdf` | NJ Homeowners Manual | REQUIRED |
| `samples/filings/nj-lemonade-ho/NJ HO Rate Order of Calculations.pdf` | NJ HO Rate Order of Calculations | REQUIRED |
| `samples/iso/20-BaseForm-HO3-Homeowners.pdf` | ISO HO-3 base form (golden reference) | REQUIRED |
| `samples/iso/20-ISO-Forms-GL.xlsx` | ISO GL forms workbook | REQUIRED |
| `samples/iso/20-ISO-Framework-GL.xlsx` | ISO GL framework workbook | REQUIRED |
| `samples/iso/20-ISO-Pricing-GL.xlsx` | ISO GL pricing workbook | REQUIRED |
| `samples/iso/20-ISO-Rules-GL.xlsx` | ISO GL rules workbook | REQUIRED |
| `samples/mock/mock-HO3-baseform.md` | Expected-field fixture for HO-3 extraction regression diffing | REQUIRED |
| `samples/mock/mock-GL-baseform.md` | Expected-field fixture for GL extraction regression diffing | REQUIRED |
| `samples/process-value-explorer.xlsx` | Process Value Explorer workbook (ADR-0006, GTM process) | REQUIRED |

**Note on process-value-explorer.xlsx:** This file lives at `samples/process-value-explorer.xlsx`,
NOT at the repository root.  Some documentation implies a root location — the code is authoritative.

## Verification in smoke.mjs

```
// smoke.mjs startup fixture check (abridged)
const FIXTURES = [
  'samples/duckcreek/DuckCreekXML.xml',
  'samples/duckcreek/PolicyXML.xml',
  'samples/filings/nj-lemonade-ho/LEM 03 05 23 Lemonade Homeowners_FINAL.pdf',
  'samples/filings/nj-lemonade-ho/NJ HO Manual 02.27.24.pdf',
  'samples/filings/nj-lemonade-ho/NJ HO Rate Order of Calculations.pdf',
  'samples/iso/20-BaseForm-HO3-Homeowners.pdf',
  'samples/iso/20-ISO-Forms-GL.xlsx',
  'samples/iso/20-ISO-Framework-GL.xlsx',
  'samples/iso/20-ISO-Pricing-GL.xlsx',
  'samples/iso/20-ISO-Rules-GL.xlsx',
  'samples/mock/mock-HO3-baseform.md',
  'samples/mock/mock-GL-baseform.md',
  'samples/process-value-explorer.xlsx',
]
// Any missing → SMOKE FAIL: fixture missing: <path>
```

## Audit trail (how smoke.mjs verifies the Cosmos atomic batch)

After each successful `POST /api/db/mutate`, the server returns `{ ok: true, rev }`.
The harness then calls `GET /api/db/get?path=<entity-path>` and asserts:
- The entity exists and its `rev` matches what mutate returned.
- The `updatedAt` field is a recent ISO timestamp.

These properties are only set by the `envelope()` function in `server/lib/data.js`, which
commits entity + AuditEvent + Version + searchIndex atomically in a single Cosmos transactional
batch.  A Cosmos batch failure causes `mutate` to return HTTP 500 — if `mutate` returned 200,
all four documents were committed.

Direct querying of audit/version/searchIndex kinds is not exposed by the current `/api/db/*`
surface (the list endpoint serves `kind:'entity'` documents only).  The smoke harness verifies
the batch indirectly via the rev and updatedAt fields on the entity.
