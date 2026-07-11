// HomeCheck — consumer-facing, guest-accessible home risk check.
// Route: /home-check (outside AppShell, no auth required).
// Zero access to B2B portfolio data. All AI/external data via /api/homecheck/v1.
import { useState, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  evaluate,
  PH_RATING_PROGRAM,
  PH_LD_TABLES,
  PH_RT_TABLES,
  PH_WORKED_EXAMPLE,
  makePHRtGetter,
  makePHLdGetter,
} from '@pf/shared'
import type { RatingInputs } from '@pf/shared'
import {
  IconSearch, IconDownload, IconCamera, IconSpinner,
  IconInfo, IconTrash, IconRefresh, IconHome,
  IconChevronDown, IconChevronRight, IconArrowRight,
} from '../components/ui/icons'

const API = import.meta.env['VITE_API_BASE'] || ''
const HC  = `${API}/api/homecheck/v1`

// ─── Types ───────────────────────────────────────────────────────────────────

interface HazardRating { rating: string | null; score: number | null }
interface NriData {
  composite: { score: number | null; rating: string | null }
  hazards: {
    earthquake:       HazardRating
    hail:             HazardRating
    hurricane:        HazardRating
    riverineFlood:    HazardRating
    coastalFlood:     HazardRating
    strongWind:       HazardRating
    tornado:          HazardRating
    wildfire:         HazardRating
    lightning:        HazardRating
    coldWave:         HazardRating
    heatWave:         HazardRating
    iceStorm:         HazardRating
    winterWeather:    HazardRating
  }
  source:      string
  attribution: string
  dataUrl:     string
}
interface RiskPayload {
  requestId:   string
  address:     string
  geocode:     { lat: number; lon: number; tractFips: string; stateAbbr: string; countyName: string; matchedAddress: string; attribution: string }
  nri:         NriData | null
  flood:       { zone: string; sfha: boolean; description: string; attribution: string; note: string } | null
  earthquake:  { recentEvents: { magnitude: number; place: string; time: string }[]; pga2pct50yr: number | null; attribution: string } | null
  wildfire:    { label: string; attribution: string; note: string; wildfirerisk: string } | null
  noaa:        { alerts: { event: string; headline: string; severity: string; expires: string }[]; forecastOffice: string | null; attribution: string } | null
  openfema:    { recentDeclarations: { number: number; title: string; date: string; type: string }[]; attribution: string } | null
  firstStreet: { licensed: boolean; wired: boolean; note: string; learnMore: string }
  citations:   string[]
  disclaimer:  string
  generatedAt: string
}
interface InventoryItem {
  name:               string
  category:           string
  brand:              string | null
  model:              string | null
  condition:          string
  estimatedValueUSD:  number
  notes:              string | null
  confidence:         string
  photoName:          string
}
interface InventorySession {
  sessionId:           string
  itemCount:           number
  items:               InventoryItem[]
  address:             string | null
  expiresAt:           string
  processedCount:      { photos: number; items: number; errors: number }
  totalEstimatedValue: number
  retention:           string
}

// ─── Rating helpers for what-if sliders ──────────────────────────────────────

const PH_RT_GETTER = makePHRtGetter(PH_RT_TABLES)
const PH_LD_GETTER = makePHLdGetter(PH_LD_TABLES)

const DEFAULT_INPUTS: Partial<RatingInputs> = {
  ...PH_WORKED_EXAMPLE,
  allPerilDed:    1000,
  deviceCredit:   'none',
  waterBackupElected: false,
  rcElected:      true,
}

function runPremium(overrides: Partial<RatingInputs>): number {
  const inputs = { ...(DEFAULT_INPUTS as RatingInputs), ...overrides }
  try {
    const result = evaluate(PH_RATING_PROGRAM as Parameters<typeof evaluate>[0], inputs as Parameters<typeof evaluate>[1], PH_RT_GETTER, PH_LD_GETTER)
    return result.finalPremium ?? 0
  } catch { return 0 }
}

// ─── Risk rating helpers ─────────────────────────────────────────────────────

