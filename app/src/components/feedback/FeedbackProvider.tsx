// FeedbackProvider — global quick-capture turned into a "Refine with AI" story flow.
// A ⌘. shortcut / floating button opens ONE drawer. The user jots a rough note (and/or a
// screenshot); "Refine with AI" sends it to the server-side `shapeFeedback` callable, which
// returns a structured user story (canonical title, type, summary, 2–4 acceptance criteria,
// impact/effort, and — for issues — repro steps + likely files). The user reviews/edits that
// preview, then Accepts, and only then does it land via adapter.db.mutate() with REAL fields.
//
// Entity context is automatic: the drawer reads what the user is viewing from CaptureContext
// (the exact coverage/form/rule + its refId, or the product+tab, else the route label) and
// attaches it — persisted on the record and rendered as a monospace chip.
//
// Dedup: if shaping finds a near-duplicate, the preview offers a one-tap "add your vote
// instead" (VIEWER-legal narrow vote; editors also append the note through mutate()).
//
// Screenshot flow (unchanged, fully intact):
//   1. "Capture screen" hides the dialog, calls getDisplayMedia (user picks "This Tab"),
//      grabs one video frame as PNG, then the dialog reappears with the image on a canvas.
//   2. Alternatively: paste any image (⌘V) while the dialog is open.
//   Annotation tools: Pen (red), Highlight (yellow), Snip (crop), Undo, Clear. On Refine the
//   annotated canvas is uploaded to Storage; that URL is read by the vision pass AND persisted.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { useCapture } from '../../context/useCapture'
import { Button, Input } from '../ui'
import { IconChat, IconIdea, IconBug, IconHeart, IconLink, IconCamera, IconClose, IconSparkle, IconSpinner, IconArrowUp, IconPlus, IconInfo, type IconType } from '../ui/icons'
import { priorityScore, type FeedbackType, type Feedback } from '@pf/shared'

const TYPES: { id: FeedbackType; label: string; icon: IconType }[] = [
  { id: 'IDEA',   label: 'Idea',   icon: IconIdea },
  { id: 'ISSUE',  label: 'Issue',  icon: IconBug },
  { id: 'PRAISE', label: 'Praise', icon: IconHeart },
]

type Tool   = 'pen' | 'highlight' | 'crop'
type Stroke = { color: string; alpha: number; width: number; points: { x: number; y: number }[] }

const DRAW_TOOLS: Record<Exclude<Tool, 'crop'>, { color: string; alpha: number; width: number; label: string }> = {
  pen:       { color: '#ef4444', alpha: 1,   width: 3,  label: 'Pen'       },
  highlight: { color: '#fbbf24', alpha: 0.4, width: 12, label: 'Highlight' },
}

// ─── shapeFeedback wire contract (mirrors functions/src/shapeFeedback.ts) ─────────
type ShapedType = FeedbackType
interface ShapedStory {
  title:              string
  type:               ShapedType
  summary:            string          // one-line narrative → persisted as `detail`
  affectedSurface:    string
  acceptanceCriteria: string[]
  impact:             1 | 2 | 3
  effort:             1 | 2 | 3
  refId?:             string
  reproSteps?:        string[]        // ISSUE only
  likelyFiles?:       string[]        // ISSUE only
  groundingNote?:     string
}
interface ShapeFeedbackInput {
  rawTitle:       string
  rawDetail?:     string
  routeLabel?:    string
  route?:         string
  entityPath?:    string
  refId?:         string
  screenshotUrl?: string
}
interface ShapeFeedbackOutput {
  story:      ShapedStory
  nearMatch?: { id: string; title: string; score: number }
}

type FeedbackDoc = Feedback & { id: string; rev?: number }
type ListKey = 'acceptanceCriteria' | 'reproSteps' | 'likelyFiles'
type Phase = 'capture' | 'shaping' | 'preview' | 'error'

