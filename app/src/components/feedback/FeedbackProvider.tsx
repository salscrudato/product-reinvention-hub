// FeedbackProvider — global quick-capture that becomes a "Send your Feedback" story flow.
// A ⌘. shortcut / floating button opens ONE drawer with a single feedback box, an optional
// screenshot (capture the tab or paste; then snip a region, draw, or drop a labelled callout),
// and optional document attachments. "Send your Feedback" calls the server-side `shapeFeedback`
// callable, which reads the wording + annotated screenshot + attachments and returns a polished,
// ship-ready user story. The user reviews the story, then submits it via adapter.db.mutate().
//
// Maintainer power tool: for the maintainer only (identified by VITE_MAINTAINER_EMAIL), the story
// exposes a "More details" panel with an AI-written, copy-paste, deploy-ready Claude Code
// implementation brief. Everyone else sees only the polished story. The knob is OPTIONAL — unset
// (the default) means no one is treated as maintainer and the panel is never shown.
//
// Entity context is automatic: the drawer reads what the user is viewing from CaptureContext
// (the exact coverage/form/rule + its refId, or the product+tab, else the route label) and
// attaches it — persisted on the record and rendered as a monospace chip. Dedup: if shaping
// finds a near-duplicate, the story offers a one-tap "add your vote instead".
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { useCapture } from '../../context/useCapture'
import { FeedbackLaunchCtx, type FeedbackPrefill } from '../../context/FeedbackLaunchContext'
import { Button } from '../ui'
import { IconChat, IconLink, IconCamera, IconClose, IconSparkle, IconSpinner, IconArrowUp, IconInfo, IconFile, IconCopy, IconCheck, IconChevronDown, IconChevronUp, IconKey, IconTrash } from '../ui/icons'
import { priorityScore, type FeedbackType, type Feedback } from '@pf/shared'

// The maintainer who may see the implementation brief — sourced from a build-time env var so no
// identity is hard-coded into the client bundle. Empty (unset) disables the maintainer panel.
const MAINTAINER_EMAIL = (import.meta.env.VITE_MAINTAINER_EMAIL ?? '').trim().toLowerCase()

type Tool  = 'pen' | 'highlight' | 'crop' | 'text'
type Point = { x: number; y: number }
// A canvas annotation — a freehand stroke or a labelled text callout. One ordered list so
// Undo removes the most recent mark regardless of kind.
type Stroke     = { kind: 'stroke'; color: string; alpha: number; width: number; points: Point[] }
type Label      = { kind: 'label'; x: number; y: number; text: string }
type Annotation = Stroke | Label

const DRAW_TOOLS: Record<'pen' | 'highlight', { color: string; alpha: number; width: number; label: string }> = {
  pen:       { color: '#ef4444', alpha: 1,   width: 3,  label: 'Pen'       },
  highlight: { color: '#fbbf24', alpha: 0.4, width: 12, label: 'Highlight' },
}
const LABEL_BG     = '#0f172a'  // callout box (baked into the image, so hex is correct here)
const LABEL_ACCENT = '#ef4444'

interface Attachment { name: string; url: string; mediaType: string }
const MAX_ATTACH = 4

// ─── shapeFeedback wire contract (mirrors functions/src/shapeFeedback.ts) ─────────
type ShapedType = FeedbackType
interface ShapedStory {
  title:                 string
  type:                  ShapedType
  userStory?:            string          // "As a … I want … so that …"
  summary:               string          // narrative → persisted as `detail`
  affectedSurface:       string
  acceptanceCriteria:    string[]
  impact:                1 | 2 | 3
  effort:                1 | 2 | 3
  refId?:                string
  reproSteps?:           string[]        // ISSUE only
  likelyFiles?:          string[]        // ISSUE only
  implementationPrompt?: string          // deploy-ready Claude Code brief (maintainer-only)
  groundingNote?:        string
}
interface ShapeFeedbackInput {
  rawTitle:       string
  rawDetail?:     string
  routeLabel?:    string
  route?:         string
  entityPath?:    string
  refId?:         string
  screenshotUrl?: string
  attachments?:   Attachment[]
}
interface ShapeFeedbackOutput {
  story:      ShapedStory
  nearMatch?: { id: string; title: string; score: number }
}

type FeedbackDoc = Feedback & { id: string; rev?: number }
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

// A rounded-rect path drawn manually (no dependency on the newer ctx.roundRect).
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

