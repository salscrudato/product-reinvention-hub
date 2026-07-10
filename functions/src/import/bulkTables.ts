// import/bulkTables.ts — deterministic bulk-table parsing with SAMPLED AI verification.
//
// ANTI-FABRICATION GUARANTEE:
//   1. parseFactorTable() is called first — deterministic string parsing, zero model calls.
//   2. verifyBulkTableSample() sends ONLY already-parsed SampledCell[] to the model.
//      The `verify_table_sample` tool schema has EXACTLY TWO fields: { verdict, notes }.
//      There is NO `rows` property — TypeScript enforces this.
//   3. When parsing fails and verification fails → table is UNRESOLVED, never retried
//      with a "please transcribe" prompt.
//   4. Only MODEL_FAST (claude-haiku-4-5) is used here; MODEL (claude-sonnet-5) is
//      never called for table verification.
//
// For XLSX workbooks: parseXlsxBulkTables() uses exceljs — deterministic cell reads,
// no model involvement of any kind.
//
// For PDF / text regions: parseBulkTable() wraps the shared parseFactorTable() from
// shared/src/insurance/filing/tableParser.ts.

import type Anthropic from '@anthropic-ai/sdk'
import type {
  SampledVerification, SampledVerificationResult, SampledCell,
} from '@pf/shared'
import type { ManualTableSchema, ParsedTable } from '@pf/shared'
import { parseFactorTable, sampleCells } from '@pf/shared'
import { MODEL_FAST } from '../runtime'

// ─── Verification tool definition ────────────────────────────────────────────
// CRITICAL: this tool has NO `rows` property. The model cannot emit table rows.
// TypeScript prevents adding `rows` here; the Anthropic API strips unknown fields.

const VERIFY_TOOL: Anthropic.Tool = {
  name: 'verify_table_sample',
  description:
    'Verify a SAMPLE of deterministically-parsed table cells against the verbatim source text. ' +
    'Check whether each sampled cell value appears in the source region. ' +
    'Return PASS if every sampled cell value appears, FAIL if any are absent or wrong, ' +
    'PARTIAL if some but not all match. ' +
    'DO NOT transcribe the table. DO NOT emit rows. Return only verdict and notes.',
  input_schema: {
    type: 'object',
    // Exactly two fields — no `rows` property is possible here.
    properties: {
      verdict: {
        type: 'string',
        enum: ['PASS', 'FAIL', 'PARTIAL'],
        description: 'PASS: all sampled cells found. FAIL: cells missing. PARTIAL: some missing.',
      },
      notes: {
        type: 'string',
        description: 'Brief note on any mismatches, or "all cells verified" for PASS.',
      },
    },
    required: ['verdict', 'notes'],
  },
}

const VERIFY_SYSTEM =
  'You are a data-quality auditor. Given a sample of parsed cell values and the verbatim ' +
  'source text, check ONLY whether each sampled value appears in the text. ' +
  'Do not transcribe rows. Call verify_table_sample exactly once.'

// ─── Public types ─────────────────────────────────────────────────────────────

export type ParsedBulkTable = ParsedTable & { tableRefId: string; rowRegion: string }

// ─── PDF/text region: deterministic parse + sampled AI verification ───────────

/** Parse a factor table from a verbatim text region deterministically.
 *  Never calls a model to produce rows. The AI step only verifies a sample.
 *  When verification fails and rows were skipped → unresolvable = true; caller
 *  must mark the table UNRESOLVED rather than retrying with a transcription prompt. */
export async function parseBulkTable(
  client: Anthropic,
  tableRefId: string,
  schema: ManualTableSchema,
  sampleN: number,
  verifications: SampledVerification[],
): Promise<{ parsed: ParsedBulkTable; unresolvable: boolean }> {
  // ① Deterministic parse — zero model calls (string splitting + parseNumericToken)
  const parsed = parseFactorTable(schema)
  const result: ParsedBulkTable = { ...parsed, tableRefId, rowRegion: schema.rowRegion }

  // ② Sample N cells from the already-parsed rows (deterministic spread)
  const samples = sampleCells(parsed, schema.valueColumn, sampleN)

  // ③ Verify samples against the verbatim region (MODEL_FAST only)
  //    The verification tool CANNOT produce new rows — see ANTI-FABRICATION GUARANTEE above.
  const verification = await verifyBulkTableSample(client, tableRefId, samples, schema.rowRegion)
  verifications.push(verification)

  // ④ Unresolvable when verification fails AND rows were skipped (parse was incomplete)
  const unresolvable = verification.verificationResult === 'FAIL' && parsed.skipped > 0

  return { parsed: result, unresolvable }
}