const RATING_COLOR: Record<string, string> = {
  'Very Low':            'var(--color-good)',
  'Relatively Low':      'var(--color-good)',
  'Relatively Moderate': 'var(--color-warn)',
  'Relatively High':     '#DC6803',
  'Very High':           'var(--color-danger)',
}
const RATING_BG: Record<string, string> = {
  'Very Low':            'var(--color-good-soft)',
  'Relatively Low':      'var(--color-good-soft)',
  'Relatively Moderate': 'var(--color-warn-badge)',
  'Relatively High':     'rgba(220,104,3,.12)',
  'Very High':           'var(--color-danger-badge)',
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span style={{ color: 'var(--color-faint)', fontSize: 12 }}>N/A</span>
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, lineHeight: 1.6,
      color: RATING_COLOR[rating] || 'var(--color-dim)',
      background: RATING_BG[rating] || 'var(--color-raised)',
    }}>
      {rating}
    </span>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ExpandCard({ title, children, defaultOpen = false, badge }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: 'var(--color-surface)', borderRadius: 14, marginBottom: 16, border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '18px 24px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {title} {badge}
        </span>
        {open ? <IconChevronDown className="w-4 h-4 text-dim" /> : <IconChevronRight className="w-4 h-4 text-dim" />}
      </button>
      {open && <div style={{ padding: '0 24px 20px' }}>{children}</div>}
    </div>
  )
}

function CitationBadge({ text }: { text: string }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--color-faint)', marginTop: 12, lineHeight: 1.5, fontStyle: 'italic' }}>
      <span style={{ color: 'var(--color-accent)', fontStyle: 'normal', fontWeight: 600 }}>Citation: </span>{text}
    </p>
  )
}

function FloodZoneCard({ flood }: { flood: NonNullable<RiskPayload['flood']> }) {
  const sfhaColor = flood.sfha ? 'var(--color-danger)' : 'var(--color-good)'
  const sfhaBg    = flood.sfha ? 'var(--color-danger-badge)' : 'var(--color-good-soft)'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', letterSpacing: '.02em' }}>
          Zone {flood.zone}
        </span>
        <span style={{ padding: '3px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: sfhaColor, background: sfhaBg }}>
          {flood.sfha ? 'SFHA — High Risk' : 'Outside SFHA'}
        </span>
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.6 }}>{flood.description}</p>
      {flood.sfha && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--color-danger-badge)', borderRadius: 8, border: '1px solid var(--color-danger-line)', fontSize: 13 }}>
          <strong style={{ color: 'var(--color-danger)' }}>Federal flood insurance may be required</strong>
          <span style={{ color: 'var(--color-dim)' }}> — properties in SFHAs with a federally-backed mortgage must carry NFIP or equivalent coverage. Contact your insurer or agent.</span>
        </div>
      )}
      <p style={{ marginTop: 10, fontSize: 12, color: 'var(--color-faint)', fontStyle: 'italic' }}>{flood.note}</p>
      <CitationBadge text={flood.attribution} />
    </div>
  )
}

function HazardTable({ nri }: { nri: NriData }) {
  const HAZARDS: [string, keyof NriData['hazards']][] = [
    ['Earthquake',        'earthquake'],
    ['Hurricane',         'hurricane'],
    ['Riverine Flooding', 'riverineFlood'],
    ['Coastal Flooding',  'coastalFlood'],
    ['Wildfire',          'wildfire'],
    ['Tornado',           'tornado'],
    ['Hail',              'hail'],
    ['Strong Wind',       'strongWind'],
    ['Lightning',         'lightning'],
    ['Winter Weather',    'winterWeather'],
    ['Heat Wave',         'heatWave'],
    ['Ice Storm',         'iceStorm'],
  ]
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-.03em', background: 'var(--gradient-accent-text)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {nri.composite.score?.toFixed(1) ?? 'N/A'}
        </span>
        <RatingBadge rating={nri.composite.rating} />
        <span style={{ fontSize: 13, color: 'var(--color-dim)' }}>composite risk index (0–100 percentile)</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {HAZARDS.map(([label, key]) => {
          const h = nri.hazards[key]
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: 14, color: 'var(--color-text)' }}>{label}</span>
              <RatingBadge rating={h?.rating ?? null} />
            </div>
          )
        })}
      </div>
      <CitationBadge text={nri.attribution} />
    </div>
  )
}

// ─── What-If Premium Panel ────────────────────────────────────────────────────

type WhatIfInputs = { allPerilDed: number; deviceCredit: string; rcElected: boolean; waterBackupElected: boolean }

