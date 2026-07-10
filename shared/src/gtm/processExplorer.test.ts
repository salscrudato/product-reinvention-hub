// Converter tests — the deterministic Process Value Explorer → GtmTemplateTask mapping.
// Proves the 4E drop (Exclude rows never become tasks), the per-group SLA dedup, the
// go-live column split, ongoing handling, the blank-SLA default, and one exact end-to-end row.
import { describe, it, expect } from 'vitest'
import { convertProcessExplorer, dispositionCounts, DEFAULT_SLA_DAYS, type ProcessExplorerRow } from './processExplorer'

// A compact, representative slice of the Product Manufacture rows (same shape the reader emits).
const ROWS: ProcessExplorerRow[] = [
  // Product Strategy group — all Exclude → the whole group is dropped.
  { level1: 'Product Manufacture', level2: 'Product Research', level3: 'Product Strategy', level4: 'Assess strategic vision', pointOfContact: 'Chief Product Officer (Primary); Strategy Lead', sla: 5, typeOfWork: 'Differentiating', valueOfWork: 'Directly Contributes', disposition: 'Exclude', complexFlow: '1' },
  { level1: 'Product Manufacture', level2: 'Product Research', level3: 'Product Strategy', level4: 'Define product intent', pointOfContact: 'Product Mgr. (Primary)', sla: 5, typeOfWork: 'Differentiating', valueOfWork: 'Directly Contributes', disposition: 'Exclude' },
  // Market Intelligence — two kept rows in one group: SLA lands on the first only.
  { level1: 'Product Manufacture', level2: 'Product Research', level3: 'Market Intelligence & Ideation', level4: 'Establish marketplace trends', pointOfContact: 'Market Research Analyst (Primary); Strategy Lead', sla: 2, typeOfWork: 'Analytical', valueOfWork: 'Enables', disposition: 'Embrace' },
  { level1: 'Product Manufacture', level2: 'Product Research', level3: 'Market Intelligence & Ideation', level4: 'Assess macro trends', pointOfContact: 'Strategy Lead (Primary)', sla: 2, typeOfWork: 'Analytical', valueOfWork: 'Enables', disposition: 'Embrace' },
  // Stage Gate — blank SLA + blank 4E/type/value (the un-disposed gate).
  { level1: 'Product Manufacture', level2: 'Product Research', level3: 'Stage Gate', level4: 'Approvals from all stakeholders', pointOfContact: '', sla: '', typeOfWork: '', valueOfWork: '', disposition: '' },
  // A go-live Product Launch task → LAUNCH & MONITOR (not the phase's default TEST & APPROVE).
  { level1: 'Product Manufacture', level2: 'Product Launch', level3: 'Product Roll-Out', level4: 'Manage product launch', pointOfContact: 'Chief Product Officer (Primary)', sla: 5, typeOfWork: 'Transactional', valueOfWork: 'Directly Contributes', disposition: 'Enhance' },
  // A non-go-live Product Launch task → TEST & APPROVE.
  { level1: 'Product Manufacture', level2: 'Product Launch', level3: 'Product Roll-Out', level4: 'Define roll-out plan', pointOfContact: 'Product Mgr. (Primary)', sla: 5, typeOfWork: 'Transactional', valueOfWork: 'Enables', disposition: 'Embrace' },
  // Governance — SLA "ongoing" → slaDays 0 + ongoing:true, post-launch.
  { level1: 'Product Manufacture', level2: 'Product Governance & Monitoring', level3: 'Product Performance', level4: 'Manage product KPIs', pointOfContact: 'Product Mgr. (Primary)', sla: 'ongoing', typeOfWork: 'Transactional', valueOfWork: 'Enables', disposition: 'Embrace' },
  // A header / blank row that must be skipped (no Level 4 name).
  { level1: 'Product Manufacture', level2: 'Product Research', level3: 'Market Intelligence & Ideation', level4: '', pointOfContact: '', sla: '', typeOfWork: '', valueOfWork: '', disposition: 'Embrace' },
]

describe('convertProcessExplorer', () => {
  const tasks = convertProcessExplorer(ROWS)
  const byTitle = (t: string) => tasks.find(x => x.taskL4 === t)

  it('drops every Exclude-disposed row and the empty row', () => {
    // 9 input rows: 2 Exclude + 1 empty dropped → 6 tasks.
    expect(tasks).toHaveLength(6)
    expect(byTitle('Assess strategic vision')).toBeUndefined()
    expect(byTitle('Define product intent')).toBeUndefined()
    // No surviving task is ever disposed Exclude.
    expect(tasks.every(t => t.disposition !== 'Exclude')).toBe(true)
  })

  it('counts rows by disposition (Exclude counts the dropped rows)', () => {
    expect(dispositionCounts(ROWS)).toEqual({ Exclude: 2, Embrace: 4, Enhance: 1, '(none)': 1 })
  })

  it('places a group SLA on the first kept task only (dedup — never sla × rows)', () => {
    expect(byTitle('Establish marketplace trends')!.slaDays).toBe(2)   // first of the group
    expect(byTitle('Assess macro trends')!.slaDays).toBe(0)            // sibling → 0
  })

  it('defaults a blank SLA to DEFAULT_SLA_DAYS and leaves blank enums empty', () => {
    const gate = byTitle('Approvals from all stakeholders')!
    expect(gate.slaDays).toBe(DEFAULT_SLA_DAYS)
    expect(gate.ongoing).toBe(false)
    expect(gate.typeOfWork).toBe('')
    expect(gate.valueOfWork).toBe('')
    expect(gate.disposition).toBe('')
    expect(gate.owner).toBe('Unassigned')
  })

  it('routes go-live Product Launch tasks to LAUNCH & MONITOR, others to TEST & APPROVE', () => {
    expect(byTitle('Manage product launch')!.boardColumn).toBe('LAUNCH & MONITOR')
    expect(byTitle('Define roll-out plan')!.boardColumn).toBe('TEST & APPROVE')
  })

  it('maps an "ongoing" governance SLA to 0 days + ongoing:true, phaseOrder 5', () => {
    const kpi = byTitle('Manage product KPIs')!
    expect(kpi.ongoing).toBe(true)
    expect(kpi.slaDays).toBe(0)
    expect(kpi.phaseOrder).toBe(5)
    expect(kpi.boardColumn).toBe('LAUNCH & MONITOR')
  })

  it('maps one row end-to-end, exactly', () => {
    expect(byTitle('Establish marketplace trends')).toEqual({
      globalOrder: 1,                    // first kept row (Product Strategy Excludes precede it)
      phaseL2:     'Product Research',
      groupL3:     'Market Intelligence & Ideation',
      taskL4:      'Establish marketplace trends',
      boardColumn: 'IDEATION & DESIGN',
      phaseOrder:  1,
      slaDays:     2,
      ongoing:     false,
      owner:       'Market Research Analyst',   // primary contact, "(Primary)" + secondary stripped
      typeOfWork:  'Analytical',
      valueOfWork: 'Enables',
      disposition: 'Embrace',
    })
  })

  it('numbers globalOrder densely over kept rows (1..N)', () => {
    expect(tasks.map(t => t.globalOrder)).toEqual([1, 2, 3, 4, 5, 6])
  })
})
