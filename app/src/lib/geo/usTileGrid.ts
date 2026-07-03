// usTileGrid.ts — a geographic tile-grid layout of the US (50 states + DC), each
// state at an approximate [col,row]. Authored as a visual string grid so tile
// positions are easy to verify; parsed once to coordinates. Consumed by the
// States map; guarded by usTileGrid.test.ts (no duplicate tiles, full coverage).

export const US_TILE_ROWS = [
  'WA .. .. .. .. .. .. .. .. .. .. ME',
  'OR ID MT ND MN WI .. MI .. NY VT NH',
  'NV UT WY SD IA IL IN OH PA NJ CT MA',
  'CA AZ CO NE MO KY WV VA MD DE RI ..',
  '.. NM KS OK AR TN NC SC DC .. .. ..',
  '.. .. TX LA MS AL GA FL .. .. .. ..',
  'AK HI .. .. .. .. .. .. .. .. .. ..',
] as const

export const US_TILE_COLS = 12

export function parseTileGrid(rows: readonly string[]): Record<string, [number, number]> {
  const grid: Record<string, [number, number]> = {}
  rows.forEach((row, r) => row.trim().split(/\s+/).forEach((st, c) => {
    if (st !== '..') grid[st] = [c, r]
  }))
  return grid
}

export const US_TILE_GRID = parseTileGrid(US_TILE_ROWS)
