// icons.tsx — the app's own SVG icon family. Hand-drawn on a 24px grid, stroked
// with `currentColor` (rounded caps/joins) so every icon inherits colour + size
// from its context and feels part of one system rather than a stock set. A few
// domain glyphs carry a subtle accent-tinted fill for a more tactile, premium read.
// Prefer these over any third-party icon pack across authoring surfaces.
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string }

/** Shared shape for every in-house glyph — use where a component takes an icon. */
export type IconType = (props: IconProps) => React.ReactElement

// Shared frame: fixes the viewBox + stroke defaults; decorative unless a title is
// given (then it is announced to screen readers as an image).
function Glyph({ size = 20, title, children, strokeWidth = 1.6, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

// ─── Domain glyphs (products, coverages + the six coverage aspects) ───────────

/** Product — a faceted parcel / package, the unit a PM ships. */
export const IconProduct = (p: IconProps) => (
  <Glyph {...p}><path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7z" /><path d="M3.7 7.2 12 11.6l8.3-4.4" /><path d="M12 11.6V21" /></Glyph>
)

/** Coverage — a shield, the classic mark for protection/scope. */
export const IconCoverage = (p: IconProps) => (
  <Glyph {...p}><path d="M12 2.7 19 5.4v5.3c0 4.6-2.9 8-7 10.3-4.1-2.3-7-5.7-7-10.3V5.4z" /><path d="m9 11.6 2.2 2.2L15.2 9" /></Glyph>
)

/** Limit — a dial/gauge: a bounded range with a needle at the chosen value. */
export const IconLimit = (p: IconProps) => (
  <Glyph {...p}><path d="M4.5 16.5a8 8 0 1 1 15 0" /><path d="M12 12.5 15.4 9" /><circle cx="12" cy="12.7" r="1.15" fill="currentColor" stroke="none" /><path d="M4.5 16.5h2M17.5 16.5h2" /></Glyph>
)

/** Deductible — balance scales: the retained-vs-transferred split. */
export const IconDeductible = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.5v15" /><path d="M6 18.5h12" /><path d="M4.5 7h15" /><path d="M4.5 7 2.6 11.5h3.8zM19.5 7l1.9 4.5h-3.8z" /><path d="M2.6 11.5a1.9 1.9 0 0 0 3.8 0M17.6 11.5a1.9 1.9 0 0 0 3.8 0" /></Glyph>
)

/** State — a map pin over a territory, for geographic availability. */
export const IconStates = (p: IconProps) => (
  <Glyph {...p}><path d="M12 21c4-3.6 6-6.6 6-9.6a6 6 0 1 0-12 0c0 3 2 6 6 9.6Z" /><circle cx="12" cy="11.2" r="2.2" /></Glyph>
)

/** Form — a document with a folded corner + lines of text. */
export const IconForm = (p: IconProps) => (
  <Glyph {...p}><path d="M6.5 2.7h7L18.5 8v13a.8.8 0 0 1-.8.8H6.5a.8.8 0 0 1-.8-.8V3.5a.8.8 0 0 1 .8-.8Z" /><path d="M13 2.9V8h5" /><path d="M9 12.5h6M9 15.7h6M9 18.9h3.5" /></Glyph>
)

/** Pricing — a price tag carrying a currency mark. */
export const IconPricing = (p: IconProps) => (
  <Glyph {...p}><path d="M4 12.4V4.8a.8.8 0 0 1 .8-.8h7.6a.8.8 0 0 1 .57.24l6.5 6.5a1.6 1.6 0 0 1 0 2.26l-6.66 6.66a1.6 1.6 0 0 1-2.26 0l-6.5-6.5A.8.8 0 0 1 4 12.4Z" /><circle cx="8.2" cy="8.2" r="1.15" fill="currentColor" stroke="none" /><path d="M13.6 10.4h-2a1.2 1.2 0 0 0 0 2.4h1.2a1.2 1.2 0 0 1 0 2.4h-2M12.6 9.6v1M12.6 15.6v1" /></Glyph>
)

/** Rule — a decision flow: a node branching into two outcomes. */
export const IconRule = (p: IconProps) => (
  <Glyph {...p}><rect x="9" y="3.4" width="6" height="5" rx="1.2" /><rect x="3.4" y="15.6" width="6" height="5" rx="1.2" /><rect x="14.6" y="15.6" width="6" height="5" rx="1.2" /><path d="M12 8.4v3.1a1.5 1.5 0 0 1-1.5 1.5H7.9a1.5 1.5 0 0 0-1.5 1.5v1.1M12 8.4v3.1a1.5 1.5 0 0 0 1.5 1.5h2.6a1.5 1.5 0 0 1 1.5 1.5v1.1" /></Glyph>
)

/** Endorsement — a document with a plus, for add-on coverages. */
export const IconEndorsement = (p: IconProps) => (
  <Glyph {...p}><path d="M6.5 2.7h7L18.5 8v13a.8.8 0 0 1-.8.8H6.5a.8.8 0 0 1-.8-.8V3.5a.8.8 0 0 1 .8-.8Z" /><path d="M13 2.9V8h5" /><path d="M12 12.6v5M9.5 15.1h5" /></Glyph>
)

// ─── Limit / deductible structure glyphs ─────────────────────────────────────

/** Single limit — one amount covering all loss. */
export const IconSingle = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 10 12 8l2.5 2" /></Glyph>
)

