// Insurance domain vocabulary powering type-ahead suggestions across authoring
// surfaces (new product, limit options, rule composer). Central so the same
// standard values appear everywhere a PM enters data.
import type { LimitStructure, DeductibleStructure, LimitBasis } from '@pf/shared'

export const PRODUCT_NAME_SUGGESTIONS = [
  'Homeowners — HO-3 Special Form',
  'Homeowners — HO-5 Comprehensive',
  'Homeowners — HO-6 Unit-Owners (Condo)',
  'Renters — HO-4 Contents',
  'Dwelling Fire — DP-3',
  'Landlord — DP-1',
  'Mobile Homeowners — MH',
  'Personal Umbrella',
  'Personal Auto',
  'Private Flood',
  'Personal Earthquake',
]

export const MARKET_SEGMENTS = [
  'Personal Lines / Property',
  'Personal Lines / Liability',
  'Personal Lines / Auto',
  'Commercial Lines / Property',
  'Commercial Lines / Liability',
]

// ── Limit / deductible STRUCTURE catalogue (UI copy). `icon` keys into the
//    editor's structure-icon map; pure term logic lives in @pf/shared/terms. ──
interface StructureMeta<T extends string> {
  id: T; label: string; blurb: string; sample: string; icon: string
}

export const LIMIT_STRUCTURES: StructureMeta<LimitStructure>[] = [
  { id: 'SINGLE',               label: 'Single Limit',          blurb: 'One limit applies to all covered loss.',                                    sample: '$1,000,000',     icon: 'single' },
  { id: 'OCCURRENCE_AGGREGATE', label: 'Occurrence + Aggregate', blurb: 'Per-occurrence limit plus a policy aggregate.',                             sample: '$1M / $2M',      icon: 'layers' },
  { id: 'EACH_CLAIM_AGGREGATE', label: 'Each Claim + Aggregate', blurb: 'Per-claim limit with a policy-term aggregate (common in claims-made).',     sample: '$1M / $3M',      icon: 'layers' },
  { id: 'SPLIT',                label: 'Split Limits',           blurb: 'Separate limits by component (e.g. BI per person / per accident / PD).',    sample: '100 / 300 / 100', icon: 'split' },
  { id: 'CSL',                  label: 'Combined Single Limit',  blurb: 'One limit covering bodily injury and property damage combined.',            sample: '$1,000,000',     icon: 'combine' },
  { id: 'SCHEDULED',            label: 'Scheduled / Per-Item',   blurb: 'Itemised values, each carrying its own limit.',                             sample: 'per item',       icon: 'scheduled' },
]

export const DEDUCTIBLE_STRUCTURES: StructureMeta<DeductibleStructure>[] = [
  { id: 'FLAT',            label: 'Flat Dollar',          blurb: 'Fixed dollar amount deductible.',                        sample: '$1,000',                   icon: 'single' },
  { id: 'PERCENT',         label: 'Percentage',           blurb: 'Percentage of insured value or loss.',                   sample: '2% of TIV',                icon: 'percent' },
  { id: 'PERCENT_MIN_MAX', label: 'Percentage w/ Min/Max', blurb: 'Percentage with minimum and maximum dollar bounds.',    sample: '2% ($1k min / $25k max)',  icon: 'percent' },
  { id: 'WAITING_PERIOD',  label: 'Waiting Period',       blurb: 'Time-based deductible (hours/days).',                    sample: '72 hours',                 icon: 'clock' },
  { id: 'SPLIT',           label: 'By Peril',             blurb: 'Separate deductibles by peril or component.',            sample: 'Wind 2% · AOP $1,000',     icon: 'peril' },
]

export const LIMIT_BASES: { id: LimitBasis; label: string }[] = [
  { id: 'PER_OCCURRENCE', label: 'Per Occurrence' },
  { id: 'AGGREGATE',      label: 'Aggregate' },
  { id: 'PER_PERSON',     label: 'Per Person' },
  { id: 'PER_CLAIM',      label: 'Per Claim' },
  { id: 'PER_ITEM',       label: 'Per Item' },
  { id: 'PER_LOCATION',   label: 'Per Location' },
]
