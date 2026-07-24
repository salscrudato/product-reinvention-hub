'use strict'
// scripts/import-core-workbook.cjs
// Reverse-engineers Product_Specifications_Core_07_13_2026.xlsx into the
// platform's PCM data model, writes entities to Cosmos (prodhub-sal), and
// produces an output XLSX that matches the business-facing CoverageConfig
// export format (same headers, fills, and column structure as the golden
// docs/export-templates/PA_PROD_001_CoverageConfig (1).xlsx).
//
// Usage:  node scripts/import-core-workbook.cjs
// Needs:  keys.md at repo root (COSMOS_ENDPOINT / COSMOS_KEY)

const path = require('path')
const fs   = require('fs')
const ExcelJS = require('exceljs')

const ROOT        = path.resolve(__dirname, '..')
const TENANT_ID   = 'hagerty'
const PRODUCT_ID  = 'CORE.PRD.001'
const INPUT_FILE  = path.join(ROOT, 'samples', 'iso', 'Product_Specifications_Core_07_13_2026.xlsx')
const OUTPUT_FILE = path.join(ROOT, 'samples', 'iso', 'Core_Product_Export_07_13_2026.xlsx')

// Colours matched byte-for-byte to the golden CoverageConfig
const BLUE_HDR  = 'FF2E75B6'   // header fill (blue)
const BLUE_ALT  = 'FFD9E1F2'   // alternating data row fill (light blue)
const WHITE     = 'FFFFFFFF'
const WHITE_FONT = { argb: 'FFFFFFFF' }

// ─── Load keys.md → env (fill-only; values never logged) ──────────────────────