function WhatIfPanel() {
  const [inputs, setInputs] = useState<WhatIfInputs>({
    allPerilDed:          1000,
    deviceCredit:         'none',
    rcElected:            true,
    waterBackupElected:   false,
  })
  const basePremium = useMemo(() => runPremium({ allPerilDed: 1000, deviceCredit: 'none', rcElected: true, waterBackupElected: false }), [])
  const premium     = useMemo(() => runPremium(inputs), [inputs])
  const delta       = premium - basePremium
  const deltaSign   = delta > 0 ? '+' : delta < 0 ? '' : '±'
  const deltaColor  = delta > 0 ? 'var(--color-warn)' : delta < 0 ? 'var(--color-good)' : 'var(--color-dim)'

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-dim)', marginBottom: 16, lineHeight: 1.5 }}>
        Adjust the sliders to see how property characteristics affect an indicative HO-3 annual premium.
        This uses the actual platform rating engine with illustrative ISO-style factors.
        <strong style={{ color: 'var(--color-text)' }}> This is not a quote.</strong>
      </p>

      <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>

        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', display: 'block', marginBottom: 6 }}>
            All-Peril Deductible
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([500, 1000, 2500, 5000] as const).map(d => (
              <button key={d} onClick={() => setInputs(i => ({ ...i, allPerilDed: d }))}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: `1.5px solid ${inputs.allPerilDed === d ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: inputs.allPerilDed === d ? 'var(--color-accent-soft)' : 'var(--color-raised)',
                  color: inputs.allPerilDed === d ? 'var(--color-accent)' : 'var(--color-text)',
                  transition: 'all var(--duration-fast) var(--ease-spring)',
                }}>
                ${d.toLocaleString()}
              </button>
            ))}
          </div>
        </label>

        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', display: 'block', marginBottom: 6 }}>
            Alarm / Protective Devices
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['none', 'None'], ['local', 'Local Alarm'], ['monitored_central', 'Monitored Central']] as [string, string][]).map(([val, label]) => (
              <button key={val} onClick={() => setInputs(i => ({ ...i, deviceCredit: val }))}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: `1.5px solid ${inputs.deviceCredit === val ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: inputs.deviceCredit === val ? 'var(--color-accent-soft)' : 'var(--color-raised)',
                  color: inputs.deviceCredit === val ? 'var(--color-accent)' : 'var(--color-text)',
                  transition: 'all var(--duration-fast) var(--ease-spring)',
                }}>
                {label}
              </button>
            ))}
          </div>
        </label>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={inputs.rcElected}
              onChange={e => setInputs(i => ({ ...i, rcElected: e.target.checked }))}
              style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
            <span style={{ fontSize: 13, color: 'var(--color-text)' }}>Replacement Cost endorsement</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={inputs.waterBackupElected}
              onChange={e => setInputs(i => ({ ...i, waterBackupElected: e.target.checked }))}
              style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
            <span style={{ fontSize: 13, color: 'var(--color-text)' }}>Water Backup endorsement</span>
          </label>
        </div>
      </div>

      <div style={{ background: 'var(--color-raised)', borderRadius: 12, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p style={{ fontSize: 12, color: 'var(--color-dim)', marginBottom: 2 }}>Indicative Annual Premium</p>
          <p style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--color-text)' }}>
            ${premium.toLocaleString()}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 12, color: 'var(--color-dim)', marginBottom: 2 }}>vs. $1,000 ded baseline</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: deltaColor }}>
            {deltaSign}${Math.abs(delta).toLocaleString()} ({deltaSign}{((delta / basePremium) * 100).toFixed(1)}%)
          </p>
        </div>
      </div>

      <p style={{ marginTop: 10, fontSize: 12, color: 'var(--color-faint)', lineHeight: 1.5 }}>
        Source: Illustrative ISO-style HO-3 rating tables (PH.RAT.1, territory T002, frame construction, $400k Coverage A). Actual premiums vary by insurer, state, property characteristics, and underwriting guidelines. Not a quote or offer of insurance.
      </p>
    </div>
  )
}

// ─── Photo Upload / Inventory Panel ──────────────────────────────────────────

