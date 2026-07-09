// ExportMenu — the product's export affordances: Excel (exceljs, client-side) and
// Duck Creek manuscript XML (PDM→serialize→validate in the browser; audit event
// written server-side via the exportDuckCreek callable).
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { IconDownload, IconFileSpreadsheet, IconFileCode, IconChevronDown } from '../ui/icons'
import { Button } from '../ui'
import { exportProductExcel, type ProductExport } from '../../lib/export/excel'
import { DuckCreekExportModal } from './DuckCreekExportModal'
import type { FormRule } from '@pf/shared'

export interface ExportMenuData extends ProductExport {
  /** FormRule[] from the product sub-collection — required by the PDM builder's
   *  form-attach rules section. Not used by the Excel export. */
  formRules: FormRule[]
}

export function ExportMenu({ data }: { data: ExportMenuData }) {
  const [open,       setOpen]       = useState(false)
  const [busy,       setBusy]       = useState(false)
  const [dcOpen,     setDcOpen]     = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function toExcel() {
    setBusy(true)
    try { await exportProductExcel(data); toast.success('Workbook exported') }
    catch { toast.error('Export failed') }
    finally { setBusy(false); setOpen(false) }
  }

  function openDuckCreek() { setOpen(false); setDcOpen(true) }

  return (
    <>
      <div ref={ref} className="relative">
        <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)} disabled={busy}
          aria-haspopup="menu" aria-expanded={open}>
          <IconDownload size={14} aria-hidden="true" /> Export <IconChevronDown size={12} aria-hidden="true" />
        </Button>
        {open && (
          <div
            className="absolute right-0 mt-1 w-56 bg-surface rounded-[12px] py-1 z-30"
            style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
            role="menu"
          >
            <button onClick={() => void toExcel()} disabled={busy} role="menuitem"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent rounded-[8px]">
              <IconFileSpreadsheet size={15} className="text-good" aria-hidden="true" /> Export to Excel
            </button>
            <button onClick={openDuckCreek} role="menuitem"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent rounded-[8px]">
              <IconFileCode size={15} className="text-accent" aria-hidden="true" /> Duck Creek XML
            </button>
          </div>
        )}
      </div>

      {dcOpen && (
        <DuckCreekExportModal
          data={{
            product:       data.product,
            coverages:     data.coverages,
            rules:         data.rules,
            formRules:     data.formRules,
            forms:         data.forms,
            ldTables:      data.ldTables,
            rtTables:      data.rtTables,
            ratingProgram: data.ratingProgram,
          }}
          onClose={() => setDcOpen(false)}
        />
      )}
    </>
  )
}
