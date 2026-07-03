// Insurance domain vocabulary powering type-ahead suggestions across authoring
// surfaces (new product, limit options, rule composer). Central so the same
// standard values appear everywhere a PM enters data.

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

// Common currency limit/deductible amounts and coverage percentages.
export const LIMIT_AMOUNTS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 300000, 500000, 1000000]
export const PERCENT_OPTIONS = [1, 2, 5, 10, 25, 30, 50, 70, 75, 100]
