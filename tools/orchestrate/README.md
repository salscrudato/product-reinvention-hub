# Orchestration harness (prompts 03 to 07)

A local runner that executes the remaining product prompts as chained,
non-interactive Claude Code sessions, running the full quality gate and the
rating canary after each one. It orchestrates only: it never edits product
code, never touches a canary, and its own code never runs `git push`,
`git remote`, `gh`, or a deploy.

```
tools/orchestrate/
  run.mjs            one cross-platform Node ESM runner (PowerShell and bash)
  prompts/           one file per prompt, read VERBATIM as the session prompt
    03-authz.md
    04-filing.md
    05-portal.md
    06-ops.md
    07-ship.md
  run/<timestamp>/   per-run logs + SUMMARY.md   (gitignored)
  README.md
```

## 1. Paste the prompts

Open each file under `prompts/` and replace its contents (or paste below the
placeholder comment) with the full text of that product prompt. The runner reads
each file verbatim and streams it to the session over stdin, so formatting,
newlines, and quotes are preserved exactly. A file that is empty apart from the
`ORCHESTRATE-PLACEHOLDER` comment is treated as unfilled and the runner refuses
to launch it.

## 2. Always dry-run first

```sh
node tools/orchestrate/run.mjs --dry-run
```

This prints, for every prompt in range, the exact fresh-session invocation, the
gate command, the canary command and expected values, and the checkpoint tag,
then the final-verification plan. It executes nothing: no sessions, no tags, no
gates. Read it before every real run.

## 3. Run

```sh
# paused (default): stop for Enter between prompts, mirroring a human gate band
node tools/orchestrate/run.mjs

# chained: run every prompt back to back with no pauses
node tools/orchestrate/run.mjs --auto

# a sub-range (e.g. just the build prompts, stopping before ship)
node tools/orchestrate/run.mjs --from 03 --to 06
```

Flags: `--from <id>` / `--to <id>` (default `03`..`07`), `--auto` (no pauses),
`--dry-run`, `--max-turns <N>` (default 300), `--max-budget-usd <X>` (default 50).

### What happens per prompt

1. Tag a checkpoint `orchestrate/pre-<name>-<timestamp>`.
2. Launch a fresh `claude -p` session (stream-json, verbose), teeing output to
   `run/<timestamp>/<id>-<name>.log`.
3. Run the gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
4. Run only the canary: `pnpm exec vitest run shared/src/rating/workedExample.canary.test.ts`
   and assert PH $1528 / PA $1002 / GL $2635.
5. Assert HEAD advanced by at least one commit and the tree is clean.

Any failure halts the chain immediately, prints the failing prompt with the tail
of its log and the failing gate output, leaves the checkpoint tag in place, and
exits non-zero. On success the runner writes `run/<timestamp>/SUMMARY.md` and
prints a one-line GREEN or RED verdict.

## Why fresh processes (no --resume / --continue / --bare)

Each prompt runs in its own new Claude Code process. State that must carry
forward lives in git commits and files on disk, not in a conversation
transcript, so a fresh process starting from a clean, committed tree is the
correct isolation boundary (the `/clear` equivalent). We do not pass `--bare`,
because the prompts require `CLAUDE.md` and `docs/` auto-discovery to load.

## Permission model

Build prompts (03 to 06) run under `--permission-mode dontAsk` against the
project allowlist in `.claude/settings.json`:

```
Read, Grep, Glob, Edit, Write,
Bash(pnpm *), Bash(node *),
Bash(git add *|commit *|status *|diff *|log *|tag *|rev-parse *|checkout *|restore *|merge *)
```

That allowlist deliberately excludes `Bash(git push *)`, `Bash(git remote *)`,
`Bash(gh *)`, and any unscoped `Bash`.

Important reconciliation: on this machine the user-global
`~/.claude/settings.json` allow-list already contains `Bash(git push:*)`,
`Bash(gh repo:*)`, and `Bash(git remote *)`. Claude Code unions allow rules
across settings levels, so under `dontAsk` a build prompt would otherwise be
auto-approved to push. To make 03 to 06 genuinely unable to push, the runner
passes per-session `--disallowedTools` for push / remote / gh. A deny beats an
allow at every level, so this is authoritative regardless of user-global
settings. We do NOT put a persistent `deny` in the project settings, because
that would also block 07's legitimate push.

Ship prompt (07) is FULLY UNATTENDED (see below). It runs under `dontAsk` with
an explicit `--allowedTools` set that adds the shipping tools it needs
(`git push`, `git remote`, `git fetch/pull`, `gh`, `gitleaks`, `az`, `npx`) on
top of the base tools. It is still fail-closed: no unscoped `Bash`, and no
`bypassPermissions`. If 07 halts because it needed a tool that is not listed,
widen `SHIP_EXTRA` in `run.mjs` and re-run. Do not reach for
`--dangerously-skip-permissions` / `bypassPermissions`: it is fail-open (the
session could run any command with production push access) and is only ever
appropriate on a throwaway, unmanaged machine with no network access. It is
never used here.

## 07 is unattended (production push + deploy)

By explicit instruction, 07 runs automated as part of the chain: it merges,
pushes to GitHub then Azure, and triggers a production deploy with no live
approval prompt. (The original design ran 07 as an attended interactive session
where a human approved each push/deploy live; that was changed on request.) The
safety net is the gate + canary that run before 07 (via prompt 06) and again
after it, plus 07's own internal stops defined in its prompt text: RISK-001
secret rotation, a gitleaks full-history scan, `gh auth`, and Azure branch
policy. The runner records, from 07's session log, whether the GitHub push, the
Azure push, and the deploy trigger occurred, and writes them into SUMMARY.md.

The runner itself never pushes or deploys. Only the 07 session (driven by
Claude) does.

## This harness is not a diff review

Passing gate + canary is necessary, not sufficient. Prompts 03 (authz), 05
(portal), and 07 (ship) are security sensitive. Read the diffs each prompt
produces (`git log`, `git show`, `git diff <tag>..HEAD`) before trusting the
result, and especially before letting an unattended 07 ship. The checkpoint tags
`orchestrate/pre-<name>-<timestamp>` make it easy to review or roll back each
prompt's work.

## Windows note

`run.mjs` is a single cross-platform Node ESM script. It runs identically under
PowerShell and under bash, using Node's shell resolution so `pnpm.cmd` /
`claude.cmd` are found on Windows, and piping each prompt over stdin so long,
multi-line prompts never hit a command-line length or quoting limit. Run it with
`node tools/orchestrate/run.mjs`; there is no `.ps1` or `.sh` variant to keep in
sync.

## Artifacts and secrets

`run/<timestamp>/` holds the per-prompt session logs (stream-json), the gate and
canary logs, and SUMMARY.md. It is gitignored: session logs can contain command
output, so they are kept out of git as a secret-hygiene measure. The runner
itself embeds no secrets and prints none; it reads no credential files.