// Derive a human-readable label from the current pathname so feedback is pre-linked
// to the exact surface the user was on when no entity context is published.
function describeRoute(pathname: string): string {
  const m = (re: RegExp) => re.test(pathname)
  if (m(/\/products\/[^/]+\/coverages/)) return 'Coverages'
  if (m(/\/products\/[^/]+\/forms/))     return 'Forms'
  if (m(/\/products\/[^/]+\/pricing/))   return 'Pricing'
  if (m(/\/products\/[^/]+\/states/))    return 'States'
  if (m(/\/products\/[^/]+\/rules/))     return 'Rules'
  if (m(/\/products\/[^/]+\/overview/))  return 'Product overview'
  if (m(/\/products\/[^/]+/))            return 'Product workspace'
  if (m(/\/products/))                   return 'Products'
  if (m(/\/tasks/))                      return 'Task board'
  if (m(/\/feedback/))                   return 'Feedback'
  if (m(/\/home/))                       return 'Home'
  if (m(/\/search/))                     return 'Search'
  if (m(/\/settings/))                   return 'Settings'
  return pathname
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { user } = useUser()
  const { viewed } = useCapture()
  const location = useLocation()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  // What the user is viewing — the exact entity (from CaptureContext) or the route label.
  const capLabel      = viewed?.label ?? describeRoute(location.pathname)
  const capEntityPath = viewed?.entityPath
  const capRefId      = viewed?.refId

  const [open, setOpen]   = useState(false)
  const [phase, setPhase] = useState<Phase>('capture')
  const [title, setTitle]   = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy]     = useState(false)

  // Shaped story + dedup + the in-flight draft id / uploaded screenshot URL.
  const [draft, setDraft]           = useState<ShapedStory | null>(null)
  const [nearMatch, setNearMatch]   = useState<ShapeFeedbackOutput['nearMatch'] | null>(null)
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
  const [draftId, setDraftId]       = useState<string | null>(null)
  const [shotUrl, setShotUrl]       = useState<string | null>(null)

  // Screenshot + annotation
  const [screenshot, setScreenshot] = useState<Blob | null>(null)
  const [strokes, setStrokes]       = useState<Stroke[]>([])
  const [activeTool, setActiveTool] = useState<Tool>('pen')
  const [capturing, setCapturing]   = useState(false)

  // Crop tool — tracks selection in CSS pixels relative to the canvas element
  const [cropSel, setCropSel] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  const annotationCanvasRef = useRef<HTMLCanvasElement>(null)
  const baseImageRef        = useRef<HTMLImageElement | null>(null)
  const currentStrokeRef    = useRef<{ x: number; y: number }[]>([])
  const isDrawingRef        = useRef(false)
  const lastPointRef        = useRef<{ x: number; y: number } | null>(null)
  const isCroppingRef       = useRef(false)

  // Load screenshot blob onto the annotation canvas; reset strokes for each new capture.
  useEffect(() => {
    if (!screenshot) { baseImageRef.current = null; setStrokes([]); setCropSel(null); return }
    const url = URL.createObjectURL(screenshot)
    const img = new Image()
    img.onload = () => {
      baseImageRef.current = img
      setStrokes([])
      setCropSel(null)
      const canvas = annotationCanvasRef.current
      if (!canvas) return
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [screenshot])

  // Full canvas re-render from committed strokes — called after undo / clear.
  function renderCanvas(current: Stroke[]) {
    const canvas = annotationCanvasRef.current
    const img    = baseImageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    for (const stroke of current) {
      if (stroke.points.length < 2) continue
      ctx.save()
      ctx.beginPath()
      ctx.strokeStyle = stroke.color
      ctx.lineWidth   = stroke.width
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.globalAlpha = stroke.alpha
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (const pt of stroke.points.slice(1)) ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
      ctx.restore()
    }
  }

  // ⌘. / Ctrl+. global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); setOpen(o => !o) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Paste-from-clipboard: accepts any image/* while the dialog is open, on the capture step.
  useEffect(() => {
    if (!open || phase !== 'capture') return
    const handler = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const img   = items.find(it => it.type.startsWith('image/'))
      if (!img) return
      const blob = img.getAsFile()
      if (!blob) return
      e.preventDefault()
      setScreenshot(blob)
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [open, phase])

  // Capture one frame of the current tab via getDisplayMedia.
  async function captureScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error('Screen capture not supported in this browser')
      return
    }
    setCapturing(true)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true, // Chrome 107+ hint: pre-selects current tab
      } as unknown as Parameters<typeof navigator.mediaDevices.getDisplayMedia>[0])

      const video = document.createElement('video')
      video.srcObject = stream
      await new Promise<void>(resolve => { video.onloadedmetadata = () => resolve() })
      await video.play()
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

      const canvas = document.createElement('canvas')
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')!.drawImage(video, 0, 0)
      video.pause()
      stream.getTracks().forEach(t => t.stop())

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (blob) setScreenshot(blob)
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
        toast.error('Screenshot failed — paste an image instead (⌘V)')
      }
    } finally {
      setCapturing(false)
    }
  }

  // ─── Canvas coordinate helpers ───────────────────────────────────────────────

  function getCssPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect   = e.currentTarget.getBoundingClientRect()
    const canvas = e.currentTarget
    return {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    }
  }

  // ─── Pointer events (drawing + crop share the same canvas) ──────────────────

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    if (activeTool === 'crop') {
      isCroppingRef.current = true
      const { x, y } = getCssPoint(e)
      setCropSel({ x1: x, y1: y, x2: x, y2: y })
      return
    }
    isDrawingRef.current = true
    const pt = getCanvasPoint(e)
    currentStrokeRef.current = [pt]
    lastPointRef.current = pt
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activeTool === 'crop') {
      if (!isCroppingRef.current) return
      const { x, y } = getCssPoint(e)
      setCropSel(prev => prev ? { ...prev, x2: x, y2: y } : null)
      return
    }
    if (!isDrawingRef.current || !lastPointRef.current) return
    const pt     = getCanvasPoint(e)
    const canvas = annotationCanvasRef.current
    if (!canvas) return
    const tool = DRAW_TOOLS[activeTool as Exclude<Tool, 'crop'>]
    const ctx  = canvas.getContext('2d')!
    ctx.save()
    ctx.beginPath()
    ctx.strokeStyle = tool.color
    ctx.lineWidth   = tool.width
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.globalAlpha = tool.alpha
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    ctx.restore()
    currentStrokeRef.current.push(pt)
    lastPointRef.current = pt
  }

  function onPointerUp() {
    if (activeTool === 'crop') {
      isCroppingRef.current = false
      return
    }
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    const points = currentStrokeRef.current
    if (points.length > 1) {
      const tool = DRAW_TOOLS[activeTool as Exclude<Tool, 'crop'>]
      setStrokes(prev => [...prev, { color: tool.color, alpha: tool.alpha, width: tool.width, points }])
    }
    currentStrokeRef.current = []
    lastPointRef.current = null
  }

  // Crop: extract the selected region from the annotation canvas into a new screenshot
  async function commitCrop() {
    if (!cropSel || !annotationCanvasRef.current) return
    const canvas = annotationCanvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const x = Math.round(Math.min(cropSel.x1, cropSel.x2) * scaleX)
    const y = Math.round(Math.min(cropSel.y1, cropSel.y2) * scaleY)
    const w = Math.round(Math.abs(cropSel.x2 - cropSel.x1) * scaleX)
    const h = Math.round(Math.abs(cropSel.y2 - cropSel.y1) * scaleY)
    if (w < 10 || h < 10) { setCropSel(null); return }

    const cropped = document.createElement('canvas')
    cropped.width  = w
    cropped.height = h
    cropped.getContext('2d')!.drawImage(canvas, -x, -y)

    const blob = await new Promise<Blob | null>(resolve => cropped.toBlob(resolve, 'image/png'))
    if (blob) {
      setActiveTool('pen')
      setScreenshot(blob) // triggers useEffect that reloads the canvas + resets strokes
    }
  }

  function undoStroke() {
    const next = strokes.slice(0, -1)
    setStrokes(next)
    renderCanvas(next)
  }

  function clearAnnotations() {
    setStrokes([])
    renderCanvas([])
  }

  /** Export the annotated canvas as a PNG blob (or null if there's no image). */
  function exportCanvasBlob(): Promise<Blob | null> {
    const canvas = annotationCanvasRef.current
    if (!canvas || !screenshot) return Promise.resolve(null)
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  }

  // ─── Draft editing helpers (preview step) ─────────────────────────────────────

  function patchDraft(patch: Partial<ShapedStory>) {
    setDraft(d => (d ? { ...d, ...patch } : d))
  }
  function setListItem(key: ListKey, i: number, val: string) {
    setDraft(d => {
      if (!d) return d
      const arr = [...(d[key] ?? [])]; arr[i] = val
      return { ...d, [key]: arr } as ShapedStory
    })
  }
  function addListItem(key: ListKey) {
    setDraft(d => (d ? { ...d, [key]: [...(d[key] ?? []), ''] } as ShapedStory : d))
  }
  function removeListItem(key: ListKey, i: number) {
    setDraft(d => {
      if (!d) return d
      const arr = [...(d[key] ?? [])]; arr.splice(i, 1)
      return { ...d, [key]: arr } as ShapedStory
    })
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  function reset() {
    setPhase('capture')
    setTitle(''); setDetail('')
    setScreenshot(null); setStrokes([]); setActiveTool('pen'); setCropSel(null)
    setDraft(null); setNearMatch(null); setErrorMsg(null)
    setDraftId(null); setShotUrl(null)
  }
  function close() { setOpen(false); reset() }

  const canRefine = (!!title.trim() || !!screenshot) && !busy

  // Refine with AI: upload the screenshot (so the vision pass can read it and we persist the
  // same URL), then call shapeFeedback and move to the editable preview.
  async function refineWithAI() {
    if (!user || !canRefine) return
    setBusy(true); setErrorMsg(null); setPhase('shaping')
    try {
      const id = draftId ?? crypto.randomUUID()
      setDraftId(id)

      let uploadedUrl: string | undefined = shotUrl ?? undefined
      if (screenshot) {
        const blob = await exportCanvasBlob()
        if (blob) {
          const file = new File([blob], `${id}.png`, { type: 'image/png' })
          uploadedUrl = await adapter.storage.upload(`uploads/${user.uid}/feedback/${id}.png`, file)
          setShotUrl(uploadedUrl)
        }
      } else {
        uploadedUrl = undefined
        setShotUrl(null)
      }

      const out = await adapter.fns.call<ShapeFeedbackInput, ShapeFeedbackOutput>('shapeFeedback', {
        rawTitle:      title.trim() || 'Feedback from screenshot',
        rawDetail:     detail.trim() || undefined,
        routeLabel:    capLabel,
        route:         location.pathname,
        entityPath:    capEntityPath,
        refId:         capRefId,
        screenshotUrl: uploadedUrl,
      })
      setDraft(out.story)
      setNearMatch(out.nearMatch ?? null)
      setPhase('preview')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not reach the AI.')
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  // Error fallback: skip the AI and edit a manual draft in the SAME preview (so impact/effort
  // are user-chosen and priorityScore is still computed — never blindly-persisted constants).
  function enterManually() {
    setDraft({
      title:              title.trim() || 'Feedback from screenshot',
      type:               'IDEA',
      summary:            detail.trim() || title.trim() || '',
      affectedSurface:    capLabel,
      acceptanceCriteria: [],
      impact:             2,
      effort:             2,
      ...(capRefId ? { refId: capRefId } : {}),
    })
    setNearMatch(null)
    setErrorMsg(null)
    setPhase('preview')
  }

  // Accept: write the shaped story through adapter.db.mutate() with REAL fields.
  async function accept() {
    if (!user || !draft || busy) return
    const finalTitle = draft.title.trim()
    if (!finalTitle) { toast.error('A title is required'); return }
    setBusy(true)
    try {
      const id = draftId ?? crypto.randomUUID()
      const actor = { uid: user.uid, name: user.name ?? user.email ?? 'User' }
      const isIssue = draft.type === 'ISSUE'
      const ac    = (draft.acceptanceCriteria ?? []).map(s => s.trim()).filter(Boolean)
      const repro = isIssue ? (draft.reproSteps  ?? []).map(s => s.trim()).filter(Boolean) : []
      const files = isIssue ? (draft.likelyFiles ?? []).map(s => s.trim()).filter(Boolean) : []

      await adapter.db.mutate({
        op: 'create', path: `feedback/${id}`,
        data: {
          type:   draft.type,
          title:  finalTitle,
          detail: draft.summary.trim(),
          context: {
            route: location.pathname,
            label: capLabel,
            ...(capEntityPath ? { entityPath: capEntityPath } : {}),
            ...(capRefId ? { refId: capRefId } : {}),
          },
          votes: { count: 0, voters: [] },
          status: 'NEW',
          impact: draft.impact,
          effort: draft.effort,
          // priorityScore comes from the shared WSJF helper — never a hardcoded constant.
          priorityScore: priorityScore(draft.impact, draft.effort, 0, 0),
          ...(ac.length ? { acceptanceCriteria: ac } : {}),
          ...(repro.length ? { reproSteps: repro } : {}),
          ...(files.length ? { likelyFiles: files } : {}),
          author: actor,
          ...(shotUrl ? { screenshotUrl: shotUrl } : {}),
        },
        entityType: 'feedback',
        actor,
      })
      toast.success('Feedback captured')
      close()
    } catch {
      toast.error('Could not submit feedback')
    } finally {
      setBusy(false)
    }
  }

  // Near-duplicate: add the user's vote to the existing item instead of creating a dupe.
  // VIEWER uses the narrow, rules-legal vote path; EDITOR/ADMIN also append the note through
  // mutate() (the feedback rule only lets canEdit() change fields other than `votes`).
  async function voteInstead() {
    if (!user || !nearMatch || busy) return
    setBusy(true)
    const path  = `feedback/${nearMatch.id}`
    const actor = { uid: user.uid, name: user.name ?? user.email ?? 'User' }
    try {
      const cur = await adapter.db.get<FeedbackDoc>(path)
      if (!cur) { toast.error('That item no longer exists'); setBusy(false); return }
      const already = (cur.votes?.voters ?? []).includes(user.uid)
      const note = detail.trim() || (draft?.summary?.trim() ?? '') || title.trim()

      if (canEdit) {
        const { id: _id, rev: _rev, ...rest } = cur
        void _id; void _rev
        const appendedDetail = note ? `${cur.detail}\n\n— ${actor.name}: ${note}` : cur.detail
        await adapter.db.mutate({
          op: 'update', path, entityType: 'feedback', actor, expectedRev: cur.rev,
          data: {
            ...rest,
            detail: appendedDetail,
            votes: already ? cur.votes : { count: (cur.votes?.count ?? 0) + 1, voters: [...(cur.votes?.voters ?? []), user.uid] },
          },
        })
      } else if (already) {
        toast.info('You already voted on that one'); close(); return
      } else {
        await adapter.db.vote(path, user.uid)
      }
      toast.success(`Added to "${nearMatch.title}"`)
      close()
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Could not add your vote')
    } finally {
      setBusy(false)
    }
  }

  // ─── Crop selection overlay: CSS-space rect, box-shadow creates the dim mask ─

  const cropOverlay = cropSel && activeTool === 'crop' && (() => {
    const minX = Math.min(cropSel.x1, cropSel.x2)
    const minY = Math.min(cropSel.y1, cropSel.y2)
    const w    = Math.abs(cropSel.x2 - cropSel.x1)
    const h    = Math.abs(cropSel.y2 - cropSel.y1)
    if (w < 2 || h < 2) return null
    return (
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute" style={{
          left: minX, top: minY, width: w, height: h,
          outline: '2px solid white',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
        }} />
      </div>
    )
  })()

  const hasCropArea = cropSel && Math.abs(cropSel.x2 - cropSel.x1) > 10 && Math.abs(cropSel.y2 - cropSel.y1) > 10

  // ─── Small render helpers (functions, not components — keep input focus stable) ──

  // Monospace chip for the captured refId / form number (load-bearing; shown even for
  // internal refIds — here the id IS the citation to what the user was viewing).
  function refChip(id: string) {
    return (
      <span className="inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tracking-[-.01em] bg-accent-soft text-accent">
        {id}
      </span>
    )
  }

  function listField(key: ListKey, label: string, opts?: { mono?: boolean; addLabel?: string; max?: number; placeholder?: string }) {
    if (!draft) return null
    const values = draft[key] ?? []
    const max = opts?.max ?? 6
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">{label}</p>
        {values.length === 0 && <p className="text-[11px] text-faint italic -mt-0.5">None yet — add what "done" looks like.</p>}
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={v} onChange={e => setListItem(key, i, e.target.value)} placeholder={opts?.placeholder}
              className={`flex-1 h-8 rounded-[8px] bg-surface text-text text-[13px] px-2.5 focus:outline-none focus:ring-2 focus:ring-accent/25 ${opts?.mono ? 'font-mono text-[12px]' : ''}`}
              style={{ border: '1px solid var(--color-border-strong)' }}
            />
            <button
              type="button" onClick={() => removeListItem(key, i)} aria-label={`Remove ${label} item`}
              className="w-8 h-8 shrink-0 rounded-[8px] flex items-center justify-center text-faint hover:text-danger hover:bg-raised transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              <IconClose size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
        {values.length < max && (
          <button
            type="button" onClick={() => addListItem(key)}
            className="self-start inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <IconPlus size={12} aria-hidden="true" /> {opts?.addLabel ?? 'Add'}
          </button>
        )}
      </div>
    )
  }

  function scaleField(key: 'impact' | 'effort', label: string, labels: [string, string, string]) {
    if (!draft) return null
    const val = draft[key]
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">{label}</p>
        <div className="inline-flex rounded-[9px] bg-raised p-0.5 self-start" role="group" aria-label={label}>
          {([1, 2, 3] as const).map(n => {
            const active = val === n
            return (
              <button
                key={n} type="button" aria-pressed={active}
                onClick={() => patchDraft(key === 'impact' ? { impact: n } : { effort: n })}
                className={`px-3 h-8 rounded-[7px] text-[12px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${active ? 'bg-surface text-accent' : 'text-dim hover:text-text'}`}
                style={active ? { boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : undefined}
              >
                {labels[n - 1]}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ─── Body per phase ───────────────────────────────────────────────────────────

  const captureBody = (
    <div className="flex flex-col gap-5">
      <Input label="What's on your mind?" value={title} onChange={e => setTitle(e.target.value)}
        placeholder="A rough note — AI will shape it into a story" autoFocus />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text" htmlFor="fb-detail">More detail <span className="text-faint font-normal">(optional)</span></label>
        <textarea id="fb-detail" value={detail} onChange={e => setDetail(e.target.value)} rows={4}
          placeholder="What happened, or what would help? Or just attach a screenshot below."
          className="rounded-[12px] bg-surface text-sm text-text p-3.5 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none leading-relaxed"
          style={{ border: '1.5px solid var(--color-border-strong)' }} />
      </div>

      {/* Auto-attached context */}
      <div className="flex items-center gap-2 text-xs text-faint rounded-[10px] px-3.5 py-2.5"
        style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
        <IconLink size={12} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
          Linked to <span className="text-dim font-medium">{capLabel}</span>
          {capRefId && refChip(capRefId)}
        </span>
      </div>
    </div>
  )

  const shapingBody = (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex items-center gap-2.5 text-sm text-dim">
        <IconSparkle size={16} className="text-accent animate-pulse" aria-hidden="true" />
        Refining your note into a structured story…
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="h-3 rounded-full bg-raised w-2/3" />
        <div className="h-3 rounded-full bg-raised w-1/2" />
        <div className="h-20 rounded-[12px] bg-raised" />
        <div className="h-3 rounded-full bg-raised w-3/4" />
      </div>
    </div>
  )

  const previewBody = draft && (
    <div className="flex flex-col gap-5">
      {/* Near-duplicate suggestion */}
      {nearMatch && (
        <div className="flex flex-col gap-2 rounded-[12px] px-3.5 py-3"
          style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)' }}>
          <p className="text-[13px] text-text leading-snug">
            Looks like <span className="font-semibold">"{nearMatch.title}"</span> already exists.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void voteInstead()} disabled={busy}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[12px] font-semibold text-white transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{ background: 'var(--gradient-accent)' }}>
              <IconArrowUp size={13} aria-hidden="true" /> Add my vote instead
            </button>
            <button type="button" onClick={() => setNearMatch(null)} disabled={busy}
              className="h-8 px-2.5 rounded-[8px] text-[12px] font-medium text-dim hover:text-text hover:bg-surface transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              No, this is new
            </button>
          </div>
        </div>
      )}

      {/* Type */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">Type</p>
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map(t => {
            const Icon = t.icon; const active = draft.type === t.id
            return (
              <button key={t.id} type="button" onClick={() => patchDraft({ type: t.id })} aria-pressed={active}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-[12px] text-[12px] font-medium transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${active ? 'text-accent' : 'bg-raised text-dim hover:text-text'}`}
                style={active
                  ? { background: 'var(--color-accent-soft)', border: '1.5px solid var(--color-accent-line)', boxShadow: '0 0 0 3px var(--color-accent-soft)' }
                  : { border: '1.5px solid transparent' }}>
                <Icon size={18} /> {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <Input label="Title" value={draft.title} onChange={e => patchDraft({ title: e.target.value })} placeholder="Canonical title" />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text" htmlFor="fb-summary">Summary</label>
        <textarea id="fb-summary" value={draft.summary} onChange={e => patchDraft({ summary: e.target.value })} rows={3}
          placeholder="One-line description of the story"
          className="rounded-[12px] bg-surface text-sm text-text p-3.5 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none leading-relaxed"
          style={{ border: '1.5px solid var(--color-border-strong)' }} />
      </div>

      {listField('acceptanceCriteria', 'Acceptance criteria', { addLabel: 'Add criterion', max: 4, placeholder: 'A testable "done" statement' })}

      {/* Issue-only fields */}
      {draft.type === 'ISSUE' && (
        <>
          {listField('reproSteps', 'Steps to reproduce', { addLabel: 'Add step', max: 6, placeholder: 'Step to reproduce' })}
          {listField('likelyFiles', 'Likely files', { mono: true, addLabel: 'Add file', max: 6, placeholder: 'app/src/…' })}
        </>
      )}

      {/* Impact / Effort / live priority */}
      <div className="flex items-end gap-5 flex-wrap">
        {scaleField('impact', 'Impact', ['Low', 'Med', 'High'])}
        {scaleField('effort', 'Effort', ['S', 'M', 'L'])}
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Priority</p>
          <span className="inline-flex items-center h-8 px-2.5 rounded-[8px] bg-raised text-dim text-[12px] font-semibold tabular-nums"
            title="WSJF: impact ÷ effort at submit time">
            {priorityScore(draft.impact, draft.effort, 0, 0)}
          </span>
        </div>
      </div>

      {/* Affected surface + refId chip (the captured, grounded context) */}
      <div className="flex items-center gap-2 text-xs text-faint rounded-[10px] px-3.5 py-2.5"
        style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
        <IconLink size={12} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
          Affected surface <span className="text-dim font-medium">{capLabel}</span>
          {capRefId && refChip(capRefId)}
        </span>
      </div>

      {/* Grounding honesty note from the model, if any */}
      {draft.groundingNote && (
        <div className="flex items-start gap-2 text-xs text-warn rounded-[10px] px-3.5 py-2.5"
          style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
          <IconInfo size={13} className="shrink-0 mt-px" aria-hidden="true" />
          <span className="leading-relaxed">{draft.groundingNote}</span>
        </div>
      )}
    </div>
  )

  const errorBody = (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5 rounded-[12px] px-3.5 py-3 text-sm text-warn"
        style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
        <IconInfo size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span className="leading-relaxed">{errorMsg ?? 'The AI could not shape this right now.'} You can try again, or enter the details yourself.</span>
      </div>
    </div>
  )

  // Screenshot panel — kept at a STABLE last position across phases so the canvas element
  // (and its annotations) is never remounted. Tools + pointer editing only on the capture step.
  const screenshotPanel = screenshot && (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Screenshot</p>

      {phase === 'capture' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(Object.entries(DRAW_TOOLS) as [Exclude<Tool,'crop'>, typeof DRAW_TOOLS[Exclude<Tool,'crop'>]][]).map(([key, tool]) => (
            <button key={key} type="button" onClick={() => setActiveTool(key)}
              aria-pressed={activeTool === key}
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${activeTool === key ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
              style={activeTool === key ? { border: '1px solid var(--color-accent-line)' } : { border: '1px solid transparent' }}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tool.color, opacity: tool.alpha + 0.3 }} />
              {tool.label}
            </button>
          ))}

          <button type="button" onClick={() => { setActiveTool('crop'); setCropSel(null) }}
            aria-pressed={activeTool === 'crop'}
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${activeTool === 'crop' ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
            style={activeTool === 'crop' ? { border: '1px solid var(--color-accent-line)' } : { border: '1px solid transparent' }}
          >
            ✂ Snip
          </button>

          {activeTool === 'crop' && hasCropArea && (
            <button type="button" onClick={() => void commitCrop()}
              className="h-7 px-2.5 rounded-[7px] text-[11px] font-semibold text-white transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ background: 'var(--gradient-accent)' }}>
              Crop to selection
            </button>
          )}

          <span className="flex-1" />

          {strokes.length > 0 && activeTool !== 'crop' && (
            <button type="button" onClick={undoStroke}
              className="h-7 px-2.5 rounded-[7px] text-[11px] font-medium text-dim bg-raised hover:text-text transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ border: '1px solid transparent' }}>
              Undo
            </button>
          )}
          {strokes.length > 0 && activeTool !== 'crop' && (
            <button type="button" onClick={clearAnnotations}
              className="h-7 px-2.5 rounded-[7px] text-[11px] font-medium text-dim bg-raised hover:text-danger transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ border: '1px solid transparent' }}>
              Clear
            </button>
          )}
          <button type="button" onClick={() => setScreenshot(null)}
            aria-label="Remove screenshot"
            className="h-7 w-7 flex items-center justify-center rounded-[7px] text-faint bg-raised hover:text-danger transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            style={{ border: '1px solid transparent' }}>
            <IconClose size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Annotation canvas — interactive only on the capture step */}
      <div className="relative rounded-[12px] overflow-hidden select-none"
        style={{ border: '1px solid var(--color-border)' }}>
        <canvas
          ref={annotationCanvasRef}
          onPointerDown={phase === 'capture' ? onPointerDown : undefined}
          onPointerMove={phase === 'capture' ? onPointerMove : undefined}
          onPointerUp={phase === 'capture' ? onPointerUp : undefined}
          onPointerLeave={phase === 'capture' ? onPointerUp : undefined}
          className="w-full block object-contain"
          style={{
            maxHeight: phase === 'capture' ? '44vh' : '26vh',
            cursor: phase !== 'capture' ? 'default' : activeTool === 'highlight' ? 'cell' : 'crosshair',
            touchAction: 'none',
          }}
          aria-label={phase === 'capture' ? 'Annotate or crop the screenshot' : 'Attached screenshot'}
        />
        {phase === 'capture' && cropOverlay}
      </div>
    </div>
  )

  // Capture step's screenshot CTA (shown only when there's no screenshot yet).
  const screenshotCta = !screenshot && phase === 'capture' && (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Screenshot <span className="normal-case font-normal text-faint/70">(optional — drives the AI vision pass)</span></p>
      <button
        type="button" onClick={captureScreen}
        className="flex items-center justify-center gap-2.5 rounded-[12px] text-sm font-medium text-dim hover:text-accent hover:bg-accent-soft border border-dashed transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        style={{ borderColor: 'var(--color-border-strong)', minHeight: '100px' }}
      >
        <IconCamera size={18} aria-hidden="true" />
        <span>Capture screen</span>
        <span className="text-[11px] text-faint ml-1">or paste (⌘V)</span>
      </button>
    </div>
  )

  const header = {
    capture: { title: 'Refine with AI', sub: 'Jot a rough note — AI shapes it into a story you approve.' },
    shaping: { title: 'Refining…',      sub: 'Turning your note into a structured story.' },
    preview: { title: 'Review the story', sub: 'Edit anything, then accept to submit.' },
    error:   { title: 'Refine unavailable', sub: 'Try again or enter the details yourself.' },
  }[phase]

  return (
    <>
      {children}

      {/* Floating capture button */}
      <button
        onClick={() => setOpen(true)}
        title="Capture feedback (⌘.)" aria-label="Capture feedback"
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 8px 24px var(--glow-accent-strong)' }}
      >
        <IconChat size={20} aria-hidden="true" />
      </button>

      {/* "Select this tab…" hint shown while the dialog is hidden mid-capture */}
      {capturing && (
        <div className="fixed bottom-20 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-surface text-sm text-dim shadow-lg"
          style={{ border: '1px solid var(--color-border)' }}>
          <IconCamera size={15} className="animate-pulse text-accent" aria-hidden="true" />
          Select this tab in the picker…
        </div>
      )}

      {/* Drawer panel — portal-rendered so it sits above every route layer */}
      {open && !capturing && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'var(--color-overlay-light)', backdropFilter: 'blur(2px)' }}
            onClick={close}
            aria-hidden="true"
          />

          {/* Right-side panel */}
          <div
            role="dialog" aria-modal="true" aria-label="Capture feedback"
            className="fixed top-0 right-0 bottom-0 z-50 w-[580px] max-w-[95vw] flex flex-col bg-surface slide-in-right"
            style={{ borderLeft: '1px solid var(--color-border)', boxShadow: '-8px 0 48px rgba(0,0,0,.12)' }}
          >
            {/* ── Sticky header ── */}
            <div className="shrink-0 flex items-start justify-between px-7 pt-6 pb-5"
              style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[17px] font-bold text-text tracking-tight leading-snug flex items-center gap-2">
                  {phase === 'capture' && <IconSparkle size={16} className="text-accent" aria-hidden="true" />}
                  {header.title}
                </h2>
                <p className="text-[12px] text-faint">{header.sub}</p>
              </div>
              <button
                onClick={close}
                className="w-8 h-8 -mt-0.5 -mr-1 rounded-full flex items-center justify-center text-faint hover:text-text hover:bg-raised transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                aria-label="Close"
              >
                <IconClose size={16} aria-hidden="true" />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5 flex flex-col gap-5">
              {phase === 'capture' && captureBody}
              {phase === 'shaping' && shapingBody}
              {phase === 'preview' && previewBody}
              {phase === 'error'   && errorBody}
              {screenshotCta}
              {/* Stable last slot — canvas stays mounted across phase changes. */}
              {screenshotPanel}
            </div>

            {/* ── Sticky footer ── */}
            <div className="shrink-0 flex items-center justify-end gap-2.5 px-7 py-4"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              {phase === 'capture' && (
                <>
                  <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => void refineWithAI()} disabled={!canRefine}>
                    <IconSparkle size={14} aria-hidden="true" /> Refine with AI
                  </Button>
                </>
              )}
              {phase === 'shaping' && (
                <span className="flex items-center gap-2 text-sm text-dim mr-auto">
                  <IconSpinner size={15} className="animate-spin" aria-hidden="true" /> Working…
                </span>
              )}
              {phase === 'preview' && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setPhase('capture')} disabled={busy}>Back</Button>
                  <Button variant="primary" size="sm" onClick={() => void accept()} disabled={busy || !draft?.title.trim()}>
                    {busy ? 'Submitting…' : 'Accept & submit'}
                  </Button>
                </>
              )}
              {phase === 'error' && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setPhase('capture')} disabled={busy}>Back</Button>
                  <Button variant="ghost" size="sm" onClick={enterManually} disabled={busy}>Enter manually</Button>
                  <Button variant="primary" size="sm" onClick={() => void refineWithAI()} disabled={busy}>Try again</Button>
                </>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