/** Verify a sample of already-parsed cells against the source region.
 *  Returns a SampledVerification with { verdict, notes } — never with rows. */
async function verifyBulkTableSample(
  client: Anthropic,
  tableRefId: string,
  sampledCells: SampledCell[],
  region: string,
): Promise<SampledVerification> {
  if (sampledCells.length === 0) {
    return {
      tableRefId, sampledCells: [],
      verificationResult: 'PASS',
      notes: 'Empty table — no cells to verify.',
      model: MODEL_FAST,
    }
  }

  const cellList = sampledCells.map(c => `  ${c.coords}: ${c.value}`).join('\n')
  // Truncate huge regions — the model only needs to find the sampled values, not the whole table.
  const regionSnippet = region.length > 4000 ? region.slice(0, 4000) + '\n[…truncated]' : region

  const msg = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: 200,
    system: VERIFY_SYSTEM,
    tools: [VERIFY_TOOL],
    tool_choice: { type: 'tool', name: VERIFY_TOOL.name },
    messages: [{
      role: 'user',
      content: `Sampled cells from table ${tableRefId}:\n${cellList}\n\nSource region:\n${regionSnippet}`,
    }],
  }, { timeout: 60_000 })

  const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const input = (tu?.input ?? {}) as Record<string, unknown>

  const validVerdicts: SampledVerificationResult[] = ['PASS', 'FAIL', 'PARTIAL']
  const verdict: SampledVerificationResult = validVerdicts.includes(input['verdict'] as SampledVerificationResult)
    ? (input['verdict'] as SampledVerificationResult)
    : 'PARTIAL'

  return {
    tableRefId,
    sampledCells,
    verificationResult: verdict,
    notes:              (input['notes'] as string | undefined) ?? '',
    model:              MODEL_FAST,
  }
}

// ─── XLSX bulk table parsing (for ISO_WORKBOOK format) ────────────────────────
// Uses exceljs to read raw cell values deterministically. No AI calls of any kind.
// Returns IsoGrid[] that mapIsoWorkbook() can consume directly.

export async function parseXlsxBulkTables(base64: string): Promise<IsoGrid[]> {
  // Dynamic import so the module is only loaded when needed (avoids cold-start cost
  // when all uploads are PDFs). exceljs is declared in functions/package.json.
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buf: any = Buffer.from(base64, 'base64')
  await wb.xlsx.load(buf)

  const grids: IsoGrid[] = []
  for (const ws of wb.worksheets) {
    const cells: IsoCell[][] = []
    ws.eachRow({ includeEmpty: true }, row => {
      const rowArr: IsoCell[] = []
      row.eachCell({ includeEmpty: true }, cell => {
        const v = cell.value
        if (v === null || v === undefined) {
          rowArr.push(null)
        } else if (typeof v === 'object' && v !== null && 'richText' in v) {
          // RichTextValue: concatenate text runs
          const rtv = v as { richText: Array<{ text: string }> }
          rowArr.push(rtv.richText.map(r => r.text).join(''))
        } else if (v instanceof Date) {
          rowArr.push(v.toISOString().slice(0, 10))
        } else if (typeof v === 'object' && v !== null && 'formula' in v) {
          // CellFormulaValue: use cached result if available
          const fv = v as { result?: unknown }
          const result = fv.result
          if (result === null || result === undefined) {
            rowArr.push(null)
          } else if (typeof result === 'object' && result instanceof Date) {
            rowArr.push(result.toISOString().slice(0, 10))
          } else {
            rowArr.push(result as IsoCell)
          }
        } else {
          rowArr.push(v as IsoCell)
        }
      })
      cells.push(rowArr)
    })
    grids.push({ sheet: ws.name, cells })
  }
  return grids
}

// ─── Local type aliases (match @pf/shared's IsoGrid / IsoCell) ────────────────
// These are duplicated locally to avoid a circular import from functions/ into
// the shared package at the type level; the actual runtime types are identical.

type IsoCell = string | number | boolean | null
interface IsoGrid { sheet: string; file?: string; cells: IsoCell[][] }