function PhotoInventoryPanel({ address }: { address: string | null }) {
  const [consent, setConsent]               = useState(false)
  const [uploading, setUploading]           = useState(false)
  const [session, setSession]               = useState<InventorySession | null>(null)
  const [prevSession, setPrevSession]       = useState<InventorySession | null>(null)
  const [diffResult, setDiffResult]         = useState<Record<string, unknown> | null>(null)
  const [error, setError]                   = useState<string | null>(null)
  const fileRef                             = useRef<HTMLInputElement>(null)

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload  = () => resolve(r.result as string)
      r.onerror = reject
      r.readAsDataURL(file)
    })

  const handleFiles = useCallback(async (files: FileList) => {
    if (!consent) { setError('Please accept the consent notice before uploading photos.'); return }
    setError(null)
    const photos: { name: string; dataUrl: string }[] = []
    const selected = Array.from(files).slice(0, 10)
    for (const f of selected) {
      if (!f.type.startsWith('image/')) continue
      const dataUrl = await readAsDataUrl(f)
      photos.push({ name: f.name, dataUrl })
    }
    if (!photos.length) { setError('No valid image files selected.'); return }

    setUploading(true)
    try {
      const resp = await fetch(`${HC}/inventory`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ photos, consent: true, address }),
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({})) as Record<string, string>
        throw new Error(j['detail'] || `Server error ${resp.status}`)
      }
      const data = await resp.json() as InventorySession
      if (session) setPrevSession(session)
      setSession(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [consent, address, session])

  const handleDelete = useCallback(async () => {
    if (!session) return
    await fetch(`${HC}/inventory/${session.sessionId}`, { method: 'DELETE' })
    setSession(null)
    setPrevSession(null)
    setDiffResult(null)
  }, [session])

  const handleDiff = useCallback(async () => {
    if (!session || !prevSession) return
    const resp = await fetch(`${HC}/twin-diff`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: session.sessionId, prevSessionId: prevSession.sessionId }),
    })
    if (resp.ok) setDiffResult(await resp.json())
  }, [session, prevSession])

  const exportUrl = session ? `${HC}/inventory/${session.sessionId}/export` : null

  return (
    <div>
      {/* Consent gate */}
      {!consent && (
        <div style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>Photo Processing Consent</p>
          <p style={{ fontSize: 13, color: 'var(--color-dim)', lineHeight: 1.6, marginBottom: 14 }}>
            Your photos are sent to our server and processed by AI (GPT-5.1 via Azure AI Foundry) to extract a home inventory.
            Photos are <strong>not stored to any database</strong> — only the extracted item list is saved for 24 hours in server memory.
            You can delete your session at any time. Photos are not shared with third parties or used to train AI models.
            <a href="/home-check#privacy" style={{ color: 'var(--color-accent)', marginLeft: 4 }}>Full privacy policy</a>.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--color-accent)' }}
              aria-label="I consent to photo processing" />
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
              I understand and consent to photo processing
            </span>
          </label>
        </div>
      )}

      {/* Upload area */}
      {consent && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload photos of your home interior"
          onClick={() => fileRef.current?.click()}
          onKeyDown={e => e.key === 'Enter' || e.key === ' ' ? fileRef.current?.click() : undefined}
          style={{
            border: `2px dashed var(--color-accent-line)`,
            borderRadius: 12, padding: '32px 24px', textAlign: 'center', cursor: 'pointer',
            background: 'var(--color-accent-soft)',
            transition: 'all var(--duration-fast) var(--ease-spring)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,31,224,.12)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent-soft)' }}
        >
          {uploading
            ? <><IconSpinner className="w-8 h-8 mx-auto" style={{ color: 'var(--color-accent)' }} /><p style={{ marginTop: 10, color: 'var(--color-accent)', fontWeight: 500 }}>Analyzing photos with AI…</p></>
            : <>
              <IconCamera className="w-8 h-8 mx-auto" style={{ color: 'var(--color-accent)', opacity: .7 }} />
              <p style={{ marginTop: 10, fontWeight: 600, color: 'var(--color-text)' }}>Upload or capture photos</p>
              <p style={{ fontSize: 13, color: 'var(--color-dim)', marginTop: 4 }}>Up to 10 photos · JPEG, PNG, WEBP</p>
              <p style={{ fontSize: 12, color: 'var(--color-faint)', marginTop: 6 }}>On mobile, tap to use your camera</p>
            </>
          }
          <input ref={fileRef} type="file" multiple accept="image/*" capture="environment"
            aria-label="Select photo files"
            style={{ display: 'none' }}
            onChange={e => e.target.files && handleFiles(e.target.files)} />
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 12, padding: '10px 14px', background: 'var(--color-danger-badge)', border: '1px solid var(--color-danger-line)', borderRadius: 8, fontSize: 13, color: 'var(--color-danger)' }}>
          {error}
        </div>
      )}

      {/* Session results */}
      {session && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text)' }}>
                Inventory — {session.itemCount} items identified
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-dim)', marginTop: 2 }}>
                Est. total replacement value: <strong style={{ color: 'var(--color-accent)' }}>${session.totalEstimatedValue.toLocaleString()}</strong>
                {' · '}Expires {session.expiresAt.slice(0, 10)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {exportUrl && (
                <a href={exportUrl} download target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--gradient-accent)', color: 'var(--color-on-accent)', borderRadius: 9, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  <IconDownload className="w-4 h-4" />Export proof
                </a>
              )}
              <button onClick={handleDelete} aria-label="Delete this session and all extracted data"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--color-danger-hover)', color: 'var(--color-danger)', borderRadius: 9, fontSize: 13, fontWeight: 500, border: '1px solid var(--color-danger-line)', cursor: 'pointer' }}>
                <IconTrash className="w-4 h-4" />Delete
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {session.items.map((item, i) => (
              <div key={i} style={{ background: 'var(--color-raised)', borderRadius: 10, padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>{item.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--color-dim)', marginTop: 2 }}>
                    {item.category}{item.brand ? ` · ${item.brand}` : ''}{item.model ? ` ${item.model}` : ''}
                    {' · '}Condition: {item.condition}
                    {item.notes ? ` · ${item.notes}` : ''}
                    {' · '}Confidence: {item.confidence}
                  </p>
                </div>
                <p style={{ fontWeight: 700, color: 'var(--color-accent)', fontSize: 14, flexShrink: 0 }}>
                  ${item.estimatedValueUSD.toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-faint)', lineHeight: 1.5 }}>
            {session.retention}
          </p>

          {/* Re-photograph / twin diff */}
          {prevSession && (
            <div style={{ marginTop: 16, padding: '14px 18px', background: 'var(--color-info-soft)', border: '1px solid rgba(37,99,235,.15)', borderRadius: 10 }}>
              <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-info)', marginBottom: 6 }}>
                Digital twin diff available
              </p>
              <p style={{ fontSize: 13, color: 'var(--color-dim)', marginBottom: 10 }}>
                You have a previous session. Compare the two to surface added, removed, or changed items.
              </p>
              <button onClick={handleDiff}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--color-info)', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                <IconRefresh className="w-4 h-4" />Compare sessions
              </button>
            </div>
          )}

          {diffResult && (() => {
            const d = (diffResult as Record<string, Record<string, unknown>>)['diff']
            if (!d) return null
            const added   = (d['added']   as InventoryItem[]) || []
            const removed = (d['removed'] as InventoryItem[]) || []
            const changed = (d['changed'] as { old: InventoryItem; new: InventoryItem }[]) || []
            const summary = (diffResult as Record<string, Record<string, number>>)['summary']
            return (
              <div style={{ marginTop: 16, border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: 'var(--color-surface)', padding: '14px 18px', borderBottom: '1px solid var(--color-border)' }}>
                  <p style={{ fontWeight: 600, fontSize: 15 }}>Digital Twin Diff</p>
                  <p style={{ fontSize: 13, color: 'var(--color-dim)', marginTop: 2 }}>
                    +{summary?.['addedValue']?.toLocaleString() || 0} added · -{summary?.['removedValue']?.toLocaleString() || 0} removed · {summary?.['changedCount'] || 0} condition changes
                  </p>
                </div>
                <div style={{ padding: '14px 18px', background: 'var(--color-raised)' }}>
                  {added.length > 0 && <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-good)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Added ({added.length})</p>
                    {added.map((it, i) => <p key={i} style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 4 }}>+ {it.name} — ${it.estimatedValueUSD.toLocaleString()}</p>)}
                  </div>}
                  {removed.length > 0 && <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Removed ({removed.length})</p>
                    {removed.map((it, i) => <p key={i} style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 4 }}>− {it.name} — ${it.estimatedValueUSD.toLocaleString()}</p>)}
                  </div>}
                  {changed.length > 0 && <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warn)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Condition Changed ({changed.length})</p>
                    {changed.map((c, i) => <p key={i} style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 4 }}>↔ {c.new.name}: {c.old.condition} → {c.new.condition}</p>)}
                  </div>}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ─── Main HomeCheck page ──────────────────────────────────────────────────────