function loadKeysMd() {
  const km = path.join(ROOT, 'keys.md')
  if (!fs.existsSync(km)) { console.warn('[import] keys.md not found.'); return }
  const text = fs.readFileSync(km, 'utf8')
  let n = 0
  for (const m of text.matchAll(/`([A-Z][A-Z0-9_]{2,})`[^|\n]*\|\s*`([^`]+)`/g)) {
    const [, name, value] = m
    if (!process.env[name]) { process.env[name] = value; n++ }
  }
  console.log(`[import] keys.md: ${n} var(s) loaded.`)
}

loadKeysMd()
if (!process.env.COSMOS_DB || process.env.COSMOS_DB === 'prodhub')
  process.env.COSMOS_DB = 'prodhub-sal'
console.log(`[import] Cosmos DB: ${process.env.COSMOS_DB}`)

// ─── Excel helpers ─────────────────────────────────────────────────────────────

function cellText(cell) {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text || '').join('').trim()
  if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim()
  if (v instanceof Date) return v.toISOString().split('T')[0]
  return String(v).trim()
}

function isPlaceholder(s) {
  if (!s) return true
  const t = s.toLowerCase()
  return t.startsWith('<') || t.includes('intentionally') || t === 'n/a' || t === 'tbd' || t === ''
}

function pascalStrip(name) {
  // Strip ISO part prefix ("Part A — "), match ids.ts coverageDisplayName
  return name.replace(/^Part\s+[A-Z]\s+[—–-]\s+/u, '')
}

function pascalCase(s) {
  return s.replace(/[^A-Za-z0-9]+/g, '')
}

function fieldId(covDisplay, fieldLabel) {
  return `${pascalCase(covDisplay)}Input.${pascalCase(fieldLabel)}`
}

// ─── Row/cell styling helpers ─────────────────────────────────────────────────

/**
 * Apply header style (blue fill, white bold text) to a worksheet row object.
 * `cols` = number of columns to fill (default: all set values).
 */
function styleHeader(row, cols) {
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HDR } }
  const font = { bold: true, color: WHITE_FONT, size: 11 }
  const colCount = cols || (row.values ? row.values.length : 16)
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c)
    cell.fill = fill
    cell.font = font
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  }
  row.height = 18
}

/**
 * Apply alternating fill to a data row (1-based data row index).
 * Even data rows (2, 4, 6 …) → light blue; odd → white (no fill).
 */
function styleDataRow(row, dataRowIndex, cols) {
  if (dataRowIndex % 2 === 0) return  // white (default) — no fill needed
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_ALT } }
  const colCount = cols || 16
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).fill = fill
  }
}

function freezeHeader(ws) {
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
}

// ─── PARSE: Core Framework ─────────────────────────────────────────────────────

const STATE_NAMES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

function parseFramework(ws) {
  const rows = []
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn < 6) return
    const refId = cellText(row.getCell(2));  if (!refId) return
    const coverage   = cellText(row.getCell(5))
    const subCov     = cellText(row.getCell(6))
    const formNums   = cellText(row.getCell(8))
    const req        = cellText(row.getCell(12))
    const claimsBasis = cellText(row.getCell(13))
    const premiumGen = cellText(row.getCell(14))
    const bureau     = cellText(row.getCell(15))
    const prop       = cellText(row.getCell(16))
    const allStates  = cellText(row.getCell(17))
    const states = STATE_NAMES.filter((_, i) => {
      const v = cellText(row.getCell(18 + i)); return v && v !== 'N/A' && v.trim() !== ''
    })
    const isSubCov = /^CORE\.COV\.\d+\.\d+/.test(refId)
    rows.push({
      refId,
      name: isSubCov && !isPlaceholder(subCov) ? subCov : !isPlaceholder(coverage) ? coverage : refId,
      parentCovName: coverage,
      parentId: isSubCov ? refId.split('.').slice(0, 3).join('.') : null,
      formNumbers: formNums && !isPlaceholder(formNums)
        ? formNums.split(/[;,]/).map(s => s.trim()).filter(s => s && s !== 'N/A')
        : [],
      requirement: !isPlaceholder(req) ? req : '',
      claimsBasis: !isPlaceholder(claimsBasis) ? claimsBasis : '',
      premiumGenerating: premiumGen === 'Yes' || premiumGen === 'X',
      source: bureau === 'Yes' || bureau === 'X' ? 'BUREAU' : prop === 'Yes' || prop === 'X' ? 'PROPRIETARY' : 'UNKNOWN',
      allStates: allStates === 'X' || allStates === 'Yes',
      states,
      isProduct: refId.includes('.PRD.'),
      isLob: refId.includes('.LOB.'),
      isCoverage: refId.includes('.COV.'),
      isSubCoverage: isSubCov,
    })
  })
  return rows
}

// ─── PARSE: Core Forms Specifications ─────────────────────────────────────────

function parseForms(ws) {
  const forms = []
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn < 6) return
    const rawIds  = cellText(row.getCell(1))
    const name    = cellText(row.getCell(2))
    const number  = cellText(row.getCell(3))
    const edition = cellText(row.getCell(4))
    const bureau  = cellText(row.getCell(7))
    const prop    = cellText(row.getCell(8))
    const admitted = cellText(row.getCell(9))
    const category = cellText(row.getCell(10))
    const dynamic  = cellText(row.getCell(11))
    const allStates = cellText(row.getCell(20))
    const mandatory = cellText(row.getCell(72))
    const attach    = cellText(row.getCell(73))
    const dispSched = cellText(row.getCell(74))
    const multiUse  = cellText(row.getCell(75))
    if (!number && !name) return
    const states = STATE_NAMES.filter((_, i) => {
      const v = cellText(row.getCell(21 + i)); return v && v !== 'N/A' && v.trim() !== ''
    })
    const txNames = ['Submission','Policy Change','Renewal','Rewrite','Rewrite New Account','Cancellation','Reinstatement']
    const transactions = [76,77,78,79,80,81,82].reduce((acc, col, i) => {
      const v = cellText(row.getCell(col)); if (v && v !== 'N/A' && v.trim() !== '') acc.push(txNames[i]); return acc
    }, [])
    const productRefIds = rawIds.split(/[;,]/).map(s => s.trim()).filter(s => s && s.includes('CORE.'))
    forms.push({ number, edition, name, category: category || 'OTHER',
      dynamic: dynamic === 'Dynamic', mandatoryDefault: mandatory === 'Mandatory' || mandatory === 'M',
      attachmentCondition: attach || 'NONE',
      source: bureau === 'Yes' || bureau === 'X' ? 'BUREAU' : 'PROPRIETARY',
      admitted: admitted !== 'Non-Admitted', displayOnSchedule: dispSched === 'Yes' || dispSched === 'Y',
      multiUse: multiUse === 'Multi-Use' || multiUse === 'Multi',
      transactions, productRefIds, allStates: allStates === 'X' || allStates === 'Yes', states,
    })
  })
  return forms
}

// ─── PARSE: Core Rules Specifications ─────────────────────────────────────────

function parseRules(ws) {
  const rules = []
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn < 6) return
    const frameworkId   = cellText(row.getCell(1))
    const ruleCategory  = cellText(row.getCell(7))
    const ruleSub       = cellText(row.getCell(8))
    const condition     = cellText(row.getCell(10))
    const outcome       = cellText(row.getCell(11))
    const ruleRef       = cellText(row.getCell(12))
    const allStates     = cellText(row.getCell(16))
    if (!condition && !outcome) return
    const states = STATE_NAMES.filter((_, i) => {
      const v = cellText(row.getCell(17 + i)); return v && v !== 'N/A' && v.trim() !== ''
    })
    const coverageRefIds = frameworkId.split(/[;,]/).map(s => s.trim()).filter(s => s && s.includes('CORE.'))
    rules.push({
      category: ruleCategory || 'Product', subCategory: ruleSub || '',
      condition: condition.substring(0, 500), outcome: outcome.substring(0, 500),
      ldTableRef: ruleRef && !isPlaceholder(ruleRef) ? ruleRef : undefined,
      coverageRefIds, formNumbers: [], allStates: allStates === 'X' || allStates === 'Yes', states,
    })
  })
  return rules
}

// ─── PARSE: Core Rating Specifications ────────────────────────────────────────

function parseRating(ws) {
  const steps = []
  let currentCov = null
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn < 6) return
    const covName  = cellText(row.getCell(4));  if (covName) currentCov = covName
    const algStep  = cellText(row.getCell(7))
    const ruleDesc = cellText(row.getCell(5))
    const calc     = cellText(row.getCell(9))
    const rateRef  = cellText(row.getCell(11))
    const allSt    = cellText(row.getCell(13))
    if (!algStep && !ruleDesc) return
    const states = STATE_NAMES.filter((_, i) => {
      const v = cellText(row.getCell(15 + i)); return v && v !== 'N/A' && v !== 'NA' && v.trim() !== ''
    })
    steps.push({
      coverage: currentCov || '', step: algStep || ruleDesc,
      description: ruleDesc.substring(0, 300), calculation: calc,
      rateReference: rateRef, allStates: allSt === 'X' || allSt === 'Yes', states,
    })
  })
  return steps
}

// ─── Build PCM entities ────────────────────────────────────────────────────────

function buildProduct(frameworkRows) {
  const stateSet = new Set()
  frameworkRows.filter(r => r.isCoverage).forEach(r => r.states.forEach(s => stateSet.add(s)))
  return {
    refId: PRODUCT_ID, name: 'Hagerty Core — Collector Vehicle Auto',
    lob: { refId: 'CORE.LOB.001', name: 'Personal Auto' },
    states: [...stateSet].sort(), allStates: true,
    status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
    importedAt: new Date().toISOString(),
    importSource: 'Product_Specifications_Core_07_13_2026.xlsx',
  }
}

function buildCoverages(frameworkRows) {
  return frameworkRows.filter(r => r.isCoverage).map((r, idx) => ({
    refId: r.refId, name: r.name, parentId: r.parentId, order: idx + 1,
    requirement: r.requirement || 'UNKNOWN', claimsBasis: r.claimsBasis || '',
    premiumGenerating: r.premiumGenerating, source: r.source,
    formNumbers: r.formNumbers, terms: [],
    allStates: r.allStates, states: r.states,
    status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED', reviewer: '',
  }))
}

function buildForms(formRows) {
  return formRows.map((f, idx) => ({
    ...f, refId: `CORE.FORM.${String(idx + 1).padStart(4, '0')}`,
    productRefIds: f.productRefIds.length > 0 ? f.productRefIds : [PRODUCT_ID],
  }))
}

function buildRules(ruleRows) {
  return ruleRows.map((r, idx) => ({ ...r, refId: `CORE.RUL.${String(idx + 1).padStart(3, '0')}` }))
}

// ─── Cosmos write ──────────────────────────────────────────────────────────────

async function writeToCosmos(product, coverages, forms, rules) {
  if (!process.env.COSMOS_ENDPOINT || !process.env.COSMOS_KEY)
    return console.warn('[import] Cosmos creds not set — skipping DB write.')

  if (!process.env.AUTH_JWT_SECRET)
    process.env.AUTH_JWT_SECRET = require('crypto').randomBytes(32).toString('hex')

  let mutate
  try { mutate = require('../server/lib/data').mutateInternal }
  catch (e) { console.warn('[import] data.js load failed:', e.message); return }

  const actor = { uid: 'import-script', name: 'Core Workbook Import' }
  const src   = '/scripts/import-core-workbook'
  let ok = 0, err = 0

  async function put(p, type, data) {
    try {
      await mutate(TENANT_ID, { op: 'create', path: p, entityType: type, data }, actor, src)
      ok++; process.stdout.write('.')
    } catch (e) {
      if (e.code === 'CONFLICT' || e.statusCode === 409) {
        try {
          await mutate(TENANT_ID, { op: 'update', path: p, entityType: type, data }, actor, src)
          ok++; process.stdout.write('.')
        } catch { err++; process.stdout.write('!') }
      } else { err++; process.stdout.write('!') }
    }
  }

  process.stdout.write('\n[import] Product …')
  await put(`products/${PRODUCT_ID}`, 'product', product)
  process.stdout.write('\n[import] Coverages …')
  for (const c of coverages) await put(`products/${PRODUCT_ID}/coverages/${c.refId}`, 'coverage', c)
  process.stdout.write('\n[import] Forms …')
  for (const f of forms) await put(`forms/${f.refId}`, 'form', f)
  process.stdout.write('\n[import] Rules …')
  for (const r of rules) await put(`products/${PRODUCT_ID}/rules/${r.refId}`, 'rule', r)
  console.log(`\n[import] Cosmos complete: ${ok} written, ${err} errors.`)
}

// ─── Gap analysis data ─────────────────────────────────────────────────────────

function buildGapRows(coverages, formEntities, ruleEntities, ratingSteps) {
  const topLevel = coverages.filter(c => !c.parentId)
  const subs     = Object.fromEntries(topLevel.map(c => [c.refId, coverages.filter(s => s.parentId === c.refId)]))
  const rows = []

  for (const cov of topLevel) {
    const display   = pascalStrip(cov.name)
    const covForms  = formEntities.filter(f => f.productRefIds.some(r => r === cov.refId))
    const covRules  = ruleEntities.filter(r => r.coverageRefIds.includes(cov.refId) || r.coverageRefIds.includes('CORE.LOB.001'))
    const covSteps  = ratingSteps.filter(s => s.coverage && s.coverage.toLowerCase().split(' ').some(w => w.length > 4 && cov.name.toLowerCase().includes(w)))
    const subList   = subs[cov.refId] || []
    const stateStr  = cov.allStates ? 'All Active States' : cov.states.length > 0 ? cov.states.join(', ') : '(not specified)'

    rows.push({
      refId: cov.refId, name: display,
      limits: { status: 'NOT EXTRACTED', impact: 'HIGH', note: 'No limit schedule in workbook. Defined in CORULES filed rate manuals.' },
      deductibles: ['CORE.COV.009','CORE.COV.010'].includes(cov.refId)
        ? { status: 'NOT EXTRACTED', impact: 'HIGH', note: 'Physical damage — no deductible options found.' }
        : { status: 'N/A', impact: '', note: '' },
      states: { status: stateStr, impact: cov.states.length === 0 && !cov.allStates ? 'MEDIUM' : 'OK', note: '' },
      pricing: { status: covSteps.length > 0 ? `${covSteps.length} step(s) extracted` : 'NOT EXTRACTED', impact: covSteps.length > 0 ? 'OK' : 'MEDIUM',
        note: covSteps.length > 0 ? `Steps: ${covSteps.slice(0,3).map(s=>s.step).join('; ')}` : 'Rating factors defined in proprietary rate filings, not embedded here.' },
      rateTables: { status: 'NOT EXTRACTED', impact: 'HIGH', note: 'Rate Tables sheet has placeholder example only; no actual factor values.' },
      forms: { status: covForms.length > 0 ? `${covForms.length} form(s) specific` : cov.formNumbers.length > 0 ? `${cov.formNumbers.length} form ref(s) in framework` : 'None specific', impact: 'OK',
        note: cov.formNumbers.slice(0,4).join(', ') },
      requirement: { status: cov.requirement && cov.requirement !== 'UNKNOWN' ? cov.requirement : 'NOT POPULATED', impact: 'MEDIUM',
        note: 'Requirement column left blank in Core Framework.' },
      subCoverages: subList.map(s => s.name),
    })
  }
  return rows
}

// ─── Generate output workbook ──────────────────────────────────────────────────

async function generateWorkbook(product, coverages, formEntities, ruleEntities, ratingSteps, gapRows) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Hagerty Import Pipeline'
  wb.created = new Date()

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })

  // ── 1. Coverage sheet (exact CoverageConfig golden format) ──────────────────

  const covWs = wb.addWorksheet('Coverage')
  const COV_COLS = [30, 40, 20, 50, 16, 20, 60, 60, 20]
  COV_COLS.forEach((w, i) => { covWs.getColumn(i + 1).width = w })
  const covHdr = covWs.getRow(1)
  covHdr.values = ['RequirementID','CoverageName','Description','Path','CoverageType','ShowCondition','SubCoverages','State','Transaction']
  styleHeader(covHdr, 9)
  freezeHeader(covWs)

  let di = 0  // data index for alternating
  for (const cov of coverages) {
    di++
    const children = coverages.filter(c => c.parentId === cov.refId)
    const display  = pascalStrip(cov.name)
    const row = covWs.addRow([
      cov.refId,
      display,
      null,
      `coverage[Type="${display}"]`,
      cov.parentId ? 'SubCoverage' : 'LineCoverages',
      null,
      children.length > 0 ? children.map(c => pascalStrip(c.name)).join('; ') : null,
      cov.allStates ? 'All Active States' : cov.states.join(', '),
      null,
    ])
    styleDataRow(row, di, 9)
  }

  // ── 2. Config sheet (exact golden format) ───────────────────────────────────

  const cfgWs = wb.addWorksheet('Config')
  cfgWs.getColumn(1).width = 35; cfgWs.getColumn(2).width = 30; cfgWs.getColumn(3).width = 55
  const cfgHdr = cfgWs.getRow(1)
  cfgHdr.values = ['Component', 'Description', 'Value']
  styleHeader(cfgHdr, 3)
  freezeHeader(cfgWs)

  const cfgData = [
    ['LOB', null, product.lob.name],
    ['ManuscriptID', null, 'Hagerty_CORE_PRD_001_1_0_0_0.xml'],
    ['ParentGroupID', null, null],
    ['ImplementRuleInThisManuScript', null, null],
    ['ImplementRuleInThisGroup', null, null],
    ['TriggeringManuScript', null, null],
    ['Widget', null, 'Coverages'],
    ['ExpressVersion', null, '2'],
  ]
  cfgData.forEach((vals, i) => {
    const row = cfgWs.addRow(vals)
    styleDataRow(row, i + 1, 3)
  })

  // ── 3. InputFields sheet ────────────────────────────────────────────────────
  // Since no LD table data exists, we emit one "Coverage Elected" row per coverage
  // as a best-effort placeholder, marked clearly in the FieldDefault column.

  const ifWs = wb.addWorksheet('InputFields')
  const IF_COLS = [36, 14, 36, 40, 64, 60, 10, 16, 12, 12, 12, 30, 12, 16, 12, 10]
  IF_COLS.forEach((w, i) => { ifWs.getColumn(i + 1).width = w })
  const ifHdr = ifWs.getRow(1)
  ifHdr.values = ['CoverageID','PageSet','PageID','FieldName','FieldID','FieldCaption',
    'Author','PublicOrPrivate','FieldValue','ValueType','ControlType','FieldDefault','GroupType','HideCondition','Rules','ReadOnly']
  styleHeader(ifHdr, 16)
  freezeHeader(ifWs)

  // Inferred field catalogue per coverage kind — best-effort without LD tables
  const FIELD_CATALOGUE = {
    'Bodily Injury':        [{ label:'BI Limit Per Person / Per Accident', kind:'LIMIT', default:'(not available — see Gap Analysis)' }],
    'Property Damage':      [{ label:'PD Limit Per Occurrence', kind:'LIMIT', default:'(not available)' }],
    'Medical Payments':     [{ label:'Medical Payments Limit', kind:'LIMIT', default:'(not available)' }],
    'Uninsured':            [{ label:'UM/UIM Limit Per Person / Per Accident', kind:'LIMIT', default:'(not available)' }],
    'Underinsured':         [{ label:'UIM Bodily Injury Limit', kind:'LIMIT', default:'Matches UM limit' }],
    'Collision':            [{ label:'Collision Deductible', kind:'DEDUCTIBLE', default:'(not available)' }],
    'Other Than Collision': [{ label:'Comprehensive Deductible', kind:'DEDUCTIBLE', default:'(not available)' }],
    'Personal Injury':      [{ label:'PIP Benefit Limit', kind:'LIMIT', default:'(not available — state-specific)' }],
    'Spare Parts':          [{ label:'Spare Parts Coverage Limit', kind:'LIMIT', default:'(not available)' }],
    'Collectible':          [{ label:'Collectible Personal Property Limit', kind:'LIMIT', default:'(not available)' }],
    'Towing':               [{ label:'Towing Limit', kind:'LIMIT', default:'(not available)' }],
    'Evacuation':           [{ label:'Evacuation Expense Limit', kind:'LIMIT', default:'(not available)' }],
    'Auto Death':           [{ label:'Death Benefit Amount', kind:'LIMIT', default:'(not available)' }],
    'Total Disability':     [{ label:'Disability Benefit Amount', kind:'LIMIT', default:'(not available)' }],
    'Income Loss':          [{ label:'Income Loss Benefit', kind:'LIMIT', default:'(not available)' }],
    'Property Protection':  [{ label:'Property Protection Limit', kind:'LIMIT', default:'(not available)' }],
    'Motorcycle':           [{ label:'Motorcycle Passenger Liability Limit', kind:'LIMIT', default:'(not available)' }],
  }

  function findFields(name) {
    for (const [key, fields] of Object.entries(FIELD_CATALOGUE)) {
      if (name.toLowerCase().includes(key.toLowerCase())) return fields
    }
    // default: coverage elected toggle
    return [{ label:'Coverage elected', kind:'OPTION', default:'false' }]
  }

  let ifDi = 0
  for (const cov of coverages) {
    const display = pascalStrip(cov.name)
    const fields  = findFields(cov.name)
    for (const f of fields) {
      ifDi++
      const row = ifWs.addRow([
        display, 'MainInterview', display,
        f.label, fieldId(display, f.label), `${display} ${f.label}`,
        null, 'Public', null, 'Constant',
        f.kind === 'OPTION' ? 'Dropdown' : 'Textbox',
        f.default, 'Input', null, null, null,
      ])
      styleDataRow(row, ifDi, 16)
    }
  }

  // ── 4. Forms sheet ──────────────────────────────────────────────────────────

  const fmWs = wb.addWorksheet('Forms')
  const FM_COLS = [16, 30, 10, 55, 18, 10, 10, 10, 10, 10, 14, 55, 45, 55]
  FM_COLS.forEach((w, i) => { fmWs.getColumn(i + 1).width = w })
  const fmHdr = fmWs.getRow(1)
  fmHdr.values = ['RefId','FormNumber','Edition','FormName','Category','Bureau','Admitted','Mandatory','Dynamic',
    'MultiUse','AllStates','States','ProductRefIds','Transactions']
  styleHeader(fmHdr, 14)
  freezeHeader(fmWs)
  formEntities.forEach((f, i) => {
    const row = fmWs.addRow([
      f.refId, f.number, f.edition, f.name, f.category,
      f.source === 'BUREAU' ? 'Yes' : 'No',
      f.admitted ? 'Yes' : 'No',
      f.mandatoryDefault ? 'Mandatory' : 'Optional',
      f.dynamic ? 'Dynamic' : 'Static',
      f.multiUse ? 'Multi-Use' : 'Single',
      f.allStates ? 'Yes' : 'No',
      f.states.join(', '),
      f.productRefIds.join('; '),
      f.transactions.join(', '),
    ])
    styleDataRow(row, i + 1, 14)
  })

  // ── 5. Rules sheet ─────────────────────────────────────────────────────────

  const ruWs = wb.addWorksheet('Rules')
  const RU_COLS = [14, 16, 24, 80, 80, 20, 40, 10, 55]
  RU_COLS.forEach((w, i) => { ruWs.getColumn(i + 1).width = w })
  const ruHdr = ruWs.getRow(1)
  ruHdr.values = ['RefId','Category','SubCategory','Condition','Outcome','LdTableRef','CoverageRefIds','AllStates','States']
  styleHeader(ruHdr, 9)
  freezeHeader(ruWs)
  ruleEntities.forEach((r, i) => {
    const row = ruWs.addRow([
      r.refId, r.category, r.subCategory, r.condition, r.outcome,
      r.ldTableRef || '', r.coverageRefIds.join('; '),
      r.allStates ? 'Yes' : 'No', r.states.join(', '),
    ])
    styleDataRow(row, i + 1, 9)
    row.getCell(4).alignment = { wrapText: true }
    row.getCell(5).alignment = { wrapText: true }
    row.height = 30
  })

  // ── 6. Rating sheet ────────────────────────────────────────────────────────

  const rtWs = wb.addWorksheet('Rating')
  const RT_COLS = [35, 45, 80, 14, 25, 10, 55]
  RT_COLS.forEach((w, i) => { rtWs.getColumn(i + 1).width = w })
  const rtHdr = rtWs.getRow(1)
  rtHdr.values = ['Coverage','AlgorithmStep','Description','Calculation','RateReference','AllStates','States']
  styleHeader(rtHdr, 7)
  freezeHeader(rtWs)
  ratingSteps.forEach((s, i) => {
    const row = rtWs.addRow([
      s.coverage, s.step, s.description, s.calculation, s.rateReference,
      s.allStates ? 'Yes' : 'No', s.states.join(', '),
    ])
    styleDataRow(row, i + 1, 7)
    row.getCell(3).alignment = { wrapText: true }
    row.height = 28
  })

  // ── 7. Gap Analysis sheet ──────────────────────────────────────────────────

  const gapWs = wb.addWorksheet('Gap Analysis')
  const GAP_COLS = [36, 22, 30, 16, 90, 10]
  GAP_COLS.forEach((w, i) => { gapWs.getColumn(i + 1).width = w })

  // Title block
  const titleRow = gapWs.addRow(['CORE PRODUCT SPECIFICATION — IMPORT GAP ANALYSIS', null, null, null, null, null])
  titleRow.font = { bold: true, size: 13, color: WHITE_FONT }
  titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HDR } }
  titleRow.height = 22
  gapWs.mergeCells('A1:F1')

  const subtitleRow = gapWs.addRow([`Hagerty Core — Collector Vehicle Auto (Personal Auto)   ·   Import date: ${today}   ·   Source: Product_Specifications_Core_07_13_2026.xlsx`, null, null, null, null, null])
  subtitleRow.font = { italic: true, size: 10, color: { argb: 'FF555555' } }
  subtitleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_ALT } }
  gapWs.mergeCells('A2:F2')
  gapWs.addRow([])

  // Header row
  const gapHdr = gapWs.addRow(['Coverage', 'Dimension', 'Status', 'Impact', 'Notes', ''])
  styleHeader(gapHdr, 5)
  gapWs.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }]

  const IMPACT_COLORS = { HIGH: 'FFFFDDDD', MEDIUM: 'FFFFF0CC', OK: 'FFE6F4EA', '': 'FFFFFFFF' }
  const IMPACT_FONTS  = { HIGH: 'FFCC0000', MEDIUM: 'FF886600', OK: 'FF2E7D32', '': 'FF000000' }

  function addGapRow(coverageName, dimension, status, impact, note) {
    const row = gapWs.addRow([coverageName, dimension, status, impact, note, null])
    const fillArgb = IMPACT_COLORS[impact] || IMPACT_COLORS['']
    for (let c = 1; c <= 5; c++) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
    }
    if (impact) {
      row.getCell(3).font = { color: { argb: IMPACT_FONTS[impact] }, bold: impact !== 'OK' }
      row.getCell(4).font = { color: { argb: IMPACT_FONTS[impact] }, bold: impact !== 'OK' }
    }
    row.getCell(5).alignment = { wrapText: true }
    row.height = 30
    return row
  }

  function addSectionHeader(title) {
    const row = gapWs.addRow([title, null, null, null, null, null])
    row.font = { bold: true, size: 10, color: WHITE_FONT }
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    gapWs.mergeCells(`A${row.number}:F${row.number}`)
    row.height = 16
    return row
  }

  // Product-level summary
  addSectionHeader('PRODUCT-LEVEL FINDINGS')
  addGapRow('Product', 'Identity', 'LOB: Personal Auto · Product: Hagerty Core', 'OK', 'LOB and product name confirmed. Phase 2 / Apex rating. Tenant: hagerty.')
  addGapRow('Product', 'Requirement flags', 'NOT POPULATED', 'MEDIUM', 'Mandatory/Optional column left blank for all 19 coverages in the Core Framework. Template not fully filled by authoring team.')
  addGapRow('Product', 'Claims Basis', 'NOT POPULATED', 'MEDIUM', 'Claims-Made vs Occurrence not populated for any coverage.')
  addGapRow('Product', 'Limits / Deductibles', 'NOT EXTRACTED', 'HIGH', 'No limit or deductible schedule anywhere in this workbook. Defined in CORULES 01 25 and state-specific rate filings — separate documents not embedded here.')
  addGapRow('Product', 'Rate Tables', 'NOT EXTRACTED', 'HIGH', 'Core Rate Tables sheet contains one placeholder example (Employee Benefits Liability) and two empty stubs. No actual Hagerty Core factor values present.')
  gapWs.addRow([])

  // Coverage-by-coverage
  addSectionHeader('COVERAGE-BY-COVERAGE FINDINGS  (19 top-level · 93 sub-coverages)')
  for (const g of gapRows) {
    const covLabel = `${g.refId}  —  ${g.name}`
    addGapRow(covLabel, 'Limits', g.limits.status, g.limits.impact, g.limits.note)
    if (g.deductibles.status !== 'N/A')
      addGapRow(g.refId, 'Deductibles', g.deductibles.status, g.deductibles.impact, g.deductibles.note)
    addGapRow(g.refId, 'State Applicability', g.states.status, g.states.impact === 'OK' ? 'OK' : g.states.impact, '')
    addGapRow(g.refId, 'Pricing / Rating', g.pricing.status, g.pricing.impact, g.pricing.note)
    addGapRow(g.refId, 'Rate Tables', g.rateTables.status, g.rateTables.impact, g.rateTables.note)
    addGapRow(g.refId, 'Forms', g.forms.status, g.forms.impact, g.forms.note)
    addGapRow(g.refId, 'Coverage Requirement', g.requirement.status, g.requirement.impact, g.requirement.note)
    if (g.subCoverages.length > 0)
      addGapRow(g.refId, 'Sub-Coverages', `${g.subCoverages.length} extracted`, 'OK', g.subCoverages.slice(0,5).join(' · ') + (g.subCoverages.length > 5 ? ` · +${g.subCoverages.length-5} more` : ''))
    gapWs.addRow([])
  }

  // Unresolved list
  addSectionHeader('UNRESOLVED ITEMS — additional source documents required')
  const unresolved = [
    ['Limit options / schedules (all 19 coverages)', 'CORULES 01 25, state rate manuals — not embedded in specification workbooks'],
    ['Deductible options / schedules (Collision, OTC)', 'Same — separate rate filings'],
    ['Actual rate table factor values', 'Proprietary tables; Core Rate Tables sheet has placeholder only'],
    ['Coverage Requirement (Mandatory/Optional) flags', 'Template column left blank — authoring team action required'],
    ['Claims Basis (Occurrence/Claims-Made)', 'Template column left blank'],
    ['PIP state-specific benefit amounts (COV.015)', 'State-specific; in AC 004 endorsements, not in framework'],
    ['UM/UIM limit schedules (COV.005–008)', 'State-specific; in AC 002/003 endorsements'],
    ['Territory / class base rates', 'Proprietary — referenced in CORULES but not embedded'],
    ['Premium Generating flags', 'Template column left blank'],
    ['LD (Limit/Deductible) table structures', 'No LD tables present anywhere in workbook'],
  ]
  unresolved.forEach(([item, reason]) => {
    addGapRow(item, 'Unresolved', 'CANNOT IMPORT', 'HIGH', reason)
  })

  // ── 8. Code sheet ─────────────────────────────────────────────────────────
  // Embeds the source of this script as cell text so the workbook is self-documenting.

  const codeWs = wb.addWorksheet('Code')
  codeWs.getColumn(1).width = 12
  codeWs.getColumn(2).width = 140

  const codeHdr = codeWs.addRow(['Line', 'Source — scripts/import-core-workbook.cjs'])
  codeHdr.font = { bold: true, color: WHITE_FONT, size: 10, name: 'Consolas' }
  codeHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HDR } }
  codeWs.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]

  const sourceCode = fs.readFileSync(__filename, 'utf8')
  sourceCode.split('\n').forEach((line, i) => {
    const row = codeWs.addRow([i + 1, line.replace(/\t/g, '  ')])
    row.font = { name: 'Consolas', size: 9 }
    if ((i + 1) % 2 === 0)
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_ALT } }
    row.getCell(2).alignment = { horizontal: 'left' }
  })

  // ── Write file ──────────────────────────────────────────────────────────────

  await wb.xlsx.writeFile(OUTPUT_FILE)
  console.log(`\n[import] Output written → ${OUTPUT_FILE}`)
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[import] Reading: ${INPUT_FILE}`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(INPUT_FILE)

  const fwRows      = parseFramework(wb.getWorksheet('Core Framework'))
  const formRows    = parseForms(wb.getWorksheet('Core Forms Specifications'))
  const ruleRows    = parseRules(wb.getWorksheet('Core Rules Specifications'))
  const ratingSteps = parseRating(wb.getWorksheet('Core Rating Specifications'))

  console.log(`[import] Parsed: ${fwRows.filter(r=>r.isCoverage).length} coverages, ${formRows.length} forms, ${ruleRows.length} rules, ${ratingSteps.length} rating steps`)

  const product   = buildProduct(fwRows)
  const coverages = buildCoverages(fwRows)
  const forms     = buildForms(formRows)
  const rules     = buildRules(ruleRows)

  await writeToCosmos(product, coverages, forms, rules)

  const gapRows = buildGapRows(coverages, forms, rules, ratingSteps)
  await generateWorkbook(product, coverages, forms, rules, ratingSteps, gapRows)

  console.log('[import] DONE.')
  console.log(`  Product: 1  ·  Coverages: ${coverages.length}  ·  Forms: ${forms.length}  ·  Rules: ${rules.length}  ·  Rating steps: ${ratingSteps.length}`)
  console.log(`  Output: ${OUTPUT_FILE}`)
}

main().catch(e => { console.error('[import] FATAL:', e); process.exit(1) })
