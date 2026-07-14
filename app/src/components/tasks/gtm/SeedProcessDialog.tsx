// SeedProcessDialog — seed the board from the generic L1–L4 insurance product process.
// Choose which L2 phases to include (default all), business- vs calendar-days, and see a
// LIVE preview (task count, critical path, computed start, that it lands on the deadline,
// and a compression warning when the deadline is too soon). Confirm → the whole set is
// back-scheduled and written through adapter.db.mutateBatch() (atomic, chunked, audited).
// Re-seeding first clears prior seeded tasks (ad-hoc tasks are preserved).
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { adapter } from '../../../lib/backend'
import { Dialog, Button } from '../../ui'
import { IconWarning, IconCheck } from '../../ui/icons'
import { GTM_PROCESS_TEMPLATE, scheduleFromDeadline } from '@pf/shared'
import { GTM_PHASES, buildSeedPayloads, todayISO, fmtShort, type ProjectDoc, type TaskDoc } from './gtm'

interface Props {
  project:     ProjectDoc
  priorSeeded: TaskDoc[]
  actor:       { uid: string; name: string }
  onClose:     () => void
}

export function SeedProcessDialog({ project, priorSeeded, actor, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(GTM_PHASES.map(p => p.name)))
  const [businessDays, setBusinessDays] = useState(true)
  const [busy, setBusy] = useState(false)

  const toggle = (name: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const selectedKey = [...selected].sort().join('|')
  const { subset, schedule } = useMemo(() => {
    const subset = GTM_PROCESS_TEMPLATE.filter(t => selected.has(t.phaseL2))
    const schedule = scheduleFromDeadline(subset, project.targetLaunchDate, { businessDays, today: todayISO() })
    return { subset, schedule }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, businessDays, project.targetLaunchDate])

  const warning = schedule.warnings[0]
  const canSeed = subset.length > 0 && !busy

  async function confirm() {
    if (!canSeed) return
    setBusy(true)
    try {
      await adapter.db.mutateBatch(buildSeedPayloads(project, schedule.tasks, priorSeeded, actor))
      toast.success(`${schedule.tasks.length} tasks scheduled to ${fmtShort(project.targetLaunchDate)}`)
      onClose()
    } catch {
      toast.error('Could not seed the board')
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Seed tasks from process">
      <p className="text-[12.5px] text-dim -mt-2 mb-4">
        Generic insurance product-management process. Tasks are back-scheduled so the last
        pre-launch task lands on your deadline; governance trails after launch.
      </p>

      {/* Phase checklist */}
      <div className="flex flex-col gap-1 mb-4">
        <span className="text-[12px] font-semibold text-dim mb-1">Phases to include</span>
        {GTM_PHASES.map(ph => {
          const tasks = GTM_PROCESS_TEMPLATE.filter(t => t.phaseL2 === ph.name)
          const days = tasks.filter(t => !t.ongoing).reduce((s, t) => s + t.slaDays, 0)
          const on = selected.has(ph.name)
          return (
            <label key={ph.name}
              className="flex items-center gap-3 px-2.5 py-2 rounded-[10px] cursor-pointer transition-colors hover:bg-raised">
              <input type="checkbox" checked={on} onChange={() => toggle(ph.name)}
                className="w-4 h-4 accent-[var(--color-accent)] shrink-0" />
              <span className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: `var(${ph.cssVar})` }} />
              <span className="flex-1 text-[13px] font-medium text-text">{ph.name}</span>
              <span className="text-[11px] text-faint font-semibold">
                {tasks.length} tasks · {ph.name === 'Product Governance & Monitoring' ? 'post-launch' : `${days}d`}
              </span>
            </label>
          )
        })}
      </div>

      {/* Working-time toggle */}
      <div className="flex flex-col gap-1.5 mb-4">
        <span className="text-[12px] font-semibold text-dim">Count working time in</span>
        <div className="flex gap-1.5 p-1 rounded-[11px] bg-raised" style={{ border: '1px solid var(--color-border)' }}>
          {([['Business days', true], ['Calendar days', false]] as const).map(([label, val]) => (
            <button key={label} type="button" onClick={() => setBusinessDays(val)}
              aria-pressed={businessDays === val}
              className={`flex-1 py-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors ${
                businessDays === val ? 'bg-surface text-text shadow-sm' : 'text-dim hover:text-text'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-[12px] p-3.5 text-[12.5px]"
        style={{
          background: warning ? 'var(--color-danger-soft)' : 'var(--color-raised)',
          border: `1px solid ${warning ? 'var(--color-danger-line)' : 'var(--color-border)'}`,
        }}>
        {subset.length === 0 ? (
          <div className="text-faint">Nothing selected — choose at least one phase.</div>
        ) : (
          <>
            <PreviewRow k="Tasks" v={String(subset.length)} />
            <PreviewRow k="Critical path" v={`${schedule.criticalPathDays} business days`} />
            <PreviewRow k="Starts" v={fmtShort(schedule.projectStartDate)} />
            <PreviewRow k="Lands on launch" v={fmtShort(project.targetLaunchDate)} />
            {warning && (
              <div className="flex items-center gap-1.5 mt-2 text-danger font-semibold text-[12px]">
                <IconWarning size={14} aria-hidden="true" />
                Needs {warning.neededDays} days but only {warning.availableDays} remain — starts fall in the past.
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 mt-5">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void confirm()} disabled={!canSeed}>
          <IconCheck size={14} aria-hidden="true" />
          {priorSeeded.length > 0 ? 'Re-seed board' : 'Seed board'}
        </Button>
      </div>
    </Dialog>
  )
}

function PreviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-faint font-semibold">{k}</span>
      <span className="font-bold text-text">{v}</span>
    </div>
  )
}
