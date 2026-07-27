// ExportMenu — the product's export affordances: Excel (exceljs, client-side)
// and the governed Duck Creek Author XML bundle (server-side, gap-gated — P3).
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { IconDownload, IconFileSpreadsheet, IconFileCode, IconChevronDown } from '../ui/icons'
import { Button } from '../ui'
// exceljs is heavy — the excel module is dynamic-imported at click time so it
// stays a lazy chunk (same pattern as HistoryDrawer/historyExcel); only the
// type rides the static graph.
import type { ProductExport } from '../../lib/export/excel'

const DuckCreekExportPanel = lazy(() => import('./DuckCreekExportPanel'))

export function ExportMenu({ data }: { data: ProductExport }) {
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
    try {
      const { exportProductExcel } = await import('../../lib/export/excel')
      await exportProductExcel(data)
      toast.success('Workbook exported')
    }
    catch { toast.error('Export failed') }
    finally { setBusy(false); setOpen(false) }
  }

  return (
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
          <button onClick={() => { setDcOpen(true); setOpen(false) }} disabled={busy} role="menuitem"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent rounded-[8px]">
            <IconFileCode size={15} className="text-accent" aria-hidden="true" /> Export to Duck Creek&hellip;
          </button>
        </div>
      )}
      {dcOpen && (
        <Suspense fallback={null}>
          <DuckCreekExportPanel open={dcOpen} onClose={() => setDcOpen(false)}
            productId={data.product.id} productName={data.product.name} />
        </Suspense>
      )}
    </div>
  )
}
