'use strict'
// shape-feedback.js — POST /api/ai/shapeFeedback
// Turns raw user feedback (note + optional screenshot + context) into a polished,
// ship-ready user story with a title, type, acceptance criteria, WSJF scores, and
// — for the maintainer persona — a Claude Code implementation brief.
//
// Uses BULK_VERIFY (haiku) for fast, cost-efficient shaping.
// Returns JSON (not SSE) because the client awaits the full shaped story before
// rendering the preview — there is nothing to stream progressively.

const fleet = require('../fleet')
const { _forcedToolCall } = require('./_shared')

const SHAPE_SYSTEM = [
  'You are a senior product manager and UX researcher for an AI-native P&C insurance product-management platform.',
  'Your job is to turn raw, unstructured user feedback into a polished, ship-ready product user story.',
  'Classify the feedback as IDEA, ISSUE, or PRAISE based on its intent.',
  'Write a short punchy title (under 80 chars, plain English — no markdown, no emoji).',
  'Write a "As a [persona] I want [outcome] so that [value]" user story (1 sentence).',
  'Write a 2-3 sentence narrative summary that expands on the feedback.',
  'For IDEA or ISSUE: produce exactly 3 acceptance criteria (short, testable, imperative sentences).',
  'For ISSUE: produce up to 3 reproduction steps and identify up to 3 likely source files.',
  'Score impact (1-3: Low/Med/High) and effort (1-3: Low/Med/High).',
  'affectedSurface must be the exact label provided in routeLabel (do not rephrase it).',
  'Do NOT fabricate technical details not present in the raw feedback.',
].join(' ')

const _SHAPE_TOOL = {
  name: 'emit_story',
  description: 'Emit the shaped user story from raw feedback.',
  input_schema: {
    type: 'object',
    properties: {
      title:               { type: 'string', description: 'Short, punchy title (< 80 chars, no markdown).' },
      type:                { type: 'string', enum: ['IDEA', 'ISSUE', 'PRAISE'] },
      userStory:           { type: 'string', description: '"As a … I want … so that …" — one sentence.' },
      summary:             { type: 'string', description: '2-3 sentence narrative summary.' },
      affectedSurface:     { type: 'string', description: 'The exact routeLabel provided (do not rephrase).' },
      acceptanceCriteria:  { type: 'array',  items: { type: 'string' }, description: 'Exactly 3 testable acceptance criteria (IDEA/ISSUE). Empty for PRAISE.' },
      impact:              { type: 'number', enum: [1, 2, 3], description: '1=Low, 2=Med, 3=High.' },
      effort:              { type: 'number', enum: [1, 2, 3], description: '1=Low, 2=Med, 3=High.' },
      refId:               { type: 'string', description: 'The refId from the entity context, if one was provided.' },
      reproSteps:          { type: 'array',  items: { type: 'string' }, description: 'Up to 3 reproduction steps (ISSUE only).' },
      likelyFiles:         { type: 'array',  items: { type: 'string' }, description: 'Up to 3 likely source files (ISSUE only).' },
      groundingNote:       { type: 'string', description: 'One sentence noting what context was used to shape this story (or empty).' },
    },
    required: ['title', 'type', 'summary', 'affectedSurface', 'impact', 'effort'],
  },
}

// Dedicated engineering system prompt for the maintainer implementation-brief call — the
// story-shaping PM persona (SHAPE_SYSTEM) is the wrong voice for writing a coding-agent brief.
const IMPL_SYSTEM = [
  'You are a senior staff engineer writing a precise, deploy-ready Claude Code implementation brief.',
  'Given a shaped user story, produce ONE copy-paste prompt a coding agent can execute end-to-end.',
  'Structure it: READ FIRST (the likely source files), TASK (what to build), DONE WHEN (acceptance',
  'criteria as [ ] checkboxes), FINISH (run the gate: pnpm typecheck && pnpm lint && pnpm test && pnpm build; commit locally).',
  'Be concrete and file-specific. Do NOT invent files, APIs, or behavior not implied by the story.',
  'Call `emit_implementation_brief` exactly once as your only action.',
].join(' ')

const _IMPL_TOOL = {
  name: 'emit_implementation_brief',
  description: 'Emit a Claude Code implementation brief for the maintainer persona.',
  input_schema: {
    type: 'object',
    properties: {
      implementationPrompt: {
        type: 'string',
        description: 'A deploy-ready, copy-paste Claude Code prompt. Must include: READ FIRST (relevant files), TASK description, DONE WHEN (acceptance criteria as checkboxes), and FINISH (gate + commit).',
      },
    },
    required: ['implementationPrompt'],
  },
}

