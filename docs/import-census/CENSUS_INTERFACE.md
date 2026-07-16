# CE1 census <-> CE2 eval2 interface (consumed as DATA, never as a code import)

CE1 (lane `ce1-census`) and CE2 (lane `ce2-goldens`) are built in parallel worktrees. They
share NO code — only this file format. `scripts/import-eval2.mts` reads a census JSON via
`--census <path>` and treats it as opaque data. CE5 reconciles the lanes at merge.

## Census JSON shape (`ce1-census/v1`)

```json
{
  "schema": "ce1-census/v1",
  "files": [
    {
      "file": "Product_Framework_SECURA_Property.xlsx",
      "sha256": "…",
      "sheets": [
        {
          "name": "Product Component Model",
          "hidden": false,
          "nonEmpty": 6668,
          "accounted": ["A3", "B3", "C3"]     // A1 refs the PIPELINE accounted for (optional)
        }
      ]
    }
  ]
}
```

- `nonEmpty` (required per sheet): the count CE1's census computed for that sheet. eval2's
  `reconcileCensus()` compares it against CE2's own `cell-enum` nonEmpty for the same sheet and
  FAILS the run on any disagreement (hostile self-review Q4 — one of the two is wrong, and CE5
  must see it, not trust a green board).
- `accounted` (optional per sheet): the A1 refs the pipeline captured. When present, eval2 uses
  it as the authoritative accounted set (loci `"<sheet>!<ref>"`). When absent (or no `--census`),
  eval2 derives "accounted" itself:
    - LIVE / `--bundle` with provenance -> the bundle's provenance loci (exact).
    - OFFLINE (deterministic plan, no provenance) -> a value-presence proxy: a source cell is
      "accounted" iff its (numeric-canonicalized) value survives into the extracted plan. This is
      a proxy, documented as such; it correctly reddens on cells whose CONTENT never reached the
      plan (hidden sheets, unread columns), which is the data-loss signal CE2 exists to expose.

## What eval2 asserts using the census

`reconcileCensus(enumNonEmpty, censusNonEmpty)` — per-sheet nonEmpty parity between the two lanes.
A mismatch means CE1 and CE2 disagree on how many cells a sheet even HAS; that must block, because
every downstream coverage number is computed against a nonEmpty denominator.
