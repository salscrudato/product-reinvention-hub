// Guards the US tile grid: full coverage and — critically — no two states sharing
// a cell (a real bug the previous ad-hoc grid had, where IL and IN overlapped).
import { describe, it, expect } from 'vitest'
import { US_TILE_GRID, US_TILE_ROWS, parseTileGrid } from './usTileGrid'

const USPS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]
// HO-3 seed footprint — every one must have a tile to render.
const HO3_FOOTPRINT = ['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA']

describe('US tile grid', () => {
  it('places all 50 states plus DC', () => {
    expect(Object.keys(US_TILE_GRID)).toHaveLength(51)
    for (const st of [...USPS, 'DC']) expect(US_TILE_GRID[st], `${st} should have a tile`).toBeDefined()
  })

  it('never overlaps two states in the same cell', () => {
    const seen = new Map<string, string>()
    for (const [st, [col, row]] of Object.entries(US_TILE_GRID)) {
      const key = `${col},${row}`
      expect(seen.has(key), `${st} collides with ${seen.get(key)} at ${key}`).toBe(false)
      seen.set(key, st)
    }
  })

  it('covers every HO-3 footprint state', () => {
    for (const st of HO3_FOOTPRINT) expect(US_TILE_GRID[st], `footprint state ${st}`).toBeDefined()
  })

  it('parses tolerantly (irregular whitespace)', () => {
    const g = parseTileGrid(['AL   AK', '  ..  FL '])
    expect(g).toEqual({ AL: [0, 0], AK: [1, 0], FL: [1, 1] })
    expect(US_TILE_ROWS.length).toBe(7)
  })
})
