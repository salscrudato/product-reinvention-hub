# ADR 0002 — Agent workflow: gate, commit cadence, and session bootstrap

- **Status:** Accepted
- **Date:** 2026-07-07
- **Scope:** All workspaces — applies to every Claude Code session in this repo.

## Context

The repo is an active product under continuous AI-assisted development. Without explicit
process conventions, sessions accumulate untested changes, leave bindings unenforced, and
drift from the invariants in [CLAUDE.md](../../CLAUDE.md). This ADR captures the workflow
decisions that keep the codebase healthy across sessions.

## Decision

### 1. Read CLAUDE.md first

Every session must start with:
1. Root [`CLAUDE.md`](../../CLAUDE.md) — binding invariants, gate command, quick start.
2. The workspace guide for the area being touched (`app/`, `functions/`, or `shared/`).

Code always beats docs. When a discrepancy exists, trust the code and note the divergence.

### 2. Small, verified commits

Each logical unit of work — a feature, a fix, a refactor, a doc — gets its own commit once
the gate is green. Do not batch unrelated changes into a single commit. Prefer forward
commits over amending; amending published commits destroys context.

Commit message style: one concise subject line focused on *why*, not *what*. Body optional.
Attribute AI-assisted commits with the `Co-Authored-By` trailer.

### 3. The gate

The gate must be green before every commit and before declaring any task done:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Use the `/gate` slash command to run it. The headline check inside the gate is the
**$1,528 HO-3 canary** (`shared/src/rating/evaluator.test.ts`). If the canary fails,
that is the leading failure regardless of anything else.

No commit bypasses the gate (`--no-verify` is forbidden unless the user explicitly asks
and understands the risk). No half-green states: all four stages must pass.

### 4. The elevation scoreboard

[`docs/ELEVATION_SCOREBOARD.md`](../ELEVATION_SCOREBOARD.md) tracks UI/UX quality per
surface across ten rubric axes. Use `/score` to view it. When touching a surface, note
whether the work raises or lowers any axis score and record it in the scoreboard.

### 5. Slash commands for repeat flows

The following project-scoped commands are available under `.claude/commands/`:

| Command | What it does |
|---|---|
| `/gate` | Runs `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; reports the canary. |
| `/seed` | Re-seeds the emulator to the known-good HO-3 state (emulators must be running). |
| `/verify-invariant` | Verifies server-side invariant enforcement and role matrix. |
| `/score` | Displays the UI/UX elevation scoreboard. |

### 6. One-command local stack

`pnpm dev:seed` (root) starts the Firebase emulator suite, waits for Firestore, seeds
HO-3 + GL, then starts Vite — full local stack in a single terminal command.

## Consequences

- Sessions that skip the bootstrap reads are more likely to violate invariants or repeat
  past mistakes. The CLAUDE.md read is mandatory, not advisory.
- Small commits create a navigable history; large squashed commits hide the reasoning
  behind each change and make reverts imprecise.
- A red gate is a blocker. Do not push, do not merge, do not declare done while any
  gate stage is failing.
