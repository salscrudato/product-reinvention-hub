// tests/import-brain/hardening-ce3-killtest.test.ts — CE3 Step 7: the SIGKILL kill-test.
//
// Spawns a child running stubbed stage-4 extraction (zero spend, deterministic; see
// fixtures/ce3-kill-runner.mjs), SIGKILLs it after the FIRST per-sheet checkpoint
// lands, then resumes in a fresh child. Proof obligations:
//   1. the killed run really died mid-stage-4 (some sheets have no checkpoint),
//   2. the resume run completes,
//   3. sheets checkpointed before the kill are NEVER re-extracted (zero extraction
//      calls for them in the resume run's call log).
import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const RUNNER = path.resolve(__dirname, 'fixtures/ce3-kill-runner.mjs')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function checkpoints(dir: string): string[] {
  return readdirSync(dir).filter(f => f.startsWith('checkpoint-'))
}

describe('CE3 Step 7: SIGKILL mid-stage-4 → resume completes without re-running completed sheets', () => {
  it('kill-and-resume', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ce3-kill-'))
    try {
      // Run 1: kill as soon as the first sheet checkpoint appears.
      const run1 = spawn(process.execPath, [RUNNER, dir, 'run'], { stdio: 'ignore' })
      const run1Exited = new Promise<void>(resolve => run1.on('exit', () => resolve()))
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        if (checkpoints(dir).length >= 1) break
        await sleep(50)
      }
      expect(checkpoints(dir).length, 'first per-sheet checkpoint landed before the kill').toBeGreaterThanOrEqual(1)
      run1.kill('SIGKILL')
      await run1Exited
      // The kill was mid-run: not every sheet checkpointed, and no done marker exists.
      const beforeResume = checkpoints(dir)
      expect(beforeResume.length).toBeLessThan(3)
      expect(existsSync(path.join(dir, 'done-run.json'))).toBe(false)
      const restoredSheets = beforeResume.map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')).sheetName as string)

      // Run 2: resume — must complete and restore the checkpointed sheets.
      const code = await new Promise<number>((resolve, reject) => {
        const run2 = spawn(process.execPath, [RUNNER, dir, 'resume'], { stdio: 'ignore' })
        run2.on('exit', c => resolve(c ?? -1))
        run2.on('error', reject)
      })
      expect(code, 'resume run exits clean').toBe(0)
      const done = JSON.parse(readFileSync(path.join(dir, 'done-resume.json'), 'utf8'))
      expect(done.restored).toBe(restoredSheets.length)
      expect(checkpoints(dir).length).toBe(3) // every sheet checkpointed by the end

      // The conservation proof: ZERO resume-mode extraction calls for restored sheets.
      const log = readFileSync(path.join(dir, 'call-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
      const resumeCalls = log.filter(e => e.mode === 'resume' && e.sheet)
      for (const sheet of restoredSheets) {
        expect(resumeCalls.filter(e => e.sheet === sheet), `no re-extraction of checkpointed "${sheet}"`).toHaveLength(0)
      }
      // …and the resume run really did extract the sheets the kill orphaned.
      const orphaned = ['Alpha Coverages', 'Beta Coverages', 'Gamma Coverages'].filter(s => !restoredSheets.includes(s))
      for (const sheet of orphaned) {
        expect(resumeCalls.some(e => e.sheet === sheet), `resume extracted orphaned "${sheet}"`).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
