// import/formatCards.ts — self-extension loop for unknown formats.
// When fingerprint returns UNKNOWN, this module proposes a FormatCard that a human can
// approve in the review UI. On approval the app writes it as a new registry proposal
// (data, not code). Nothing auto-persists: the card's status starts as PROPOSED and is
// never elevated here.
//
// Uses MODEL (claude-sonnet-5) for the one-shot structured analysis — the format of an
// unknown document is a reasoning task, not a bulk/simple generation.

import type Anthropic from '@anthropic-ai/sdk'
import type { FormatCard, FormatFingerprint, UploadDoc } from '@pf/shared'
import { MODEL } from '../runtime'
import type { StreamEvent } from '../runtime'
import type { UsageAccum } from '../telemetry'
import { addUsage } from '../telemetry'

// ─── Format-card proposal tool ─────────────────────────────────────────────────
// The tool proposes candidate signals and a recipe fragment from the document's text.
// It cannot write to any registry — proposal only. A reviewer approves or rejects it.

const FORMAT_CARD_TOOL: Anthropic.Tool = {
  name: 'propose_format_card',
  description:
    'Examine an unrecognized document upload and propose a FormatCard: candidate ' +
    'document-role fingerprint signals and a translation recipe fragment that could ' +
    'identify this format in future uploads. This is a PROPOSAL ONLY — a human reviewer ' +
    'must approve it before it influences any pipeline run. Ground every proposed signal ' +
    'in the actual document text. If you cannot identify signals with confidence, return ' +
    'empty arrays rather than guessing.',
  input_schema: {
    type: 'object',
    properties: {
      documentRoleFingerprints: {
        type: 'array',
        description: 'Candidate document-role signals for this format.',
        items: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              enum: ['RATE_ORDER', 'MANUAL', 'POLICY_FORM', 'RULES', 'CLASS_TABLE',
                     'TERRITORY_TABLE', 'DECLARATIONS', 'ERC_PACKAGE', 'SERFF_SCHEDULE'],
            },
            signals:         { type: 'array', items: { type: 'string' } },
            confidenceWeight: { type: 'number', description: '0–1 weight for this role.' },
          },
          required: ['role', 'signals', 'confidenceWeight'],
        },
      },
      translationRecipeFragment: {
        type: 'object',
        description: 'Partial recipe fragment — only fields you can determine from the upload.',
        properties: {
          primaryFormPattern:   { type: 'string', description: 'Regex for the base form number.' },
          productSplitStrategy: { type: 'string', enum: ['SINGLE_PRODUCT', 'SINGLE_PRODUCT_MULTI_FORM', 'SIBLING_PRODUCTS_PER_FORM'] },
          defaultVariableOp:    { type: 'string', enum: ['MUL', 'ADD', 'SET'] },
          hasLcmStep:           { type: 'boolean' },
          hasExpMod:            { type: 'boolean' },
          hasClaimsMadeStepFactors: { type: 'boolean' },
        },
      },
    },
    required: ['documentRoleFingerprints'],
  },
}

const FORMAT_CARD_SYSTEM =
  'You are a P&C filing analyst examining an unrecognized document format. ' +
  'Propose candidate document-role signals and a translation recipe fragment that could ' +
  'identify this format in future pipeline runs. Ground every proposed signal in the ' +
  'actual document text shown to you. This is a PROPOSAL that a human will review and ' +
  'either approve or reject — be conservative. Do not invent signals not present in the text. ' +
  'Call propose_format_card exactly once.'

/** Generate a proposed FormatCard for an UNKNOWN-format upload.
 *  The card is returned as a PROPOSED artifact; the caller includes it in the review bundle.
 *  Nothing is written to Firestore here. */
export async function proposeFormatCard(
  client: Anthropic,
  fingerprint: FormatFingerprint,
  docs: UploadDoc[],
  strongUsage: UsageAccum,
  emit?: (ev: StreamEvent) => void,
): Promise<FormatCard> {
  const emitFn = emit ?? (() => {})
  emitFn({ t: 'tool', name: 'format_card', phase: 'start' })

  // First 2 000 chars of each document's text — enough for signal extraction without
  // blowing the token budget for a single-shot reasoning call.
  const docSnippets = docs.map(d => {
    const snippet = (d.text ?? '').slice(0, 2000)
    return `DOCUMENT "${d.name}":\n${snippet}`
  }).join('\n\n---\n\n')

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: FORMAT_CARD_SYSTEM,
    tools: [FORMAT_CARD_TOOL],
    tool_choice: { type: 'tool', name: FORMAT_CARD_TOOL.name },
    messages: [{
      role: 'user',
      content: `Unknown format. Detected container: ${fingerprint.container}.\n\n${docSnippets}`,
    }],
  }, { timeout: 90_000 })

  addUsage(strongUsage, msg.usage)

  const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const input = (tu?.input ?? {}) as Record<string, unknown>

  const card: FormatCard = {
    id:                        `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status:                    'PROPOSED',
    proposedAt:                new Date().toISOString(),
    detectedContainer:         fingerprint.container,
    documentRoleFingerprints:  (input['documentRoleFingerprints'] as FormatCard['documentRoleFingerprints'] | undefined) ?? [],
    translationRecipeFragment: (input['translationRecipeFragment'] as FormatCard['translationRecipeFragment'] | undefined) ?? {},
  }

  emitFn({
    t: 'tool', name: 'format_card', phase: 'end',
    summary: `Proposed ${card.documentRoleFingerprints.length} fingerprint(s)`,
  })
  emitFn({ t: 'json', key: 'formatCard', value: card })

  return card
}