/** Occurrence + aggregate — a per-event layer beneath a term cap. */
export const IconLayers = (p: IconProps) => (
  <Glyph {...p}><path d="m12 3.4 8 4.2-8 4.2-8-4.2z" /><path d="m4 12 8 4.2 8-4.2M4 15.8 12 20l8-4.2" /></Glyph>
)

/** Split limits — a value divided into components (BI/PD). */
export const IconSplit = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.5v17" /><path d="M6.5 8H4.8a.8.8 0 0 0-.8.8v6.4a.8.8 0 0 0 .8.8h1.7M17.5 8h1.7a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8h-1.7" /><path d="M8.5 12H6M18 12h-2.5" /></Glyph>
)

/** Combined single limit — components compressed into one. */
export const IconCombine = (p: IconProps) => (
  <Glyph {...p}><path d="M4 5.5 7.5 9M20 5.5 16.5 9M4 18.5 7.5 15M20 18.5 16.5 15" /><rect x="9" y="9" width="6" height="6" rx="1.4" /></Glyph>
)

/** Scheduled / per-item — an itemised list. */
export const IconScheduled = (p: IconProps) => (
  <Glyph {...p}><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.6" cy="6.5" r="1.15" /><circle cx="4.6" cy="12" r="1.15" /><circle cx="4.6" cy="17.5" r="1.15" /></Glyph>
)

/** Percent — a percentage-based value. */
export const IconPercent = (p: IconProps) => (
  <Glyph {...p}><path d="M6 18 18 6" /><circle cx="7.8" cy="7.8" r="2.3" /><circle cx="16.2" cy="16.2" r="2.3" /></Glyph>
)

/** Waiting period — a time-based deductible. */
export const IconClock = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.2 1.9" /></Glyph>
)

/** Catastrophe / wind-hail — a peril flame. */
export const IconPeril = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.2c2.4 3 3.6 5.2 3.6 7.1 0 1.2-.8 2.2-2 2.4.6-1.4.2-2.9-1-4 .2 2.3-1.2 3.4-2 4.2-1.5 1.5-1.6 3.6-.3 5A5 5 0 0 1 7 12.9c0-3 1.7-6.2 5-9.7Z" /></Glyph>
)

// ─── UI / action glyphs ──────────────────────────────────────────────────────

