# Phase G — G4 failure clusters (from the G3 no-edit baseline at HOLDOUT_SHA d51e32f)

G3: 4/7 variants green (v1 moved-preamble, v3 merged-banner, v6 renamed-sheets floor,
v7 unfamiliar-layout). Three reds → four clusters (v4 decomposes into two):

| Cluster | Ledger id | From | Defect | Right layer |
|---|---|---|---|---|
| **ALIAS-AMBIGUITY** | G-A | v2 | The bare `ID` header alias resolves first-positionally; under column permutation (or any real workbook whose state matrix sits left of the id column) it matches **Idaho's state column** — every coverage id becomes "X", ids collide, the coverage set collapses to 1 and the product row is never recognized. | Mapper header-alias resolution (`isoImport.ts`): specificity-ranked matching, never bare-generic-first. |
| **SEPARATOR-NOTATION** | G-B | v4 | Product/coverage KIND recognition dot-splits refIds; `GL-PROD-001` (dash notation) is not recognized as a product row. Extracted ids ARE carried byte-for-byte (invariant held) — recognition is the gap. | Registry parser (`lobRegistry.ts refIdSegmentKind`): kind parsing tolerates `-`/`.` separators; output ids stay verbatim (F05 lesson: parsing lives in the registry). |
| **JUNK-PREFIX-SYNTH** | G-C | v4+v2 | When no product row is recognized, SYNTH minting derives its prefix by an unvalidated string slice of the first coverage id → `GL-COV-.PROD.SYNTH001`, `X.PROD.SYNTH001` — garbage ids carrying the platform marker. | Synthesis site (`isoImport.ts`): derived prefix must resolve against `LOB_REGISTRY`; unresolvable → warned `DEFAULT_LOB` prefix (F18 warned-default pattern). |
| **FABRICATION-ON-SILENCE** | G-D | v5 (+G1 audit clusters \*-SILENCE) | Blank requirement → `MANDATORY` (silent); blank form category → `ENDORSEMENT` marked `exact:true` (silent); blank mandatory/dynamic/admitted → boolean defaults (silent). | Mapper honesty (`isoImport.ts`): requirement blank → `UNKNOWN` (type supports it since F14) with lockstep golden regen; blank category/boolean cells → **warned defaults** (F18: "a defaulted value must always be a WARNED default"), `exact:false`. Full `boolean|null` honesty for the form boolean trio (F14 premiumGenerating precedent) is PARKED with trigger — fabrication becomes warned, no longer silent. |

Honesty-contract note (recorded BEFORE any G5 fix): the frozen v5 checker demanded
`mandatoryDefault ∈ {null, undefined, UNKNOWN}` — a contract that presumes the F14-style
type change. The platform's judged honesty floor is the warned default (F18). The checker
is revised to: a blank cell may carry the documented default **only if** the plan carries a
warning naming the defaulting; `requirement` stays strict (`UNKNOWN`), since the type
already supports it. The stricter null-honesty for booleans is PARKED (trigger: any
consumer that must distinguish stated-false from unstated).

Non-cluster residuals (G1 audit, recorded not fixed): scaffold forced enum
(verified-deliberate design flow), coverageHierarchy punctuation nameKey (F11 recorded
residual), emit() stringify swallow (low reachability, surfaced via run:persisted when
runId present), no-TTL import-results blobs (ops lifecycle rule), browser runId minting
(successor product slice).