// Draw a labelled callout: a dark rounded pill with a coloured accent bar and white text,
// scaled to the canvas resolution so it stays legible when the canvas is displayed smaller.
function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  const fontPx = Math.max(16, Math.round(ctx.canvas.width / 42))
  const padX = Math.round(fontPx * 0.6)
  const padY = Math.round(fontPx * 0.42)
  const barW = Math.max(3, Math.round(fontPx * 0.24))
  ctx.save()
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  const textW = ctx.measureText(text).width
  const boxW  = Math.ceil(textW) + padX * 2 + barW + Math.round(fontPx * 0.3)
  const boxH  = fontPx + padY * 2
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur  = fontPx * 0.5
  ctx.shadowOffsetY = 2
  roundRectPath(ctx, x, y, boxW, boxH, Math.round(fontPx * 0.5))
  ctx.fillStyle = LABEL_BG
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = LABEL_ACCENT
  ctx.fillRect(x + padX * 0.6, y + padY, barW, boxH - padY * 2)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX * 0.6 + barW + Math.round(fontPx * 0.4), y + boxH / 2)
  ctx.restore()
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { user } = useUser()
  const { viewed } = useCapture()
  const location = useLocation()
  const canEdit = canI(user, 'product:write')
  const isMaintainer = MAINTAINER_EMAIL !== '' && (user?.email ?? '').toLowerCase() === MAINTAINER_EMAIL

  // A programmatic prefill (Claims coverage-gap → "Create product feedback"). When set, its
  // context overrides the auto-detected view context for this capture.
  const [prefill, setPrefill] = useState<FeedbackPrefill | null>(null)

  // What the user is viewing — the prefill's context wins, then the exact entity (CaptureContext),
  // then the route label.
  const capLabel      = prefill?.context?.label      ?? viewed?.label ?? describeRoute(location.pathname)
  const capRoute      = prefill?.context?.route      ?? location.pathname
  const capEntityPath = prefill?.context?.entityPath ?? viewed?.entityPath
  const capRefId      = prefill?.context?.refId      ?? viewed?.refId
  const capBaseFormNumber   = prefill?.context?.baseFormNumber
  const capMatchedProductId = prefill?.context?.matchedProductId

  const [open, setOpen]   = useState(false)
  const [phase, setPhase] = useState<Phase>('capture')
  const [note, setNote]   = useState('')       // the single feedback box
  const [busy, setBusy]   = useState(false)

  // Shaped story + dedup + the in-flight uploaded-screenshot URL.
  const [draft, setDraft]         = useState<ShapedStory | null>(null)
  const [nearMatch, setNearMatch] = useState<ShapeFeedbackOutput['nearMatch'] | null>(null)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [shotUrl, setShotUrl]     = useState<string | null>(null)

  // Attachments + the maintainer prompt disclosure.
  const [attachments, setAttachments]       = useState<Attachment[]>([])
  const [uploadingAttach, setUploadingAttach] = useState(false)
  const [showPrompt, setShowPrompt]         = useState(false)
  const [copied, setCopied]                 = useState(false)

  // Screenshot + annotation
  const [screenshot, setScreenshot]   = useState<Blob | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeTool, setActiveTool]   = useState<Tool>('pen')
  const [capturing, setCapturing]     = useState(false)
  const [cropSel, setCropSel]         = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [textInput, setTextInput]     = useState<{ cssX: number; cssY: number; value: string } | null>(null)

  // A stable per-submission id for Storage paths (screenshot + attachments), lazily created.
  const idRef = useRef<string | null>(null)
  const feedbackId = () => (idRef.current ??= crypto.randomUUID())

  const annotationCanvasRef = useRef<HTMLCanvasElement>(null)
  const baseImageRef        = useRef<HTMLImageElement | null>(null)
  const currentStrokeRef    = useRef<Point[]>([])
  const isDrawingRef        = useRef(false)
  const lastPointRef        = useRef<Point | null>(null)
  const isCroppingRef       = useRef(false)
  const textInputElRef      = useRef<HTMLInputElement>(null)

  // Load screenshot blob onto the annotation canvas; reset annotations for each new capture.
  useEffect(() => {
    if (!screenshot) { baseImageRef.current = null; setAnnotations([]); setCropSel(null); setTextInput(null); return }
    const url = URL.createObjectURL(screenshot)
    const img = new Image()
    img.onload = () => {
      baseImageRef.current = img
      setAnnotations([])
      setCropSel(null)
      setTextInput(null)
      const canvas = annotationCanvasRef.current
      if (!canvas) return
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [screenshot])

  // Full canvas re-render from committed annotations — called after undo / clear / label add.
  function renderCanvas(current: Annotation[]) {
    const canvas = annotationCanvasRef.current
    const img    = baseImageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    for (const a of current) {
      if (a.kind === 'label') { drawLabel(ctx, a.x, a.y, a.text); continue }
      if (a.points.length < 2) continue
      ctx.save()
      ctx.beginPath()
      ctx.strokeStyle = a.color
      ctx.lineWidth   = a.width
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.globalAlpha = a.alpha
      ctx.moveTo(a.points[0]!.x, a.points[0]!.y)
      for (const pt of a.points.slice(1)) ctx.lineTo(pt.x, pt.y)
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

  // Focus the callout input the moment it appears.
  useEffect(() => { if (textInput) textInputElRef.current?.focus() }, [textInput])

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
        preferCurrentTab: true,
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
      if (blob) { setScreenshot(blob); setActiveTool('pen') }
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

  // ─── Pointer events (draw + crop + place-callout share the canvas) ───────────
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activeTool === 'text') {
      const { x, y } = getCssPoint(e)
      setTextInput({ cssX: x, cssY: y, value: '' })
      return
    }
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
    if (activeTool === 'text') return
    if (!isDrawingRef.current || !lastPointRef.current) return
    const pt     = getCanvasPoint(e)
    const canvas = annotationCanvasRef.current
    if (!canvas) return
    const tool = DRAW_TOOLS[activeTool]
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
    if (activeTool === 'crop') { isCroppingRef.current = false; return }
    if (activeTool === 'text') return
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    const points = currentStrokeRef.current
    if (points.length > 1) {
      const tool = DRAW_TOOLS[activeTool]
      setAnnotations(prev => [...prev, { kind: 'stroke', color: tool.color, alpha: tool.alpha, width: tool.width, points }])
    }
    currentStrokeRef.current = []
    lastPointRef.current = null
  }

  // Commit the in-progress text callout at its canvas position.
  function commitTextLabel() {
    const canvas = annotationCanvasRef.current
    if (!textInput || !canvas) { setTextInput(null); return }
    const text = textInput.value.trim()
    if (!text) { setTextInput(null); return }
    const rect = canvas.getBoundingClientRect()
    const x = textInput.cssX * (canvas.width  / rect.width)
    const y = textInput.cssY * (canvas.height / rect.height)
    const next: Annotation[] = [...annotations, { kind: 'label', x, y, text }]
    setAnnotations(next)
    renderCanvas(next)
    setTextInput(null)
  }

  // Crop: extract the selected region from the annotation canvas into a new screenshot.
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
    if (blob) { setActiveTool('pen'); setScreenshot(blob) }
  }

  function undoAnnotation() {
    const next = annotations.slice(0, -1)
    setAnnotations(next)
    renderCanvas(next)
  }
  function clearAnnotations() { setAnnotations([]); renderCanvas([]) }

  /** Export the annotated canvas as a PNG blob (or null if there's no image). */
  function exportCanvasBlob(): Promise<Blob | null> {
    const canvas = annotationCanvasRef.current
    if (!canvas || !screenshot) return Promise.resolve(null)
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  }

  // ─── Attachments ──────────────────────────────────────────────────────────────
  async function addFiles(files: FileList | null) {
    if (!user || !files || files.length === 0) return
    setUploadingAttach(true)
    try {
      const id = feedbackId()
      const room = MAX_ATTACH - attachments.length
      const next = [...attachments]
      for (const file of Array.from(files).slice(0, Math.max(0, room))) {
        const safe = file.name.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file'
        const path = `uploads/${user.uid}/feedback/${id}/att-${Date.now()}-${safe}`
        const url  = await adapter.storage.upload(path, file)
        next.push({ name: file.name, url, mediaType: file.type || 'application/octet-stream' })
      }
      setAttachments(next)
      if (files.length > room) toast.info(`Up to ${MAX_ATTACH} attachments`)
    } catch {
      toast.error('Attachment upload failed')
    } finally {
      setUploadingAttach(false)
    }
  }
  function removeAttachment(i: number) { setAttachments(a => a.filter((_, j) => j !== i)) }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────
  function reset() {
    setPhase('capture')
    setNote('')
    setScreenshot(null); setAnnotations([]); setActiveTool('pen'); setCropSel(null); setTextInput(null)
    setDraft(null); setNearMatch(null); setErrorMsg(null)
    setShotUrl(null); setAttachments([]); setShowPrompt(false); setCopied(false)
    setPrefill(null)
    idRef.current = null
  }
  function close() { setOpen(false); reset() }

  // Open the drawer prefilled (e.g. from a Claims coverage gap) and run the normal flow.
  const openFeedback = useCallback((p: FeedbackPrefill) => {
    reset()
    setPrefill(p)
    setNote(p.note)
    setPhase('capture')
    setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const launchValue = useMemo(() => ({ openFeedback }), [openFeedback])

  const canSend = (!!note.trim() || !!screenshot || attachments.length > 0) && !busy && !uploadingAttach

  // Send: upload the annotated screenshot, then call shapeFeedback and show the story.
  async function sendFeedback() {
    if (!user || !canSend) return
    setBusy(true); setErrorMsg(null); setPhase('shaping')
    try {
      const id = feedbackId()
      let uploadedUrl: string | undefined = shotUrl ?? undefined
      if (screenshot) {
        const blob = await exportCanvasBlob()
        if (blob) {
          const file = new File([blob], `${id}.png`, { type: 'image/png' })
          uploadedUrl = await adapter.storage.upload(`uploads/${user.uid}/feedback/${id}.png`, file)
          setShotUrl(uploadedUrl)
        }
      } else { uploadedUrl = undefined; setShotUrl(null) }

      const noteText = note.trim()
      const rawTitle = ((noteText.split('\n')[0] || noteText).slice(0, 200)) || 'Feedback from a screenshot'
      const out = await adapter.fns.call<ShapeFeedbackInput, ShapeFeedbackOutput>('shapeFeedback', {
        rawTitle,
        rawDetail:     noteText || undefined,
        routeLabel:    capLabel,
        route:         capRoute,
        entityPath:    capEntityPath,
        refId:         capRefId,
        screenshotUrl: uploadedUrl,
        ...(attachments.length ? { attachments } : {}),
      })
      // A prefill can force the story type (a coverage gap is always an IDEA), overriding the
      // AI's classification while keeping the shaped narrative it wrote.
      setDraft(prefill?.type ? { ...out.story, type: prefill.type } : out.story)
      setNearMatch(out.nearMatch ?? null)
      setPhase('preview')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not reach the AI.')
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  // Error fallback: skip the AI and submit a minimal story from the raw note.
  function enterManually() {
    const noteText = note.trim()
    setDraft({
      title:              (noteText.split('\n')[0] || 'Feedback').slice(0, 80),
      type:               'IDEA',
      userStory:          noteText ? `As a product manager, I want ${noteText.slice(0, 120)}` : undefined,
      summary:            noteText || 'Feedback from a screenshot',
      affectedSurface:    capLabel,
      acceptanceCriteria: [],
      impact:             2,
      effort:             2,
      ...(capRefId ? { refId: capRefId } : {}),
    })
    setNearMatch(null); setErrorMsg(null); setPhase('preview')
  }

  // Submit: write the shaped story through adapter.db.mutate() with REAL fields.
  async function submit() {
    if (!user || !draft || busy) return
    const finalTitle = draft.title.trim()
    if (!finalTitle) { toast.error('A title is required'); return }
    setBusy(true)
    try {
      const id = feedbackId()
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
          ...(draft.userStory?.trim() ? { userStory: draft.userStory.trim() } : {}),
          context: {
            route: capRoute,
            label: capLabel,
            ...(capEntityPath ? { entityPath: capEntityPath } : {}),
            ...(capRefId ? { refId: capRefId } : {}),
            ...(capBaseFormNumber ? { baseFormNumber: capBaseFormNumber } : {}),
            ...(capMatchedProductId ? { matchedProductId: capMatchedProductId } : {}),
          },
          votes: { count: 0, voters: [] },
          status: 'NEW',
          impact: draft.impact,
          effort: draft.effort,
          priorityScore: priorityScore(draft.impact, draft.effort, 0, 0),
          ...(ac.length ? { acceptanceCriteria: ac } : {}),
          ...(repro.length ? { reproSteps: repro } : {}),
          ...(files.length ? { likelyFiles: files } : {}),
          ...(draft.implementationPrompt?.trim() ? { implementationPrompt: draft.implementationPrompt.trim() } : {}),
          author: actor,
          ...(shotUrl ? { screenshotUrl: shotUrl } : {}),
          ...(attachments.length ? { attachments } : {}),
        },
        entityType: 'feedback',
        actor,
      })
      // Notify a programmatic opener (e.g. Claims) so it can render a "Linked feedback" chip.
      prefill?.onSubmitted?.(id)
      toast.success('Feedback sent — thank you')
      close()
    } catch {
      toast.error('Could not submit feedback')
    } finally {
      setBusy(false)
    }
  }

  // Near-duplicate: add the user's vote to the existing item instead of creating a dupe.
  async function voteInstead() {
    if (!user || !nearMatch || busy) return
    setBusy(true)
    const path  = `feedback/${nearMatch.id}`
    const actor = { uid: user.uid, name: user.name ?? user.email ?? 'User' }
    try {
      const cur = await adapter.db.get<FeedbackDoc>(path)
      if (!cur) { toast.error('That item no longer exists'); setBusy(false); return }
      const already = (cur.votes?.voters ?? []).includes(user.uid)
      const noteText = note.trim() || (draft?.summary?.trim() ?? '')

      if (canEdit) {
        const rest: Record<string, unknown> = { ...cur }
        delete rest.id
        const appendedDetail = noteText ? `${cur.detail}\n\n— ${actor.name}: ${noteText}` : cur.detail
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
      if (err instanceof MutationConflictError) {
        conflictToast({ discard: close })
      } else {
        toast.error('Could not add your vote')
      }
    } finally {
      setBusy(false)
    }
  }

  async function copyPrompt() {
    if (!draft?.implementationPrompt) return
    try {
      await navigator.clipboard.writeText(draft.implementationPrompt)
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { toast.error('Copy failed') }
  }

  // ─── Crop selection overlay ────────────────────────────────────────────────────
  const cropOverlay = cropSel && activeTool === 'crop' && (() => {
    const minX = Math.min(cropSel.x1, cropSel.x2)
    const minY = Math.min(cropSel.y1, cropSel.y2)
    const w    = Math.abs(cropSel.x2 - cropSel.x1)
    const h    = Math.abs(cropSel.y2 - cropSel.y1)
    if (w < 2 || h < 2) return null
    return (
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute" style={{ left: minX, top: minY, width: w, height: h, outline: '2px solid white', boxShadow: '0 0 0 9999px var(--color-scrim-strong)' }} />
      </div>
    )
  })()

  const hasCropArea = cropSel && Math.abs(cropSel.x2 - cropSel.x1) > 10 && Math.abs(cropSel.y2 - cropSel.y1) > 10

  // ─── Small render helpers ───────────────────────────────────────────────────────
  function refChip(id: string) {
    return (
      <span className="inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tracking-[-.01em] bg-accent-soft text-accent">{id}</span>
    )
  }

  // ─── Body per phase ───────────────────────────────────────────────────────────
  const captureBody = (
    <div className="flex flex-col gap-5">
      {/* One feedback box */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text" htmlFor="fb-note">Your feedback</label>
        <textarea id="fb-note" value={note} onChange={e => setNote(e.target.value)} rows={5} autoFocus
          placeholder="What's on your mind? An idea, a bug, or praise — in plain words. AI will shape it into a story."
          className="rounded-[12px] bg-surface text-sm text-text p-3.5 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none leading-relaxed"
          style={{ border: '1.5px solid var(--color-border-strong)' }} />
      </div>

      {/* Attachments (optional) */}
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">
          Attachments <span className="normal-case font-normal text-faint/70">(optional — read by the AI)</span>
        </p>
        {attachments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-[12px] text-dim"
                style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
                <IconFile size={13} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate flex-1">{a.name}</span>
                <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.name}`}
                  className="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-faint hover:text-danger hover:bg-surface transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                  <IconClose size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachments.length < MAX_ATTACH && (
          <label className="self-start inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[12px] font-medium text-dim bg-raised hover:text-accent hover:bg-accent-soft transition-colors cursor-pointer focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent"
            style={{ border: '1px solid var(--color-border)' }}>
            {uploadingAttach ? <IconSpinner size={13} className="animate-spin" aria-hidden="true" /> : <IconFile size={13} aria-hidden="true" />}
            {uploadingAttach ? 'Uploading…' : 'Attach documents'}
            <input type="file" multiple className="hidden" disabled={uploadingAttach}
              accept=".pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,image/*,application/pdf,text/plain"
              onChange={e => { void addFiles(e.target.files); e.target.value = '' }} />
          </label>
        )}
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
        Shaping your feedback into a ship-ready story…
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
          <p className="text-[13px] text-text leading-snug">Looks like <span className="font-semibold">"{nearMatch.title}"</span> already exists.</p>
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

      {/* Title */}
      <h3 className="text-[19px] font-bold text-text tracking-tight leading-snug">{draft.title}</h3>

      {/* User story — the elegant centerpiece */}
      {draft.userStory && (
        <div className="rounded-[12px] px-4 py-3.5" style={{ background: 'var(--color-accent-soft)', borderLeft: '3px solid var(--color-accent)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-accent mb-1">User story</p>
          <p className="text-[14px] text-text leading-relaxed">{draft.userStory}</p>
        </div>
      )}

      {/* Summary */}
      {draft.summary && draft.summary !== draft.title && (
        <p className="text-[13px] text-dim leading-relaxed">{draft.summary}</p>
      )}

      {/* Acceptance criteria */}
      {(draft.acceptanceCriteria ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Acceptance criteria</p>
          <ul className="flex flex-col gap-1.5">
            {draft.acceptanceCriteria.map((c, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-dim leading-relaxed">
                <IconCheck size={14} className="text-good shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ISSUE detail */}
      {draft.type === 'ISSUE' && (draft.reproSteps ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Steps to reproduce</p>
          <ol className="flex flex-col gap-1.5 list-decimal marker:text-faint marker:text-[11px] pl-4">
            {draft.reproSteps!.map((s, i) => <li key={i} className="text-[13px] text-dim leading-relaxed pl-0.5">{s}</li>)}
          </ol>
        </div>
      )}

      {/* Impact / Effort / Priority — read-only pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] bg-raised text-[11px] font-medium text-dim">
          Impact <span className="text-text font-semibold">{['Low', 'Medium', 'High'][draft.impact - 1]}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] bg-raised text-[11px] font-medium text-dim">
          Effort <span className="text-text font-semibold">{['Small', 'Medium', 'Large'][draft.effort - 1]}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] text-[11px] font-medium text-accent tabular-nums" style={{ background: 'var(--color-accent-soft)' }}>
          Priority {priorityScore(draft.impact, draft.effort, 0, 0)}
        </span>
      </div>

      {/* Affected surface + refId chip */}
      <div className="flex items-center gap-2 text-xs text-faint rounded-[10px] px-3.5 py-2.5"
        style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
        <IconLink size={12} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
          Affected surface <span className="text-dim font-medium">{draft.affectedSurface || capLabel}</span>
          {(draft.refId || capRefId) && refChip(draft.refId || capRefId!)}
        </span>
      </div>

      {/* Grounding honesty note */}
      {draft.groundingNote && (
        <div className="flex items-start gap-2 text-xs text-warn rounded-[10px] px-3.5 py-2.5"
          style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
          <IconInfo size={13} className="shrink-0 mt-px" aria-hidden="true" />
          <span className="leading-relaxed">{draft.groundingNote}</span>
        </div>
      )}

      {/* Maintainer-only: the deploy-ready implementation brief */}
      {isMaintainer && draft.implementationPrompt?.trim() && (
        <div className="flex flex-col gap-2 rounded-[12px] p-3" style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
          <button type="button" onClick={() => setShowPrompt(s => !s)}
            className="flex items-center justify-between gap-2 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-text">
              <IconKey size={13} className="text-accent" aria-hidden="true" /> More details — implementation prompt
            </span>
            {showPrompt ? <IconChevronUp size={15} className="text-faint" aria-hidden="true" /> : <IconChevronDown size={15} className="text-faint" aria-hidden="true" />}
          </button>
          {showPrompt && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-faint">Copy → paste to Claude Code to implement + deploy.</span>
                <button type="button" onClick={() => void copyPrompt()}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-[11px] font-semibold text-white transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  style={{ background: 'var(--gradient-accent)' }}>
                  {copied ? <><IconCheck size={12} aria-hidden="true" /> Copied</> : <><IconCopy size={12} aria-hidden="true" /> Copy</>}
                </button>
              </div>
              <pre className="text-[11.5px] leading-relaxed text-dim font-mono whitespace-pre-wrap break-words rounded-[9px] p-3 max-h-[40vh] overflow-y-auto"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                {draft.implementationPrompt}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const errorBody = (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5 rounded-[12px] px-3.5 py-3 text-sm text-warn"
        style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
        <IconInfo size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span className="leading-relaxed">{errorMsg ?? 'The AI could not shape this right now.'} You can try again, or submit it as-is.</span>
      </div>
    </div>
  )

  // Screenshot panel — STABLE last position across phases so the canvas never remounts.
  const screenshotPanel = screenshot && (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Screenshot</p>

      {phase === 'capture' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(Object.entries(DRAW_TOOLS) as ['pen' | 'highlight', typeof DRAW_TOOLS['pen']][]).map(([key, tool]) => (
            <button key={key} type="button" onClick={() => { setActiveTool(key); setTextInput(null) }} aria-pressed={activeTool === key}
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${activeTool === key ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
              style={activeTool === key ? { border: '1px solid var(--color-accent-line)' } : { border: '1px solid transparent' }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tool.color, opacity: tool.alpha + 0.3 }} />
              {tool.label}
            </button>
          ))}

          <button type="button" onClick={() => setActiveTool('text')} aria-pressed={activeTool === 'text'}
            className={`flex items-center gap-1 h-7 px-2.5 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${activeTool === 'text' ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
            style={activeTool === 'text' ? { border: '1px solid var(--color-accent-line)' } : { border: '1px solid transparent' }}>
            <span className="font-bold text-[12px] leading-none">T</span> Label
          </button>

          <button type="button" onClick={() => { setActiveTool('crop'); setCropSel(null); setTextInput(null) }} aria-pressed={activeTool === 'crop'}
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${activeTool === 'crop' ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
            style={activeTool === 'crop' ? { border: '1px solid var(--color-accent-line)' } : { border: '1px solid transparent' }}>
            ✂ Snip
          </button>

          {activeTool === 'crop' && hasCropArea && (
            <button type="button" onClick={() => void commitCrop()}
              className="h-7 px-2.5 rounded-[7px] text-[11px] font-semibold text-white cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ background: 'var(--gradient-accent)' }}>
              Crop to selection
            </button>
          )}

          <span className="flex-1" />

          {annotations.length > 0 && activeTool !== 'crop' && (
            <button type="button" onClick={undoAnnotation}
              className="h-7 px-2.5 rounded-[7px] text-[11px] font-medium text-dim bg-raised hover:text-text transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ border: '1px solid transparent' }}>Undo</button>
          )}
          {annotations.length > 0 && activeTool !== 'crop' && (
            <button type="button" onClick={clearAnnotations}
              className="h-7 px-2.5 rounded-[7px] text-[11px] font-medium text-dim bg-raised hover:text-danger transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ border: '1px solid transparent' }}>Clear</button>
          )}
          <button type="button" onClick={() => setScreenshot(null)} aria-label="Remove screenshot"
            className="h-7 w-7 flex items-center justify-center rounded-[7px] text-faint bg-raised hover:text-danger transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            style={{ border: '1px solid transparent' }}>
            <IconTrash size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Annotation canvas — interactive only on the capture step */}
      <div className="relative rounded-[12px] overflow-hidden select-none" style={{ border: '1px solid var(--color-border)' }}>
        <canvas
          ref={annotationCanvasRef}
          onPointerDown={phase === 'capture' ? onPointerDown : undefined}
          onPointerMove={phase === 'capture' ? onPointerMove : undefined}
          onPointerUp={phase === 'capture' ? onPointerUp : undefined}
          onPointerLeave={phase === 'capture' ? onPointerUp : undefined}
          className="w-full block object-contain"
          style={{
            maxHeight: phase === 'capture' ? '44vh' : '26vh',
            cursor: phase !== 'capture' ? 'default' : activeTool === 'text' ? 'text' : activeTool === 'highlight' ? 'cell' : 'crosshair',
            touchAction: 'none',
          }}
          aria-label={phase === 'capture' ? 'Annotate, label or crop the screenshot' : 'Attached screenshot'}
        />
        {phase === 'capture' && cropOverlay}
        {/* In-place callout text input */}
        {phase === 'capture' && textInput && (
          <input
            ref={textInputElRef}
            value={textInput.value}
            onChange={e => setTextInput(t => t ? { ...t, value: e.target.value } : t)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTextLabel() } else if (e.key === 'Escape') { setTextInput(null) } }}
            onBlur={commitTextLabel}
            placeholder="Type a note, Enter to place"
            className="absolute z-10 h-7 px-2 rounded-[6px] text-[12px] text-white bg-black/85 placeholder:text-white/50 focus:outline-none"
            style={{ left: Math.min(textInput.cssX, 260), top: textInput.cssY, minWidth: 160, border: '1px solid var(--color-on-media)' }}
          />
        )}
      </div>
      {phase === 'capture' && (
        <p className="text-[11px] text-faint">Snip a region, draw with Pen/Highlight, or drop a <span className="font-medium text-dim">Label</span> where you're pointing.</p>
      )}
    </div>
  )

  // Capture step's screenshot CTA (shown only when there's no screenshot yet).
  const screenshotCta = !screenshot && phase === 'capture' && (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Screenshot <span className="normal-case font-normal text-faint/70">(optional)</span></p>
      <button type="button" onClick={captureScreen}
        className="flex items-center justify-center gap-2.5 rounded-[12px] text-sm font-medium text-dim hover:text-accent hover:bg-accent-soft border border-dashed transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        style={{ borderColor: 'var(--color-border-strong)', minHeight: '100px' }}>
        <IconCamera size={18} aria-hidden="true" />
        <span>Capture screen</span>
        <span className="text-[11px] text-faint ml-1">then snip / annotate · or paste (⌘V)</span>
      </button>
    </div>
  )

  const header = {
    capture: { title: 'Share your feedback', sub: 'A note, a screenshot, or a doc — we’ll shape it into a story.' },
    shaping: { title: 'Shaping…',            sub: 'Turning your feedback into a structured story.' },
    preview: { title: 'Your story',          sub: 'Review it, then send.' },
    error:   { title: 'Shaping unavailable', sub: 'Try again or submit as-is.' },
  }[phase]

  return (
    <FeedbackLaunchCtx value={launchValue}>
      {children}

      {/* Floating capture button */}
      <button onClick={() => setOpen(true)} title="Send feedback (⌘.)" aria-label="Send feedback"
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 8px 24px var(--glow-accent-strong)' }}>
        <IconChat size={20} aria-hidden="true" />
      </button>

      {capturing && (
        <div className="fixed bottom-20 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-surface text-sm text-dim shadow-lg" style={{ border: '1px solid var(--color-border)' }}>
          <IconCamera size={15} className="animate-pulse text-accent" aria-hidden="true" /> Select this tab in the picker…
        </div>
      )}

      {open && !capturing && createPortal(
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'var(--color-overlay-light)', backdropFilter: 'blur(2px)' }} onClick={close} aria-hidden="true" />

          <div role="dialog" aria-modal="true" aria-label="Send feedback"
            className="fixed top-0 right-0 bottom-0 z-50 w-[580px] max-w-[95vw] flex flex-col bg-surface slide-in-right"
            style={{ borderLeft: '1px solid var(--color-border)', boxShadow: 'var(--shadow-overlay)' }}>
            {/* Header */}
            <div className="shrink-0 flex items-start justify-between px-7 pt-6 pb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[17px] font-bold text-text tracking-tight leading-snug flex items-center gap-2">
                  {phase === 'capture' && <IconSparkle size={16} className="text-accent" aria-hidden="true" />}
                  {header.title}
                </h2>
                <p className="text-[12px] text-faint">{header.sub}</p>
              </div>
              <button onClick={close} aria-label="Close"
                className="w-8 h-8 -mt-0.5 -mr-1 rounded-full flex items-center justify-center text-faint hover:text-text hover:bg-raised transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                <IconClose size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5 flex flex-col gap-5">
              {phase === 'capture' && captureBody}
              {phase === 'shaping' && shapingBody}
              {phase === 'preview' && previewBody}
              {phase === 'error'   && errorBody}
              {screenshotCta}
              {screenshotPanel}
            </div>

            {/* Footer */}
            <div className="shrink-0 flex items-center justify-end gap-2.5 px-7 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
              {phase === 'capture' && (
                <>
                  <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => void sendFeedback()} disabled={!canSend}>
                    <IconSparkle size={14} aria-hidden="true" /> Send your Feedback
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
                  <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !draft?.title.trim()}>
                    {busy ? 'Sending…' : 'Submit'}
                  </Button>
                </>
              )}
              {phase === 'error' && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setPhase('capture')} disabled={busy}>Back</Button>
                  <Button variant="ghost" size="sm" onClick={enterManually} disabled={busy}>Submit as-is</Button>
                  <Button variant="primary" size="sm" onClick={() => void sendFeedback()} disabled={busy}>Try again</Button>
                </>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </FeedbackLaunchCtx>
  )
}
