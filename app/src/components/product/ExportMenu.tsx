// ExportMenu — the product's export affordances: Excel (exceljs, client-side)
// now, Duck Creek XML wired but disabled ("coming soon"). Integration seams live
// in lib/integrations and lib/export.
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, FileCode2, ChevronDown } from 'lucide-react'
import { Button } from '../ui'
import { exportProductExcel, type ProductExport } from '../../lib/export/excel'
import { DUCK_CREEK_ENABLED } from '../../lib/integrations/duckcreek'

export function ExportMenu({ data }: { data: ProductExport }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
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

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)} disabled={busy}>
        <Download size={14} /> Export <ChevronDown size={12} />
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-surface rounded-[12px] py-1 z-30"
          style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }} role="menu">
          <button onClick={toExcel} disabled={busy} role="menuitem"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised transition-colors text-left">
            <FileSpreadsheet size={15} className="text-good" /> Export to Excel
          </button>
          <button disabled aria-disabled title="Coming soon" role="menuitem"
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm text-faint cursor-not-allowed text-left">
            <span className="flex items-center gap-2.5"><FileCode2 size={15} /> Duck Creek XML</span>
            <span className="text-[10px] uppercase tracking-wide">{DUCK_CREEK_ENABLED ? '' : 'soon'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