/** Cards view — a 2×2 tile grid. */
export const IconCards = (p: IconProps) => (
  <Glyph {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></Glyph>
)

/** List view — stacked rows. */
export const IconList = (p: IconProps) => (
  <Glyph {...p}><path d="M8 6.5h12M8 12h12M8 17.5h12" /><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" strokeWidth={2.2} /></Glyph>
)

export const IconPlus = (p: IconProps) => (<Glyph {...p}><path d="M12 5v14M5 12h14" /></Glyph>)
export const IconClose = (p: IconProps) => (<Glyph {...p}><path d="M6 6 18 18M18 6 6 18" /></Glyph>)
export const IconCheck = (p: IconProps) => (<Glyph {...p}><path d="m4.5 12.5 4.5 4.5L19.5 6.5" /></Glyph>)
export const IconChevronRight = (p: IconProps) => (<Glyph {...p}><path d="m9 5 7 7-7 7" /></Glyph>)
export const IconChevronDown = (p: IconProps) => (<Glyph {...p}><path d="m5 9 7 7 7-7" /></Glyph>)
export const IconChevronUp = (p: IconProps) => (<Glyph {...p}><path d="m5 15 7-7 7 7" /></Glyph>)
/** Sort — a double chevron, the neutral (unsorted) column indicator. */
export const IconSort = (p: IconProps) => (<Glyph {...p}><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></Glyph>)
export const IconEdit = (p: IconProps) => (<Glyph {...p}><path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17.2z" /><path d="m14.5 8.5 2.8 2.8" /></Glyph>)
export const IconTrash = (p: IconProps) => (<Glyph {...p}><path d="M4.5 6.5h15M9 6.5V5a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 5v1.5M6.3 6.5l.8 12.6a1.3 1.3 0 0 0 1.3 1.2h7.2a1.3 1.3 0 0 0 1.3-1.2l.8-12.6" /></Glyph>)
export const IconSearch = (p: IconProps) => (<Glyph {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.7-4.7" /></Glyph>)
export const IconFilter = (p: IconProps) => (<Glyph {...p}><path d="M4 5.5h16l-6.2 7.4V19l-3.6 1.6v-7.7z" /></Glyph>)
export const IconDownload = (p: IconProps) => (<Glyph {...p}><path d="M12 3.5v11M8 10.5l4 4 4-4M5 20h14" /></Glyph>)
export const IconDrag = (p: IconProps) => (<Glyph {...p}><path d="M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01" strokeWidth={2.4} /></Glyph>)
export const IconArrowUp = (p: IconProps) => (<Glyph {...p}><path d="M12 20V5M6 11l6-6 6 6" /></Glyph>)
export const IconArrowRight = (p: IconProps) => (<Glyph {...p}><path d="M4 12h15M13 6l6 6-6 6" /></Glyph>)
/** Tasks — a kanban board: two columns of stacked cards. */
export const IconTasks = (p: IconProps) => (<Glyph {...p}><rect x="3.5" y="4" width="7" height="16" rx="1.5" /><rect x="13.5" y="4" width="7" height="10" rx="1.5" /><path d="M6 8h2M17 8h2" /></Glyph>)
export const IconInfo = (p: IconProps) => (<Glyph {...p}><circle cx="12" cy="12" r="8.4" /><path d="M12 11v5.2" /><circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none" /></Glyph>)
export const IconBack = (p: IconProps) => (<Glyph {...p}><path d="M15 5 8 12l7 7" /></Glyph>)
export const IconExpand = (p: IconProps) => (<Glyph {...p}><path d="M9 4H5v4M15 4h4v4M9 20H5v-4M15 20h4v-4" /></Glyph>)
export const IconRefresh = (p: IconProps) => (<Glyph {...p}><path d="M4.6 12a7.4 7.4 0 0 1 12.6-5.2L20 9.4" /><path d="M20 4v5.5h-5.5" /><path d="M19.4 12a7.4 7.4 0 0 1-12.6 5.2L4 14.6" /><path d="M4 20v-5.5h5.5" /></Glyph>)
export const IconTable = (p: IconProps) => (<Glyph {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.6" /><path d="M3.5 9.6h17M9.2 9.6V19.5" /></Glyph>)
/** Spinner — a partial ring; pair with `animate-spin` for loading affordances. */
export const IconSpinner = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.5" opacity=".22" /><path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" /></Glyph>
)

/** Star — the default-option marker (fills when active via CSS `fill-current`). */
export const IconStar = (p: IconProps) => (
  <Glyph {...p}><path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 22.7l-5.2-2.75 1-5.8-4.2-4.1 5.8-.85z" /></Glyph>
)

/** Sparkle — the AI affordance, a four-point star with a companion twinkle. */
export const IconSparkle = (p: IconProps) => (
  <Glyph {...p}><path d="M12 3.5c.5 3.4 1.6 4.5 5 5-3.4.5-4.5 1.6-5 5-.5-3.4-1.6-4.5-5-5 3.4-.5 4.5-1.6 5-5Z" /><path d="M18.5 14c.25 1.5.75 2 2.2 2.2-1.45.25-1.95.75-2.2 2.2-.25-1.45-.75-1.95-2.2-2.2 1.45-.2 1.95-.7 2.2-2.2Z" /></Glyph>
)

/** Chat — a speech bubble, for the conversational surface. */
export const IconChat = (p: IconProps) => (
  <Glyph {...p}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.4V16H6.5A2.5 2.5 0 0 1 4 13.5z" /><path d="M8.5 9.5h7M8.5 12.5h4" /></Glyph>
)

// ─── Navigation / shell glyphs ────────────────────────────────────────────────

/** Home — a house; the workspace landing. */
export const IconHome = (p: IconProps) => (
  <Glyph {...p}><path d="M4 11 12 4l8 7" /><path d="M6 9.6V19a.8.8 0 0 0 .8.8h10.4a.8.8 0 0 0 .8-.8V9.6" /><path d="M9.8 20.8V14.6h4.4v6.2" /></Glyph>
)
/** Explorer — a compass, for browsing the hierarchy. */
export const IconExplorer = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.5" /><path d="m15.2 8.8-2.4 4-4 2.4 2.4-4z" /></Glyph>
)
/** News — a newspaper with a folded side column. */
export const IconNews = (p: IconProps) => (
  <Glyph {...p}><path d="M4 6h11.5v12.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M15.5 9H19a.5.5 0 0 1 .5.5v9a1.5 1.5 0 0 1-1.5 1.5" /><path d="M6.8 9.2h6M6.8 12.2h6M6.8 15.2h3.6" /></Glyph>
)
/** Chart — grouped bars, for analytics. */
export const IconChart = (p: IconProps) => (
  <Glyph {...p}><path d="M4 4v15.2a.8.8 0 0 0 .8.8H20" /><rect x="6.6" y="12" width="3" height="5" rx="1" /><rect x="11.2" y="8.4" width="3" height="8.6" rx="1" /><rect x="15.8" y="10.6" width="3" height="6.4" rx="1" /></Glyph>
)
/** Book — an open book, for the data dictionary. */
export const IconBook = (p: IconProps) => (
  <Glyph {...p}><path d="M12 6.2C10.3 4.9 7.8 4.4 4.8 5v12.6c3-.6 5.5-.1 7.2 1.2" /><path d="M12 6.2c1.7-1.3 4.2-1.8 7.2-1.2v12.6c-3-.6-5.5-.1-7.2 1.2" /><path d="M12 6.2v12.6" /></Glyph>
)
/** Settings — sliders. */
export const IconSettings = (p: IconProps) => (
  <Glyph {...p}><path d="M4 8h8M17 8h3M4 16h3M12 16h8" /><circle cx="14.5" cy="8" r="2.3" /><circle cx="9.5" cy="16" r="2.3" /></Glyph>
)
/** Sign-out — a door with an out-arrow. */
export const IconSignOut = (p: IconProps) => (
  <Glyph {...p}><path d="M14 5.5H6.8A1.8 1.8 0 0 0 5 7.3v9.4a1.8 1.8 0 0 0 1.8 1.8H14" /><path d="M11 12h9M17 8.5l3.5 3.5L17 15.5" /></Glyph>
)
/** User — head and shoulders. */
export const IconUser = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="8.5" r="3.7" /><path d="M5 19.5c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></Glyph>
)
/** Key — for the temporary-password affordance. */
export const IconKey = (p: IconProps) => (
  <Glyph {...p}><circle cx="8.5" cy="8.5" r="3.8" /><path d="m11.2 11.2 7.3 7.3M15.6 15.6l2-2M17.6 13.6l1.6 1.6" /></Glyph>
)
export const IconChevronLeft = (p: IconProps) => (<Glyph {...p}><path d="m15 5-7 7 7 7" /></Glyph>)
/** Clock — recents / waiting. */
export const IconRecent = (p: IconProps) => (
  <Glyph {...p}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.2 1.9" /></Glyph>
)

// ─── Feedback glyphs ──────────────────────────────────────────────────────────

/** Idea — a lightbulb. */
export const IconIdea = (p: IconProps) => (
  <Glyph {...p}><path d="M9 16.3a5 5 0 1 1 6 0 2 2 0 0 0-.8 1.6v.6H9.8v-.6A2 2 0 0 0 9 16.3Z" /><path d="M9.8 20.6h4.4" /></Glyph>
)
/** Issue — a bug. */
export const IconBug = (p: IconProps) => (
  <Glyph {...p}><rect x="8" y="8" width="8" height="10" rx="4" /><path d="M9.6 6.4 8.3 5M14.4 6.4 15.7 5M8 11H4.6M16 11h3.4M8 15H4.6M16 15h3.4M12 8.2v9.6" /></Glyph>
)
/** Praise — a heart. */
export const IconHeart = (p: IconProps) => (
  <Glyph {...p}><path d="M12 20.3S3.6 15 3.6 9A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.4 2c0 6-8.4 11.3-8.4 11.3Z" /></Glyph>
)
/** Link — a chain, for attached context. */
export const IconLink = (p: IconProps) => (
  <Glyph {...p}><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.6 1.6" /><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.6-1.6" /></Glyph>
)
/** Activity — a heartbeat line, for health / readiness. */
export const IconActivity = (p: IconProps) => (
  <Glyph {...p}><path d="M3 12h3.5l2-6 4 13 2.5-7H21" /></Glyph>
)
/** Clipboard-check — reviews awaiting action. */
export const IconClipboard = (p: IconProps) => (
  <Glyph {...p}><path d="M8.5 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-2" /><rect x="8.5" y="2.9" width="7" height="3.6" rx="1.2" /><path d="m9.2 13.5 2 2 3.8-4" /></Glyph>
)
