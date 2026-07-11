import type { FieldDisagreement } from '@pf/shared'
import { IconWarning } from '../components/ui/icons'

// DisagreementHeatmap — renders per-field inter-model divergence.
//
// Shows a table: Field | Opus 4.8 | GPT-5.1 | Adjudicated | Confidence
// Cells are colour-coded by calibratedConfidence (1.0 = green, 0 = red).
// Only rendered when ensembleDisagreements is present and non-empty.
// Design tokens only — no raw hex.

interface Props {
  disagreements: FieldDisagreement[]
}

function confidenceColor(conf: number): string {
  if (conf >= 0.85) return 'var(--color-good)'
  if (conf >= 0.5)  return 'var(--color-warn)'
  return 'var(--color-error, var(--color-warn))'
}

function ConfidencePip({ value }: { value: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width:      '8px',
        height:     '8px',
        background: confidenceColor(value),
        opacity:    0.85,
      }}
      aria-hidden="true"
    />
  )
}

export function DisagreementHeatmap({ disagreements }: Props) {
  if (disagreements.length === 0) return null

  return (
    <section
      className="rounded-[12px] overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}
      aria-label="Inter-model disagreement heatmap"
    >
      {/* Header bar */}
      <div
        className="flex items-center gap-2 px-3.5 py-2.5"
        style={{ background: 'var(--color-raised)', borderBottom: '1px solid var(--color-border)' }}
      >
        <IconWarning size={15} className="text-warn shrink-0" aria-hidden="true" />
        <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-text">
          Ensemble disagreements
        </h4>
        <span className="text-[11px] text-faint tnum">{disagreements.length} field{disagreements.length !== 1 ? 's' : ''}</span>
        <span className="text-[11px] text-faint ml-auto">
          Opus&thinsp;4.8 vs GPT&thinsp;5.1 — adjudicated by Haiku&thinsp;4.5
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-faint, var(--color-raised))' }}>
              {(['Field', 'Opus 4.8', 'GPT 5.1', 'Adjudicated', 'Conf'] as const).map(col => (
                <th
                  key={col}
                  className="px-3 py-2 text-left font-semibold text-dim"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {disagreements.map((d, i) => (
              <tr
                key={d.fieldPath}
                style={{
                  borderBottom: i < disagreements.length - 1
                    ? '1px solid var(--color-border)'
                    : 'none',
                  background: i % 2 === 0 ? 'transparent' : 'var(--color-faint, transparent)',
                }}
              >
                {/* Field label */}
                <td className="px-3 py-2 text-text font-medium" style={{ whiteSpace: 'nowrap' }}>
                  {d.fieldLabel}
                </td>

                {/* Opus value */}
                <td
                  className="px-3 py-2 font-mono text-dim max-w-[180px]"
                  style={{ wordBreak: 'break-word' }}
                  title={d.opusValue}
                >
                  {d.opusValue || <span className="text-faint italic">—</span>}
                </td>

                {/* GPT value */}
                <td
                  className="px-3 py-2 font-mono text-dim max-w-[180px]"
                  style={{ wordBreak: 'break-word' }}
                  title={d.gptValue}
                >
                  {d.gptValue || <span className="text-faint italic">—</span>}
                </td>

                {/* Adjudicated value */}
                <td
                  className="px-3 py-2 font-mono text-text max-w-[180px]"
                  style={{
                    wordBreak:  'break-word',
                    fontWeight: 600,
                    color:      'var(--color-accent)',
                  }}
                  title={d.adjudicatedValue}
                >
                  {d.adjudicatedValue || <span className="text-faint italic">—</span>}
                </td>

                {/* Calibrated confidence pip + percentage */}
                <td className="px-3 py-2" style={{ whiteSpace: 'nowrap' }}>
                  <span className="flex items-center gap-1.5">
                    <ConfidencePip value={d.calibratedConfidence} />
                    <span
                      className="tnum"
                      style={{ color: confidenceColor(d.calibratedConfidence) }}
                    >
                      {Math.round(d.calibratedConfidence * 100)}%
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer explanation */}
      <div
        className="px-3.5 py-2 text-[10px] text-faint"
        style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-raised)' }}
      >
        Confidence calibrated from inter-model agreement (Jaccard). 100% = both models agreed
        exactly; lower values mean the adjudicator was needed.
      </div>
    </section>
  )
}
