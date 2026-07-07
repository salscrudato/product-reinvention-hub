// BaseFormField — the required base-coverage-form picker shared by the product-create
// modals. Manages only the selected File (the upload happens at create time, so a
// cancelled create leaves no orphan in Storage). Drag-drop or click; shows a clear
// selected-file chip once chosen. PDF or text.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { IconUpload, IconFile, IconTrash } from '../ui/icons'
import { isSupportedBaseForm } from '../../lib/product/baseForm'

const ACCEPT = '.pdf,.txt,.md,text/plain,application/pdf'

export function BaseFormField({ file, onFile, disabled }: {
  file: File | null
  onFile: (f: File | null) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const pick = (f?: File | null) => {
    if (!f) return
    if (!isSupportedBaseForm(f)) { toast.error('Upload a PDF or text form.'); return }
    onFile(f)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text">
        Base coverage form <span className="text-danger">*</span>
      </label>

      {file ? (
        <div className="flex items-center gap-2 h-11 px-3 rounded-[10px] bg-accent-soft" style={{ border: '1px solid var(--color-accent-line)' }}>
          <IconFile size={16} className="text-accent shrink-0" aria-hidden="true" />
          <span className="text-sm text-text truncate flex-1" title={file.name}>{file.name}</span>
          {!disabled && (
            <button type="button" onClick={() => onFile(null)} aria-label="Remove file"
              className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors shrink-0">
              <IconTrash size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button" disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]) }}
          className="flex flex-col items-center justify-center gap-1.5 py-5 px-3 rounded-[10px] text-center transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ border: `1.5px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border-strong)'}`, background: dragOver ? 'var(--color-accent-soft)' : 'transparent' }}
        >
          <span className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: 'var(--color-accent-soft)' }}>
            <IconUpload size={16} className="text-accent" aria-hidden="true" />
          </span>
          <span className="text-[13px] font-medium text-dim">Drop the base form here, or <span className="text-accent">browse</span></span>
          <span className="text-[11px] text-faint">PDF or text — every product starts from its base coverage form.</span>
        </button>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" disabled={disabled}
        onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}