async function shapeFeedback(req, res) {
  const body = req.body || {}
  const {
    rawTitle, rawDetail, routeLabel, route,
    entityPath, refId, screenshotUrl, attachments, isMaintainer,
  } = body

  if (!rawTitle && !rawDetail && !screenshotUrl) {
    return res.status(400).json({ error: 'At least rawTitle, rawDetail, or screenshotUrl is required.' })
  }

  const g = fleet.guard()
  if (!g.allow) return res.status(429).json({ error: 'AI budget ceiling reached — try again shortly.' })

  const deployment = fleet.resolveModel('BULK_VERIFY', g.degrade)

  // Build the instruction block from available context.
  const lines = ['Shape the following raw feedback into a polished user story.', '']
  if (routeLabel) lines.push(`Surface / route: ${routeLabel}`)
  if (route)      lines.push(`Route path: ${route}`)
  if (refId)      lines.push(`Entity refId: ${refId}`)
  if (entityPath) lines.push(`Entity path: ${entityPath}`)
  lines.push('')
  lines.push(`Raw title: ${rawTitle || '(none)'}`)
  if (rawDetail)  lines.push(`\nRaw detail:\n${rawDetail}`)
  if (attachments && attachments.length) {
    lines.push(`\nAttachments: ${attachments.map((a) => a.name).join(', ')}`)
  }
  // The screenshot is NOT sent to the model on this text-only shaping call, so we must not
  // tell it to "factor in" an image it cannot see — that invites invented visual detail.
  if (screenshotUrl) lines.push('\n(The user attached a screenshot; its contents are NOT included here — do not infer or invent any visual detail from it.)')
  const instruction = lines.join('\n')

  try {
    const raw = await _forcedToolCall(deployment, SHAPE_SYSTEM, [_SHAPE_TOOL], 'emit_story',
      [], instruction, 2048)

    const story = {
      title:              String(raw.title || rawTitle || 'Untitled feedback'),
      type:               ['IDEA', 'ISSUE', 'PRAISE'].includes(raw.type) ? raw.type : 'IDEA',
      userStory:          raw.userStory || undefined,
      summary:            String(raw.summary || rawDetail || ''),
      affectedSurface:    String(raw.affectedSurface || routeLabel || ''),
      acceptanceCriteria: Array.isArray(raw.acceptanceCriteria) ? raw.acceptanceCriteria.slice(0, 3) : [],
      impact:             [1, 2, 3].includes(Number(raw.impact)) ? Number(raw.impact) : 2,
      effort:             [1, 2, 3].includes(Number(raw.effort)) ? Number(raw.effort) : 2,
      refId:              raw.refId || refId || undefined,
      reproSteps:         Array.isArray(raw.reproSteps) ? raw.reproSteps.slice(0, 3) : undefined,
      likelyFiles:        Array.isArray(raw.likelyFiles) ? raw.likelyFiles.slice(0, 3) : undefined,
      groundingNote:      raw.groundingNote || undefined,
    }

    // Maintainer-only implementation brief — a second haiku call kept separate so it
    // never leaks to non-maintainer users (the flag is set by the client, gated by the
    // maintainer email check before the request is issued).
    if (isMaintainer) {
      try {
        const briefInstr = [
          'Write a complete, deploy-ready Claude Code implementation prompt for this user story.',
          'Include: READ FIRST (the likely source files), TASK description, DONE WHEN (the acceptance criteria',
          'as [ ] checkboxes), and FINISH (run the gate: pnpm typecheck && pnpm lint && pnpm test && pnpm build; commit locally).',
          '', `Story: ${story.title}`, `Summary: ${story.summary}`,
          story.acceptanceCriteria.length
            ? `Acceptance criteria:\n${story.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
            : '',
          story.likelyFiles?.length
            ? `Likely files:\n${story.likelyFiles.map((f) => `- ${f}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n')

        const briefRaw = await _forcedToolCall(deployment, IMPL_SYSTEM, [_IMPL_TOOL],
          'emit_implementation_brief', [], briefInstr, 2048)
        story.implementationPrompt = briefRaw.implementationPrompt || undefined
      } catch { /* non-fatal: maintainer prompt is best-effort */ }
    }

    // Near-duplicate detection is best-effort — if we can't reach data, skip it.
    // (Full dedup requires a Cosmos round-trip; keep it simple for now.)
    return res.json({ story, nearMatch: undefined })
  } catch (err) {
    console.error('[shapeFeedback] error:', err)
    return res.status(500).json({ error: String(err.message || err).slice(0, 300) })
  }
}

module.exports = { shapeFeedback }