export default function HomeCheck() {
  const [address, setAddress]       = useState('')
  const [loading, setLoading]       = useState(false)
  const [risk, setRisk]             = useState<RiskPayload | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [reportLoading, setReportLoading] = useState(false)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const q = address.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setRisk(null)
    try {
      const resp = await fetch(`${HC}/risk`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ address: q }),
      })
      const json = await resp.json() as RiskPayload & { error?: string; detail?: string }
      if (!resp.ok) throw new Error(json['detail'] || json['error'] || `Error ${resp.status}`)
      setRisk(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [address])

  const handleDownloadReport = useCallback(async () => {
    if (!risk) return
    setReportLoading(true)
    try {
      const resp = await fetch(`${HC}/report-html`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(risk),
      })
      if (!resp.ok) throw new Error(`${resp.status}`)
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `home-risk-report-${risk.address.replace(/[^a-z0-9]+/gi,'_').slice(0,40)}.html`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* non-fatal */ }
    finally { setReportLoading(false) }
  }, [risk])

  const activeAlerts = risk?.noaa?.alerts?.length ?? 0

  return (
    <div style={{ minHeight: '100svh', background: 'var(--color-page)', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', position: 'sticky', top: 0, zIndex: 40, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
        <div style={{ maxWidth: 840, margin: '0 auto', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 28, height: 28, background: 'var(--gradient-accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconHome className="w-4 h-4" style={{ color: '#fff' }} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-text)', letterSpacing: '-.014em' }}>HomeCheck</span>
          </div>
          <Link to="/" style={{ fontSize: 13, color: 'var(--color-dim)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            Product Hub <IconArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </nav>

      <main style={{ flex: 1, maxWidth: 840, margin: '0 auto', width: '100%', padding: '0 20px 80px' }}>

        {/* Hero */}
        <div style={{ paddingTop: 56, paddingBottom: 40, textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)', borderRadius: 999, marginBottom: 16 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent)', letterSpacing: '.04em' }}>CONSUMER PREVIEW</span>
          </div>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 800, letterSpacing: '-.022em', lineHeight: 1.18, marginBottom: 14, color: 'var(--color-text)' }}>
            Know your home's risk<br />
            <span style={{ background: 'var(--gradient-accent-text)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>before a claim</span>
          </h1>
          <p style={{ fontSize: 16, color: 'var(--color-dim)', lineHeight: 1.6, maxWidth: 560, margin: '0 auto 32px' }}>
            Enter your address to get a free risk report powered by FEMA, USGS, NOAA, and USDA open data.
            Photograph your home to create a proof-of-condition digital inventory.
          </p>

          {/* Address form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, maxWidth: 600, margin: '0 auto' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <label htmlFor="hc-address" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                Property address
              </label>
              <input
                id="hc-address"
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="123 Main St, Springfield, IL 62701"
                autoComplete="street-address"
                required
                aria-label="Property address"
                style={{
                  width: '100%', padding: '12px 16px', fontSize: 15, borderRadius: 10,
                  border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                  color: 'var(--color-text)', outline: 'none',
                  transition: 'border-color var(--duration-fast) var(--ease-spring)',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--color-accent)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--color-border)' }}
              />
            </div>
            <button type="submit" disabled={loading || !address.trim()}
              aria-label="Analyze address risk"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '12px 20px',
                background: loading ? 'var(--color-raised)' : 'var(--gradient-accent)',
                color: loading ? 'var(--color-dim)' : 'var(--color-on-accent)',
                border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all var(--duration-fast) var(--ease-spring)', flexShrink: 0,
              }}>
              {loading ? <IconSpinner className="w-4 h-4" /> : <IconSearch className="w-4 h-4" />}
              {loading ? 'Analyzing…' : 'Check Risk'}
            </button>
          </form>
        </div>

        {/* Error */}
        {error && (
          <div role="alert" style={{ marginBottom: 24, padding: '14px 18px', background: 'var(--color-danger-badge)', border: '1px solid var(--color-danger-line)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <IconInfo className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-danger)' }} />
            <div>
              <p style={{ fontWeight: 600, color: 'var(--color-danger)', fontSize: 14 }}>Could not retrieve risk data</p>
              <p style={{ color: 'var(--color-dim)', fontSize: 13, marginTop: 2 }}>{error}</p>
            </div>
          </div>
        )}

        {/* Active alerts banner */}
        {risk && activeAlerts > 0 && (
          <div role="alert" style={{ marginBottom: 20, padding: '12px 18px', background: 'var(--color-danger-badge)', border: '1px solid var(--color-danger-line)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', width: 8, height: 8, borderRadius: '50%', background: 'var(--color-danger)', animation: 'ring-glow 1.5s ease-out infinite' }} />
            <strong style={{ color: 'var(--color-danger)', fontSize: 14 }}>
              {activeAlerts} active weather alert{activeAlerts > 1 ? 's' : ''} for this location
            </strong>
          </div>
        )}

        {/* Risk report sections */}
        {risk && (
          <div className="rise-in" style={{ '--rise-delay': '0ms' } as React.CSSProperties}>

            {/* Matched address + download button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text)' }}>{risk.address}</p>
                <p style={{ fontSize: 12, color: 'var(--color-dim)', marginTop: 2 }}>
                  Tract {risk.geocode.tractFips} · {risk.geocode.stateAbbr} · {risk.geocode.countyName}
                </p>
              </div>
              <button onClick={handleDownloadReport} disabled={reportLoading}
                aria-label="Download risk report as HTML"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--color-raised)', border: '1px solid var(--color-border)', borderRadius: 9, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', cursor: reportLoading ? 'not-allowed' : 'pointer' }}>
                {reportLoading ? <IconSpinner className="w-4 h-4" /> : <IconDownload className="w-4 h-4" />}
                Save report
              </button>
            </div>

            {/* NRI Hazard scores */}
            {risk.nri && (
              <ExpandCard title="FEMA National Risk Index — 18 Hazards" defaultOpen badge={<RatingBadge rating={risk.nri.composite.rating} />}>
                <HazardTable nri={risk.nri} />
              </ExpandCard>
            )}

            {/* Flood Zone */}
            {risk.flood && (
              <ExpandCard title="FEMA Flood Hazard Zone" defaultOpen badge={
                <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: risk.flood.sfha ? 'var(--color-danger-badge)' : 'var(--color-good-soft)', color: risk.flood.sfha ? 'var(--color-danger)' : 'var(--color-good)', fontFamily: 'var(--font-mono)' }}>
                  Zone {risk.flood.zone}
                </span>
              }>
                <FloodZoneCard flood={risk.flood} />
              </ExpandCard>
            )}

            {/* Wildfire */}
            {risk.wildfire && (
              <ExpandCard title="Wildfire Hazard Potential (USDA Forest Service)">
                <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>{risk.wildfire.label}</p>
                <p style={{ fontSize: 14, color: 'var(--color-dim)', lineHeight: 1.6, marginBottom: 8 }}>{risk.wildfire.note}</p>
                <p style={{ fontSize: 13, color: 'var(--color-dim)' }}>
                  Also see: <a href={risk.wildfire.wildfirerisk} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>wildfirerisk.org</a> for community-level wildfire risk.
                </p>
                <CitationBadge text={risk.wildfire.attribution} />
              </ExpandCard>
            )}

            {/* Earthquake */}
            {risk.earthquake && (
              <ExpandCard title="Earthquake Hazard (USGS)">
                {risk.earthquake.pga2pct50yr !== null && (
                  <p style={{ marginBottom: 12, fontSize: 14 }}>
                    Peak Ground Acceleration (2% / 50 yr): <strong style={{ color: 'var(--color-accent)' }}>{risk.earthquake.pga2pct50yr.toFixed(4)}g</strong>
                    <span style={{ color: 'var(--color-dim)', marginLeft: 6 }}>Site Class D</span>
                  </p>
                )}
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  Recent Events (M≥2.5, 200 km)
                </p>
                {risk.earthquake.recentEvents.length === 0
                  ? <p style={{ fontSize: 14, color: 'var(--color-dim)' }}>No significant recent seismic activity within 200 km.</p>
                  : risk.earthquake.recentEvents.map((e, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: 14 }}>
                      <strong style={{ color: 'var(--color-accent)', minWidth: 48 }}>M{e.magnitude}</strong>
                      <span>{e.place}</span>
                      <span style={{ color: 'var(--color-dim)', marginLeft: 'auto', flexShrink: 0 }}>{e.time}</span>
                    </div>
                  ))
                }
                <CitationBadge text={risk.earthquake.attribution} />
              </ExpandCard>
            )}

            {/* NOAA Weather Alerts */}
            {risk.noaa && (
              <ExpandCard title="Active Weather Alerts (NOAA/NWS)" defaultOpen={activeAlerts > 0} badge={activeAlerts > 0 ? <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'var(--color-danger-badge)', color: 'var(--color-danger)' }}>{activeAlerts} active</span> : undefined}>
                {risk.noaa.alerts.length === 0
                  ? <p style={{ color: 'var(--color-dim)', fontSize: 14 }}>No active weather alerts at this time.</p>
                  : risk.noaa.alerts.map((a, i) => (
                    <div key={i} style={{ background: 'var(--color-danger-badge)', border: '1px solid var(--color-danger-line)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                      <p style={{ fontWeight: 600, color: 'var(--color-danger)', marginBottom: 4 }}>{a.event}</p>
                      <p style={{ fontSize: 14, color: 'var(--color-text)', marginBottom: 6 }}>{a.headline}</p>
                      <p style={{ fontSize: 12, color: 'var(--color-dim)' }}>Severity: {a.severity} · Expires: {a.expires?.replace('T',' ').slice(0,16)}</p>
                    </div>
                  ))
                }
                <CitationBadge text={risk.noaa.attribution} />
              </ExpandCard>
            )}

            {/* OpenFEMA Declarations */}
            {risk.openfema && (
              <ExpandCard title="Recent Federal Disaster Declarations (OpenFEMA)">
                {risk.openfema.recentDeclarations.length === 0
                  ? <p style={{ fontSize: 14, color: 'var(--color-dim)' }}>No recent declarations found for this state.</p>
                  : risk.openfema.recentDeclarations.map((d, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border)', alignItems: 'baseline', fontSize: 14 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-raised)', padding: '2px 8px', borderRadius: 5, color: 'var(--color-accent)', flexShrink: 0 }}>DR-{d.number}</span>
                      <span>{d.title}</span>
                      <span style={{ color: 'var(--color-dim)', marginLeft: 'auto', flexShrink: 0, fontSize: 12 }}>{d.date}</span>
                    </div>
                  ))
                }
                <CitationBadge text={risk.openfema.attribution} />
              </ExpandCard>
            )}

            {/* What-if premium sliders */}
            <ExpandCard title="What-If Premium Sliders — Indicative HO-3 Pricing">
              <WhatIfPanel />
            </ExpandCard>

            {/* First Street seam */}
            <div style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)', borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-accent)', marginBottom: 4 }}>First Street Foundation Data — Licensed, Not Included</p>
              <p style={{ fontSize: 13, color: 'var(--color-dim)', lineHeight: 1.5 }}>
                {risk.firstStreet.note}
                {' '}<a href={risk.firstStreet.learnMore} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>Learn more</a>.
              </p>
            </div>

            {/* All citations */}
            <ExpandCard title="Data Sources & Citations">
              <ol style={{ paddingLeft: 18, display: 'grid', gap: 8 }}>
                {risk.citations.map((c, i) => (
                  <li key={i} style={{ fontSize: 13, color: 'var(--color-dim)', lineHeight: 1.5 }}>{c}</li>
                ))}
              </ol>
            </ExpandCard>

            {/* Disclaimer */}
            <div style={{ padding: '14px 18px', background: 'var(--color-raised)', borderRadius: 10, border: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-dim)', lineHeight: 1.6 }}>
              {risk.disclaimer}
            </div>

          </div>
        )}

        {/* Photo inventory — always visible once risk is shown */}
        {risk && (
          <div style={{ marginTop: 32 }} className="rise-in">
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.014em', color: 'var(--color-text)', marginBottom: 6 }}>
                Digital Twin Inventory
              </h2>
              <p style={{ fontSize: 14, color: 'var(--color-dim)', lineHeight: 1.6 }}>
                Photograph your home interior — every room, every significant item. Our AI extracts
                a structured inventory with condition assessment and estimated replacement values.
                <strong style={{ color: 'var(--color-text)' }}> Most homeowners never document their contents before a loss.</strong>
              </p>
            </div>
            <div style={{ background: 'var(--color-surface)', borderRadius: 14, padding: '24px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
              <PhotoInventoryPanel address={risk.address} />
            </div>
          </div>
        )}

        {/* Privacy anchor */}
        <div id="privacy" style={{ marginTop: 48, paddingTop: 32, borderTop: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>Privacy & Data Retention</h2>
          <ul style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
            {[
              'Your address is used only to query public free APIs (Census, FEMA, USGS, NOAA, USDA). It is not stored in any database.',
              'Photos are transmitted to the server over HTTPS and processed in-memory by AI (GPT-5.1 via Azure AI Foundry). Only the extracted item list — never the photo itself — is retained.',
              'Session data (item list, estimated values) expires automatically after 24 hours. Delete it immediately via the Delete button.',
              'No data from this consumer surface is accessible to B2B portfolio users. The systems are structurally isolated.',
              'First Street Foundation data (FloodFactor, FireFactor) is not shown — it requires a commercial license.',
            ].map((text, i) => <li key={i} style={{ fontSize: 13, color: 'var(--color-dim)', lineHeight: 1.6 }}>{text}</li>)}
          </ul>
        </div>

      </main>

      <footer style={{ borderTop: '1px solid var(--color-border)', padding: '20px 20px', background: 'var(--color-surface)', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--color-faint)' }}>
          HomeCheck · All risk data from free public sources · Not a quote or offer of insurance ·{' '}
          <Link to="/" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>Product Reinvention Hub</Link>
        </p>
      </footer>
    </div>
  )
}
