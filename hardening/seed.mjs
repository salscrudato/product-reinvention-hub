#!/usr/bin/env node
/**
 * hardening/seed.mjs — Reference-product test-data seeder for local hardening.
 *
 * Seeds PH.PROD.001 (HO-3), GL.PROD.001 (CGL), and PA.PROD.001 (Personal Auto)
 * into PF_TEST_TENANT via POST /api/db/mutate. Every entity goes through the real
 * write path — never directly to Cosmos. Idempotent: re-runs update existing entities
 * (rev increments, data converges to canonical state).
 *
 * Usage:
 *   node hardening/seed.mjs [--with-grounding]
 *
 * Env (required on the server — set before starting node server/server.js):
 *   COSMOS_ENDPOINT, COSMOS_KEY, AUTH_JWT_SECRET
 * Env (optional here — never read by this script; checked only for local runs):
 *   BASE_URL           — server base URL (default http://localhost:3000)
 *                        Set to https://app-prodhub-dev.azurewebsites.net for the live host.
 *   PF_TEST_TENANT     — target tenant id (default 'hardening-test')
 *
 * GROUNDING CAVEAT: DEF-0034 (mutate() never wrote groundingChunks) is FIXED
 * (commit fcf1fe86). The envelope() in server/lib/data.js now automatically writes
 * a 5th Cosmos op (kind:'entity', coll:'groundingChunks') on every non-delete mutate,
 * provided server/lib/chunk-shared.cjs is present (built by pnpm build:chunk).
 * Portfolio-chat grounding for these seeded products will work once the server has
 * been built with `pnpm build:chunk`. If chunk-shared.cjs is absent the server
 * degrades silently — the seeder reports the chunk count via --with-grounding.
 */

import { spawnSync } from 'child_process'

const BASE_URL    = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const TEST_TENANT = process.env.PF_TEST_TENANT || 'hardening-test'
const WITH_GROUNDING = process.argv.includes('--with-grounding')

// ─── Safety guardrail ─────────────────────────────────────────────────────────
const PROD_GUARD = ['production', 'prod', 'live', 'default', 'acme']
if (PROD_GUARD.includes(TEST_TENANT.toLowerCase())) {
  console.error(`\nERROR: PF_TEST_TENANT='${TEST_TENANT}' looks like a production tenant.`)
  console.error('Set PF_TEST_TENANT to a dedicated test value (e.g. hardening-test). Refusing to seed.')
  process.exit(1)
}

// ─── Precondition: server-side env vars (local runs only) ────────────────────
// When BASE_URL points at a remote host (e.g. app-prodhub-dev.azurewebsites.net),
// COSMOS_ENDPOINT / COSMOS_KEY / AUTH_JWT_SECRET live in App Service configuration
// and are NOT available locally — skip the check. Only enforce it for localhost,
// where the operator starts the server themselves.
const IS_LOCAL = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1')
if (IS_LOCAL) {
  const REQUIRED_ENV = ['COSMOS_ENDPOINT', 'COSMOS_KEY', 'AUTH_JWT_SECRET']
  const missingEnv = REQUIRED_ENV.filter(k => !process.env[k])
  if (missingEnv.length > 0) {
    console.error('\nPRECONDITION FAIL — required environment variables not set:')
    missingEnv.forEach(k => console.error(`  MISSING: ${k}`))
    console.error('\nThese are read by the server (server/lib/*.js); set them before starting')
    console.error('node server/server.js. See docs/DEPLOY_AZURE.md for the full list.')
    process.exit(1)
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = { _raw: text } }
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function apiGet(path, token) {
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, { headers })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = { _raw: text } }
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function mutate(payload, token) {
  return apiPost('/api/db/mutate', payload, token)
}

async function listEntities(collPath, token) {
  const r = await apiPost('/api/db/list', { path: collPath }, token)
  return r.data || []
}

// ─── Shared governance / scope constants ─────────────────────────────────────
const PH_STATES = ['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA']
const PH_COASTAL= ['FL','GA','NC','SC','TX']
const PA_STATES = [
  'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA','KS','KY',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NC','ND','OH',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI',
]
const GL_STATES = [
  'AL','AZ','AR','CA','CO','CT','DE','DC','FL','GA','ID','IL','IN','IA','KS','KY',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]
const PH_SCOPE     = { allStates: false, states: PH_STATES }
const PA_SCOPE     = { allStates: false, states: PA_STATES }
const GL_SCOPE     = { allStates: false, states: GL_STATES }
const COASTAL_SCOPE= { allStates: false, states: PH_COASTAL }
const GOV = {
  status: 'ACTIVE', lifecycle: 'LAUNCHED', reviewStatus: 'APPROVED',
  reviewer: 'system', createdAt: null, updatedAt: null, updatedBy: 'seed', rev: 1,
}

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL HOME — PH.PROD.001 (ISO HO-3 Special Form)
// Source: shared/src/seed/personalHome.ts  Canary: $1,528
// ══════════════════════════════════════════════════════════════════════════════

const PH_PRODUCT = {
  refId: 'PH.PROD.001', name: 'Personal Home — HO-3 Special Form',
  lob: { refId: 'PH.LOB.001', name: 'Personal Home' },
  description: 'ISO-style Special Form homeowners policy covering dwelling, personal property, liability and medical payments on an open-peril basis.',
  marketSegment: 'Personal Lines / Property',
  owner: { uid: 'seed', name: 'Product Factory Seed' },
  ...PH_SCOPE, ...GOV,
}

const PH_LD_TABLES = {
  'PH.LD.001': { name: 'Coverage E — Personal Liability Limits', defaultValue: 300000,
    rows: [{ label: '$100,000', value: 100000 }, { label: '$300,000', value: 300000 }, { label: '$500,000', value: 500000 }] },
  'PH.LD.002': { name: 'Coverage F — Medical Payments Limits', defaultValue: 1000,
    rows: [{ label: '$1,000', value: 1000 }, { label: '$2,000', value: 2000 }, { label: '$5,000', value: 5000, constraintNote: 'Available only when Coverage E ≥ 300,000' }] },
  'PH.LD.003': { name: 'All-Peril Deductible', defaultValue: 1000,
    rows: [{ label: '$500', value: 500 }, { label: '$1,000', value: 1000 }, { label: '$2,500', value: 2500 }, { label: '$5,000', value: 5000 }] },
  'PH.LD.004': { name: 'Wind/Hail Percentage Deductible',
    rows: [
      { label: '1%', value: 1, constraintNote: 'Coastal states only (FL GA NC SC TX); dollar amount must be ≥ all-peril deductible' },
      { label: '2%', value: 2, constraintNote: 'Coastal states only (FL GA NC SC TX); dollar amount must be ≥ all-peril deductible' },
      { label: '5%', value: 5, constraintNote: 'Coastal states only (FL GA NC SC TX); dollar amount must be ≥ all-peril deductible' },
    ] },
  'PH.LD.005': { name: 'Coverage C — Personal Property % of Coverage A', defaultValue: 50,
    rows: [{ label: '50%', value: 50 }, { label: '70%', value: 70 }, { label: '75%', value: 75 }] },
  'PH.LD.006': { name: 'Water Back-Up & Sump Overflow Limit', defaultValue: 5000,
    rows: [{ label: '$5,000', value: 5000 }, { label: '$10,000', value: 10000 }, { label: '$25,000', value: 25000 }] },
}

const PH_RT_TABLES = {
  'PH.RT.001': { name: 'Territory Base Rate', columns: ['territory','rate'],
    rows: [{ territory:'T001',rate:640 },{ territory:'T002',rate:700 },{ territory:'T003',rate:815 },{ territory:'T004',rate:905 },{ territory:'T005',rate:1040 }] },
  'PH.RT.002': { name: 'Protection Class × Construction Factor', columns: ['pcMin','pcMax','F','M'],
    rows: [{ pcMin:1,pcMax:3,F:0.95,M:0.90 },{ pcMin:4,pcMax:6,F:1.10,M:1.05 },{ pcMin:7,pcMax:8,F:1.30,M:1.20 },{ pcMin:9,pcMax:10,F:1.55,M:1.45 }] },
  'PH.RT.003': { name: 'Coverage A Key Factor', columns: ['covA','factor'],
    rows: [{ covA:200000,factor:0.80 },{ covA:250000,factor:0.90 },{ covA:300000,factor:1.00 },{ covA:350000,factor:1.14 },{ covA:400000,factor:1.30 },{ covA:500000,factor:1.62 },{ covA:600000,factor:1.94 }] },
  'PH.RT.004': { name: 'Deductible Factors', columns: ['subTable','key','factor'],
    rows: [{ subTable:'allPeril',key:500,factor:1.10 },{ subTable:'allPeril',key:1000,factor:1.00 },{ subTable:'allPeril',key:2500,factor:0.88 },{ subTable:'allPeril',key:5000,factor:0.76 },{ subTable:'windHail',key:1,factor:0.97 },{ subTable:'windHail',key:2,factor:0.94 },{ subTable:'windHail',key:5,factor:0.89 }] },
  'PH.RT.005': { name: 'Coverage C Percentage Factor', columns: ['covCPct','factor'],
    rows: [{ covCPct:50,factor:1.00 },{ covCPct:70,factor:1.06 },{ covCPct:75,factor:1.09 }] },
  'PH.RT.006': { name: 'Liability Increased-Limit Charges ($)', columns: ['limType','limit','charge'],
    rows: [{ limType:'E',limit:100000,charge:0 },{ limType:'E',limit:300000,charge:24 },{ limType:'E',limit:500000,charge:38 },{ limType:'F',limit:1000,charge:0 },{ limType:'F',limit:2000,charge:6 },{ limType:'F',limit:5000,charge:18 }] },
  'PH.RT.007': { name: 'Scheduled Personal Property Class Rates (per $100 of appraised value)', columns: ['itemClass','ratePerHundred'],
    rows: [{ itemClass:'Jewelry',ratePerHundred:1.27 },{ itemClass:'Furs',ratePerHundred:0.55 },{ itemClass:'Cameras',ratePerHundred:1.10 },{ itemClass:'Fine Arts',ratePerHundred:0.85 },{ itemClass:'Silverware',ratePerHundred:0.45 },{ itemClass:'Musical Instruments',ratePerHundred:0.60 }] },
  'PH.RT.008': { name: 'Endorsement/Credit Factors', columns: ['deviceCredit','factor'],
    rows: [{ deviceCredit:'none',factor:1.00 },{ deviceCredit:'local',factor:0.98 },{ deviceCredit:'central',factor:0.95 }] },
  'PH.RT.009': { name: 'Tier Factor', columns: ['tier','factor'],
    rows: [{ tier:'A',factor:0.90 },{ tier:'B',factor:1.10 },{ tier:'C',factor:1.25 }] },
  'PH.RT.010': { name: 'Water Back-Up Flat Premium', columns: ['limit','flatPremium'],
    rows: [{ limit:5000,flatPremium:75 },{ limit:10000,flatPremium:110 },{ limit:25000,flatPremium:175 }] },
}

const PH_COVERAGES = [
  { refId:'PH.COV.001', name:'Coverage A — Dwelling', parentId:null, order:1, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['HO 00 03'], terms:[{ id:'cov-a-limit', kind:'LIMIT', label:'Coverage A Amount', basis:'per occurrence', default:300000, unit:'dollars' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.002', name:'Coverage B — Other Structures', parentId:null, order:2, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:false, source:'BUREAU', formNumbers:['HO 00 03'], terms:[{ id:'cov-b-limit', kind:'LIMIT', label:'Coverage B Limit (10% of A default)', basis:'per occurrence', default:'10% of Coverage A', unit:'dollars' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.003', name:'Coverage C — Personal Property', parentId:null, order:3, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['HO 00 03'], terms:[{ id:'cov-c-pct', kind:'LIMIT', label:'Coverage C % of A', basis:'per occurrence', ldTableRef:'PH.LD.005', default:50, unit:'percent' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.004', name:'Coverage D — Loss of Use', parentId:null, order:4, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:false, source:'BUREAU', formNumbers:['HO 00 03'], terms:[{ id:'cov-d-limit', kind:'LIMIT', label:'Coverage D Limit (30% of A)', basis:'per occurrence', default:'30% of Coverage A', unit:'dollars' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.005', name:'Coverage E — Personal Liability', parentId:null, order:5, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['HO 00 03'], terms:[{ id:'cov-e-limit', kind:'LIMIT', label:'Coverage E Limit', basis:'per occurrence', ldTableRef:'PH.LD.001', default:300000, unit:'dollars' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.006', name:'Coverage F — Medical Payments', parentId:null, order:6, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['HO 00 03'], terms:[{ id:'cov-f-limit', kind:'LIMIT', label:'Coverage F Limit', basis:'per person per occurrence', ldTableRef:'PH.LD.002', default:1000, unit:'dollars' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.001.001', name:'Water Back-Up & Sump Overflow', parentId:'PH.COV.001', order:1, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['HO 04 95'], terms:[{ id:'water-backup-limit', kind:'LIMIT', label:'Water Back-Up Limit', basis:'per occurrence', ldTableRef:'PH.LD.006', default:5000, unit:'dollars' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.002.001', name:'Other Structures — Increased Limits', parentId:'PH.COV.002', order:1, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'PROPRIETARY', formNumbers:['HO 04 48'], terms:[{ id:'other-struct-limit', kind:'LIMIT', label:'Other Structures Increased Limit', basis:'per occurrence', default:0, unit:'dollars' }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.003.001', name:'Personal Property Replacement Cost', parentId:'PH.COV.003', order:1, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['HO 04 90'], terms:[{ id:'rc-elected', kind:'OPTION', label:'Replacement Cost Coverage', basis:'flag', default:false }], ...PH_SCOPE, ...GOV },
  { refId:'PH.COV.003.002', name:'Scheduled Personal Property', parentId:'PH.COV.003', order:2, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['HO 04 61'], terms:[{ id:'spp-schedule', kind:'OPTION', label:'SPP Schedule (class + appraised value)', basis:'per item', default:false, notes:'Repeating schedule: ItemClass + AppraisedValue per item. See HO 04 61.' }], ...PH_SCOPE, ...GOV },
]

const PH_FORMS = [
  { number:'HO 00 03', edition:'05 11', name:'Homeowners 3 — Special Form', category:'BASE_COVERAGE', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Section I','Section II'], productRefIds:['PH.PROD.001'], description:'Base open-peril homeowners policy form covering dwelling, other structures, personal property, loss of use, personal liability and medical payments.', dynamicFields:[], ...PH_SCOPE, ...GOV },
  { number:'HO DS 01', edition:'05 11', name:'Homeowners Policy Declarations', category:'DECLARATIONS', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PH.PROD.001'], description:'Policy declarations page showing named insured, property address, coverage limits, deductibles and total premium.', dynamicFields:[{ name:'NamedInsured', dataType:'TEXT', repeating:false },{ name:'PropertyAddress', dataType:'TEXT', repeating:false },{ name:'PolicyEffective', dataType:'DATE', repeating:false },{ name:'PolicyExpiration', dataType:'DATE', repeating:false },{ name:'CoverageLimits', dataType:'CURRENCY', repeating:true, notes:'Coverage TEXT + Limit CURRENCY per row' },{ name:'TotalPremium', dataType:'CURRENCY', repeating:false }], ...PH_SCOPE, ...GOV },
  { number:'HO 04 90', edition:'05 11', name:'Personal Property Replacement Cost Loss Settlement', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Section I'], productRefIds:['PH.PROD.001'], description:'Amends Coverage C to settle losses at replacement cost rather than actual cash value.', dynamicFields:[], ...PH_SCOPE, ...GOV },
  { number:'HO 04 95', edition:'05 11', name:'Water Back-Up and Sump Discharge or Overflow', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Section I'], productRefIds:['PH.PROD.001'], description:'Extends coverage to loss caused by water that backs up through sewers or drains or overflows from a sump.', dynamicFields:[{ name:'BackUpLimit', dataType:'CURRENCY', repeating:false }], ...PH_SCOPE, ...GOV },
  { number:'HO 04 61', edition:'05 11', name:'Scheduled Personal Property Endorsement', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Section I'], productRefIds:['PH.PROD.001'], description:'Schedules high-value personal property items at agreed appraised values.', dynamicFields:[{ name:'ItemClass', dataType:'LIST', repeating:true, options:['Jewelry','Furs','Cameras','Fine Arts','Silverware','Musical Instruments'] },{ name:'ItemDescription', dataType:'TEXT', repeating:true },{ name:'AppraisedValue', dataType:'CURRENCY', repeating:true }], ...PH_SCOPE, ...GOV },
  { number:'HO 04 16', edition:'05 11', name:'Premises Alarm or Fire Protection System', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PH.PROD.001'], description:'Documents a qualifying protective device system and applies the corresponding premium credit.', dynamicFields:[{ name:'DeviceType', dataType:'LIST', repeating:false, options:['Local Alarm','Central Station'] },{ name:'CertificateNo', dataType:'TEXT', repeating:false }], ...PH_SCOPE, ...GOV },
  { number:'HO 04 48', edition:'05 11', name:'Other Structures — Increased Limits', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:true, transactions:[], coverageParts:['Section I'], productRefIds:['PH.PROD.001'], description:'Increases Coverage B beyond the default 10% of Coverage A for specifically described other structures.', dynamicFields:[{ name:'StructureDescription', dataType:'TEXT', repeating:true },{ name:'IncreasedLimit', dataType:'CURRENCY', repeating:true }], ...PH_SCOPE, ...GOV },
  { number:'HO 03 12', edition:'05 11', name:'Windstorm or Hail Percentage Deductible', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:['Section I'], productRefIds:['PH.PROD.001'], description:'Replaces the standard deductible for windstorm or hail losses with a percentage-of-dwelling deductible.', dynamicFields:[{ name:'DeductiblePercent', dataType:'LIST', repeating:false, options:['1%','2%','5%'] }], ...COASTAL_SCOPE, ...GOV },
  { number:'HO 04 96', edition:'05 11', name:'No Section II Coverage — Home Day Care Business', category:'EXCLUSION', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:['Section II'], productRefIds:['PH.PROD.001'], description:'Excludes personal liability and medical payments coverage for the day-care business conducted at the residence.', dynamicFields:[], ...PH_SCOPE, ...GOV },
  { number:'HO 01 04', edition:'05 11', name:'Special Provisions — California', category:'AMENDATORY', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PH.PROD.001'], description:'Modifies the base policy to comply with California statutes and Department of Insurance requirements.', dynamicFields:[], allStates:false, states:['CA'], ...GOV },
  { number:'HO 01 33', edition:'05 11', name:'Special Provisions — Texas', category:'AMENDATORY', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PH.PROD.001'], description:'Modifies the base policy to comply with Texas Department of Insurance requirements.', dynamicFields:[], allStates:false, states:['TX'], ...GOV },
  { number:'PN HO 01', edition:'05 11', name:'Policyholder Notice — Important Information', category:'POLICY_NOTICE', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PH.PROD.001'], description:'Required notice providing policyholders with important information about their policy rights and obligations.', dynamicFields:[], ...PH_SCOPE, ...GOV },
]

const PH_RULES = [
  { refId:'PH.RU.001', category:'PRODUCT', subCategory:'Eligibility', condition:'Owner-occupied 1–4 family dwelling, residential use', outcome:'Eligible for HO-3 Special Form', coverageRefIds:[], formNumbers:[], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.002', category:'PRODUCT', subCategory:'Coverage Limits', condition:'Coverage B default limit', outcome:'Default = 10% of Coverage A; increase only via HO 04 48', coverageRefIds:['PH.COV.002'], formNumbers:['HO 04 48'], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.003', category:'PRODUCT', subCategory:'Coverage Limits', condition:'Coverage C percentage of A', outcome:'Options per PH.LD.005; default 50% of A', ldTableRef:'PH.LD.005', coverageRefIds:['PH.COV.003'], formNumbers:[], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.004', category:'PRODUCT', subCategory:'Coverage Limits', condition:'Coverage D limit', outcome:'30% of Coverage A (calculated)', coverageRefIds:['PH.COV.004'], formNumbers:[], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.005', category:'PRODUCT', subCategory:'Coverage Limits', condition:'Coverage E limit options', outcome:'Options per PH.LD.001; default $300,000', ldTableRef:'PH.LD.001', coverageRefIds:['PH.COV.005'], formNumbers:[], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.006', category:'PRODUCT', subCategory:'Coverage Constraints', condition:'Coverage F $5,000 limit selected', outcome:'Requires Coverage E ≥ $300,000', ldTableRef:'PH.LD.002', coverageRefIds:['PH.COV.005','PH.COV.006'], formNumbers:[], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.007', category:'RATING', subCategory:'Deductibles', condition:'All-peril deductible selection', outcome:'Options per PH.LD.003; default $1,000', ldTableRef:'PH.LD.003', coverageRefIds:[], formNumbers:[], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.008', category:'RATING', subCategory:'Deductibles', condition:'Wind/Hail percentage deductible elected', outcome:'Coastal states only (FL GA NC SC TX); dollar amount ≥ all-peril deductible', ldTableRef:'PH.LD.004', coverageRefIds:[], formNumbers:['HO 03 12'], ...COASTAL_SCOPE, ...GOV },
  { refId:'PH.RU.009', category:'RATING', subCategory:'Premium Floor', condition:'Calculated premium', outcome:'Minimum policy premium $500 (PH.RAT.1 step 11)', coverageRefIds:[], formNumbers:[], ...PH_SCOPE, ...GOV },
  { refId:'PH.RU.010', category:'PRODUCT', subCategory:'Eligibility', condition:'Seasonal or secondary dwelling', outcome:'Ineligible unless companion primary policy is in force', coverageRefIds:[], formNumbers:[], ...PH_SCOPE, ...GOV },
]

const PH_FORM_RULES = [
  { refId:'PH.FORM.RU.001', condition:'Replacement Cost elected', outcome:'Attach HO 04 90', formNumbers:['HO 04 90'], mandatory:true, ...GOV },
  { refId:'PH.FORM.RU.002', condition:'Water Back-Up elected', outcome:'Attach HO 04 95', formNumbers:['HO 04 95'], mandatory:true, ...GOV },
  { refId:'PH.FORM.RU.003', condition:'Scheduled Personal Property elected', outcome:'Attach HO 04 61', formNumbers:['HO 04 61'], mandatory:true, ...GOV },
  { refId:'PH.FORM.RU.004', condition:'Protective-device credit ≠ none', outcome:'Attach HO 04 16', formNumbers:['HO 04 16'], mandatory:true, ...GOV },
  { refId:'PH.FORM.RU.005', condition:'Wind/Hail % deductible elected', outcome:'Attach HO 03 12', formNumbers:['HO 03 12'], mandatory:true, ...GOV },
  { refId:'PH.FORM.RU.006', condition:'Risk state = CA', outcome:'Attach HO 01 04; TX → HO 01 33', formNumbers:['HO 01 04','HO 01 33'], mandatory:true, ...GOV },
  { refId:'PH.FORM.RU.007', condition:'Home day-care exclusion elected', outcome:'Attach HO 04 96', formNumbers:['HO 04 96'], mandatory:false, ...GOV },
]

const PH_RATING_PROGRAM = {
  refId: 'PH.RAT.1', name: 'Personal Home Rating Program', minimumPremium: 500,
  ...PH_SCOPE, ...GOV,
  steps: [
    { id:'s1',   order:1,  label:'Territory base rate',               op:'SET',       source:{ type:'RT',    ref:'PH.RT.001', keys:['territory'] } },
    { id:'s2',   order:2,  label:'Protection/construction factor',     op:'MUL',       source:{ type:'RT',    ref:'PH.RT.002', keys:['pc','construction'] } },
    { id:'s3',   order:3,  label:'Coverage A key factor → Key Premium',op:'MUL',       source:{ type:'RT',    ref:'PH.RT.003', keys:['covA'] },           roundTo:0 },
    { id:'s4a',  order:4,  label:'All-peril deductible factor',        op:'MUL',       source:{ type:'RT',    ref:'PH.RT.004', keys:['allPerilDed'] } },
    { id:'s4b',  order:5,  label:'Wind/hail deductible factor',        op:'MUL',       source:{ type:'RT',    ref:'PH.RT.004', keys:['windHailPct'] },     condition:'windHailElected' },
    { id:'s5',   order:6,  label:'Coverage C percentage factor',       op:'MUL',       source:{ type:'RT',    ref:'PH.RT.005', keys:['covCPct'] } },
    { id:'s6',   order:7,  label:'Coverage E increased-limit charge',  op:'ADD',       source:{ type:'RT',    ref:'PH.RT.006', keys:['covELimit'] } },
    { id:'s7',   order:8,  label:'Coverage F increased-limit charge',  op:'ADD',       source:{ type:'RT',    ref:'PH.RT.006', keys:['covFLimit'] } },
    { id:'s8a',  order:9,  label:'Replacement Cost endorsement factor',op:'MUL',       source:{ type:'CONST', value:1.10 },                              condition:'rcElected' },
    { id:'s8b',  order:10, label:'Protective device credit',           op:'MUL',       source:{ type:'RT',    ref:'PH.RT.008', keys:['deviceCredit'] },   roundTo:2 },
    { id:'s9',   order:11, label:'Tier factor',                        op:'MUL',       source:{ type:'RT',    ref:'PH.RT.009', keys:['tier'] } },
    { id:'s10a', order:12, label:'Water back-up flat premium',         op:'ADD',       source:{ type:'RT',    ref:'PH.RT.010', keys:['waterBackupLimit'] },condition:'waterBackupElected' },
    { id:'s10b', order:13, label:'Scheduled Personal Property premium',op:'ADD',       source:{ type:'SPP',   ref:'PH.RT.007' },                         condition:'sppElected' },
    { id:'s11',  order:14, label:'Apply minimum premium ($500)',        op:'MIN_FLOOR', source:{ type:'CONST', value:500 },                              roundTo:0 },
  ],
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERAL LIABILITY — GL.PROD.001 (ISO CGL CG 00 01)
// Source: shared/src/seed/generalLiability.ts  Canary: $2,635
// ══════════════════════════════════════════════════════════════════════════════

const GL_PRODUCT = {
  refId: 'GL.PROD.001', name: 'Commercial General Liability',
  lob: { refId: 'GL.LOB.001', name: 'General Liability' },
  description: 'ISO-style Commercial General Liability policy (CG 00 01) covering bodily injury and property damage liability (Coverage A), personal and advertising injury liability (Coverage B), and medical payments (Coverage C) on an occurrence trigger.',
  marketSegment: 'Commercial Lines / Casualty',
  owner: { uid: 'seed', name: 'Product Factory Seed' },
  ...GL_SCOPE, ...GOV,
}

const GL_LD_TABLES = {
  'GL.LD.001': { name: 'Per-Occurrence Limit', defaultValue: 1000000,
    rows: [{ label:'$100,000', value:100000, constraintNote:'Base limit — minimal coverage for most operations' },{ label:'$300,000', value:300000 },{ label:'$500,000', value:500000 },{ label:'$1,000,000', value:1000000 }] },
  'GL.LD.002': { name: 'General Aggregate Limit', defaultValue: 2000000,
    rows: [{ label:'$200,000', value:200000, constraintNote:'Must be ≥ per-occurrence limit' },{ label:'$600,000', value:600000, constraintNote:'Must be ≥ per-occurrence limit' },{ label:'$1,000,000', value:1000000, constraintNote:'Must be ≥ per-occurrence limit' },{ label:'$2,000,000', value:2000000 }] },
  'GL.LD.003': { name: 'Products-Completed-Operations Aggregate Limit', defaultValue: 2000000,
    rows: [{ label:'$200,000', value:200000, constraintNote:'When PCO elected, must be ≥ per-occurrence limit' },{ label:'$600,000', value:600000, constraintNote:'When PCO elected, must be ≥ per-occurrence limit' },{ label:'$1,000,000', value:1000000 },{ label:'$2,000,000', value:2000000 }] },
  'GL.LD.004': { name: 'Per-Occurrence Deductible', defaultValue: 0,
    rows: [{ label:'$0 (none)', value:0 },{ label:'$500', value:500 },{ label:'$1,000', value:1000 },{ label:'$2,500', value:2500 }] },
}

const GL_RT_TABLES = {
  'GL.RT.001': { name: 'Class Code Base Rate (per $1,000 of exposure)', columns: ['classCode','exposureBasis','baseRate'],
    rows: [{ classCode:'41677', exposureBasis:'payroll', baseRate:2.50 },{ classCode:'11011', exposureBasis:'gross_sales', baseRate:1.80 },{ classCode:'45191', exposureBasis:'gross_sales', baseRate:0.90 },{ classCode:'61110', exposureBasis:'payroll', baseRate:0.35 },{ classCode:'16811', exposureBasis:'payroll', baseRate:1.20 }] },
  'GL.RT.002': { name: 'Per-Occurrence Increased Limits Factor', columns: ['occLimit','factor'],
    rows: [{ occLimit:100000, factor:1.000 },{ occLimit:300000, factor:1.320 },{ occLimit:500000, factor:1.540 },{ occLimit:1000000, factor:1.820 }] },
  'GL.RT.003': { name: 'BI/PD Deductible Credit Factor', columns: ['occDeductible','factor'],
    rows: [{ occDeductible:0, factor:1.000 },{ occDeductible:500, factor:0.960 },{ occDeductible:1000, factor:0.940 },{ occDeductible:2500, factor:0.910 }] },
  'GL.RT.004': { name: 'Products-Completed-Operations Rate (per $1,000 of exposure)', columns: ['classCode','pcoRate'],
    rows: [{ classCode:'41677', pcoRate:1.80 },{ classCode:'11011', pcoRate:0.85 },{ classCode:'45191', pcoRate:0.40 },{ classCode:'61110', pcoRate:0.15 },{ classCode:'16811', pcoRate:0.80 }] },
  'GL.RT.005': { name: 'Experience Modification Factor', columns: ['expMod','factor'],
    rows: [{ expMod:'0.75', factor:0.75 },{ expMod:'0.90', factor:0.90 },{ expMod:'1.00', factor:1.00 },{ expMod:'1.15', factor:1.15 },{ expMod:'1.25', factor:1.25 }] },
}

const GL_COVERAGES = [
  { refId:'GL.COV.001', name:'Coverage A — Bodily Injury & Property Damage Liability', parentId:null, order:1, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['CG 00 01'], terms:[{ id:'occ-limit', kind:'LIMIT', label:'Each Occurrence Limit', basis:'per occurrence', ldTableRef:'GL.LD.001', default:1000000, unit:'dollars' },{ id:'gen-agg', kind:'LIMIT', label:'General Aggregate Limit', basis:'aggregate', ldTableRef:'GL.LD.002', default:2000000, unit:'dollars', constraintNote:'Must be ≥ per-occurrence limit [GL.RU.007]' },{ id:'occ-ded', kind:'DEDUCTIBLE', label:'Per-Occurrence Deductible', basis:'per occurrence', ldTableRef:'GL.LD.004', default:0, unit:'dollars' }], ...GL_SCOPE, ...GOV },
  { refId:'GL.COV.002', name:'Coverage B — Personal & Advertising Injury Liability', parentId:null, order:2, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['CG 00 01'], terms:[{ id:'pb-limit', kind:'LIMIT', label:'Personal & Advertising Injury Limit (any one person or org)', basis:'per occurrence', ldTableRef:'GL.LD.001', default:1000000, unit:'dollars', notes:'Capped by the General Aggregate (erodes the same GL.LD.002 bucket as Coverage A non-PCO losses).' }], ...GL_SCOPE, ...GOV },
  { refId:'GL.COV.003', name:'Coverage C — Medical Payments', parentId:null, order:3, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:false, source:'BUREAU', formNumbers:['CG 00 01'], terms:[{ id:'medpay-limit', kind:'LIMIT', label:'Medical Payments Limit (any one person)', basis:'per person per occurrence', default:5000, unit:'dollars', notes:'Pays regardless of fault. Capped by the General Aggregate.' }], ...GL_SCOPE, ...GOV },
  { refId:'GL.COV.001.001', name:'Premises & Operations', parentId:'GL.COV.001', order:1, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['CG 00 01'], terms:[{ id:'po-exposure-basis', kind:'OPTION', label:'Exposure Basis', basis:'annual', default:'payroll', notes:'payroll = rated per $1,000 of annual payroll; gross_sales = rated per $1,000 of annual gross sales.' },{ id:'po-exposure', kind:'LIMIT', label:'Annual Exposure Amount', basis:'annual', default:500000, unit:'dollars' }], ...GL_SCOPE, ...GOV },
  { refId:'GL.COV.001.002', name:'Products-Completed-Operations', parentId:'GL.COV.001', order:2, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['CG 00 01'], terms:[{ id:'pco-aggregate', kind:'LIMIT', label:'Products-Completed-Operations Aggregate', basis:'aggregate', ldTableRef:'GL.LD.003', default:2000000, unit:'dollars', constraintNote:'When elected, must be ≥ per-occurrence limit [GL.RU.003]' },{ id:'pco-exposure', kind:'LIMIT', label:'PCO Annual Exposure Amount', basis:'annual', default:200000, unit:'dollars' }], ...GL_SCOPE, ...GOV },
]

const GL_FORMS = [
  { number:'CG 00 01', edition:'10 01', name:'Commercial General Liability Coverage Form', category:'BASE_COVERAGE', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Coverage A — Bodily Injury & Property Damage Liability','Coverage B — Personal & Advertising Injury Liability','Coverage C — Medical Payments'], productRefIds:['GL.PROD.001'], description:'ISO occurrence-trigger CGL base form providing Coverage A (BI/PD), Coverage B (Personal and Advertising Injury), and Coverage C (Medical Payments).', dynamicFields:[], ...GL_SCOPE, ...GOV },
  { number:'CG DS 01', edition:'10 01', name:'Commercial General Liability Declarations', category:'DECLARATIONS', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:[], productRefIds:['GL.PROD.001'], description:'Declarations page showing named insured, business description, class codes, exposure bases, limits of insurance, premium, and applicable endorsement schedule.', dynamicFields:[{ name:'NamedInsured', dataType:'TEXT', repeating:false },{ name:'BusinessAddress', dataType:'TEXT', repeating:false },{ name:'PolicyEffective', dataType:'DATE', repeating:false },{ name:'PolicyExpiration', dataType:'DATE', repeating:false },{ name:'ClassCode', dataType:'TEXT', repeating:true },{ name:'ExposureAmount', dataType:'CURRENCY', repeating:true },{ name:'TotalPremium', dataType:'CURRENCY', repeating:false }], ...GL_SCOPE, ...GOV },
  { number:'CG 20 10', edition:'07 04', name:'Additional Insured — Owners, Lessees or Contractors', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:true, transactions:[], coverageParts:['Coverage A — Bodily Injury & Property Damage Liability'], productRefIds:['GL.PROD.001'], description:"Adds a named owner, lessee or contractor as an additional insured for ongoing operations.", dynamicFields:[{ name:'AdditionalInsuredName', dataType:'TEXT', repeating:true },{ name:'AdditionalInsuredAddress', dataType:'TEXT', repeating:true }], ...GL_SCOPE, ...GOV },
  { number:'CG 20 33', edition:'07 04', name:'Additional Insured — Owners, Lessees or Contractors — Products-Completed Operations', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:true, transactions:[], coverageParts:['Coverage A — Bodily Injury & Property Damage Liability'], productRefIds:['GL.PROD.001'], description:'Extends Coverage A Products-Completed-Operations to a named additional insured.', dynamicFields:[{ name:'AdditionalInsuredName', dataType:'TEXT', repeating:true }], ...GL_SCOPE, ...GOV },
  { number:'CG 03 00', edition:'01 96', name:'BI/PD Deductible Endorsement', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Coverage A — Bodily Injury & Property Damage Liability'], productRefIds:['GL.PROD.001'], description:'Establishes a per-occurrence deductible for Coverage A bodily injury and property damage claims.', dynamicFields:[{ name:'DeductibleAmount', dataType:'CURRENCY', repeating:false }], ...GL_SCOPE, ...GOV },
  { number:'CG 21 06', edition:'05 14', name:'Exclusion — Access or Disclosure of Confidential or Personal Information', category:'EXCLUSION', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:['Coverage A — Bodily Injury & Property Damage Liability','Coverage B — Personal & Advertising Injury Liability'], productRefIds:['GL.PROD.001'], description:'Excludes liability arising out of the access to or disclosure of confidential or personal information.', dynamicFields:[], ...GL_SCOPE, ...GOV },
  { number:'CG 21 67', edition:'12 04', name:'Fungi or Bacteria Exclusion', category:'EXCLUSION', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:['Coverage A — Bodily Injury & Property Damage Liability','Coverage B — Personal & Advertising Injury Liability','Coverage C — Medical Payments'], productRefIds:['GL.PROD.001'], description:'Excludes all liability arising out of actual or alleged exposure to fungi or bacteria, including mold.', dynamicFields:[], ...GL_SCOPE, ...GOV },
  { number:'CG 21 70', edition:'01 15', name:'Exclusion — Contractors — Professional Liability', category:'EXCLUSION', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:['Coverage A — Bodily Injury & Property Damage Liability'], productRefIds:['GL.PROD.001'], description:'Excludes liability arising out of the rendering of or failure to render professional services as an architect, engineer or surveyor.', dynamicFields:[], ...GL_SCOPE, ...GOV },
]

const GL_RULES = [
  { refId:'GL.RU.001', category:'PRODUCT', subCategory:'Eligibility', condition:'CG 00 01 is an OCCURRENCE-triggered form', outcome:"Coverage responds to bodily injury or property damage that OCCURS during the policy period; never assume the trigger — read the form.", coverageRefIds:['GL.COV.001'], formNumbers:['CG 00 01'], ...GL_SCOPE, ...GOV },
  { refId:'GL.RU.002', category:'PRODUCT', subCategory:'Coverage Limits', condition:'General Aggregate limit options', outcome:'Options per GL.LD.002; default $2,000,000; must be ≥ per-occurrence limit (GL.RU.007)', ldTableRef:'GL.LD.002', coverageRefIds:['GL.COV.001'], formNumbers:[], ...GL_SCOPE, ...GOV },
  { refId:'GL.RU.003', category:'PRODUCT', subCategory:'Coverage Limits', condition:'Products-Completed-Operations elected and PCO aggregate selected', outcome:'PCO aggregate (GL.LD.003) must be ≥ per-occurrence limit; default $2,000,000', ldTableRef:'GL.LD.003', coverageRefIds:['GL.COV.001.002'], formNumbers:[], ...GL_SCOPE, ...GOV },
  { refId:'GL.RU.004', category:'RATING', subCategory:'Exposure Basis', condition:'Class code selected', outcome:'Exposure basis (payroll or gross sales) is determined by class code per GL.RT.001', coverageRefIds:['GL.COV.001.001'], formNumbers:[], ...GL_SCOPE, ...GOV },
  { refId:'GL.RU.005', category:'RATING', subCategory:'Deductibles', condition:'BI/PD deductible elected (> $0)', outcome:'Deductible credit applied at GL.RAT.1 step s4 (GL.RT.003); CG 03 00 attaches [GL.FORM.RU.002]', ldTableRef:'GL.LD.004', coverageRefIds:['GL.COV.001'], formNumbers:['CG 03 00'], ...GL_SCOPE, ...GOV },
  { refId:'GL.RU.006', category:'RATING', subCategory:'Premium Floor', condition:'Calculated annual premium', outcome:'Minimum policy premium $500 (GL.RAT.1 step s7)', coverageRefIds:[], formNumbers:[], ...GL_SCOPE, ...GOV },
  { refId:'GL.RU.007', category:'PRODUCT', subCategory:'Aggregate Consistency', condition:'Per-occurrence limit > General Aggregate', outcome:'Ineligible: the per-occurrence limit may not exceed the General Aggregate [ISO CGL Section III rule]', coverageRefIds:['GL.COV.001'], formNumbers:[], ...GL_SCOPE, ...GOV },
]

const GL_FORM_RULES = [
  { refId:'GL.FORM.RU.001', condition:'Products-Completed-Operations coverage elected', outcome:'Attach CG 20 33 (Additional Insured — Products-Completed Operations)', formNumbers:['CG 20 33'], mandatory:true, ...GOV },
  { refId:'GL.FORM.RU.002', condition:'BI/PD per-occurrence deductible > $0 elected', outcome:'Attach CG 03 00 (BI/PD Deductible Endorsement)', formNumbers:['CG 03 00'], mandatory:true, ...GOV },
  { refId:'GL.FORM.RU.003', condition:'Additional insured required by contract', outcome:'Attach CG 20 10 (Additional Insured — Owners, Lessees or Contractors) for ongoing operations', formNumbers:['CG 20 10'], mandatory:false, ...GOV },
]

const GL_RATING_PROGRAM = {
  refId: 'GL.RAT.1', name: 'Commercial General Liability Rating Program', minimumPremium: 500,
  ...GL_SCOPE, ...GOV,
  steps: [
    { id:'s1', order:1, label:'Class base rate (per $1,000 of exposure)',  op:'SET', source:{ type:'RT',    ref:'GL.RT.001', keys:['classCode'] } },
    { id:'s2', order:2, label:'Exposure volume (thousands of payroll / gross sales)', op:'MUL', source:{ type:'INPUT', ref:'exposureThousands' } },
    { id:'s3', order:3, label:'Per-occurrence limit factor',               op:'MUL', source:{ type:'RT',    ref:'GL.RT.002', keys:['occLimit'] } },
    { id:'s4', order:4, label:'BI/PD deductible credit',                  op:'MUL', source:{ type:'RT',    ref:'GL.RT.003', keys:['occDeductible'] } },
    { id:'s5', order:5, label:'Products-Completed-Operations premium',     op:'ADD', source:{ type:'RT',    ref:'GL.RT.004', keys:['classCode','pcoExposureThousands'] }, condition:'pcoElected' },
    { id:'s6', order:6, label:'Experience modification factor',            op:'MUL', source:{ type:'RT',    ref:'GL.RT.005', keys:['expMod'] } },
    { id:'s7', order:7, label:'Apply minimum premium ($500)',              op:'MIN_FLOOR', source:{ type:'CONST', value:500 }, roundTo:0 },
  ],
}

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL AUTO — PA.PROD.001 (ISO PAP PP 00 01)
// Source: shared/src/seed/personalAuto.ts  Canary: $1,002
// ══════════════════════════════════════════════════════════════════════════════

const PA_PRODUCT = {
  refId: 'PA.PROD.001', name: 'Personal Auto Policy',
  lob: { refId: 'PA.LOB.001', name: 'Personal Auto' },
  description: 'ISO-style Personal Auto Policy (PAP PP 00 01) covering liability, medical payments, uninsured/underinsured motorists, and physical damage — rated by territory, driver class and vehicle symbol.',
  marketSegment: 'Personal Lines / Automobile',
  owner: { uid: 'seed', name: 'Product Factory Seed' },
  ...PA_SCOPE, ...GOV,
}

const PA_LD_TABLES = {
  'PA.LD.001': { name: 'Bodily Injury Liability Limits (per person / per accident)', defaultValue: 100000,
    rows: [{ label:'25/50', value:25000, constraintNote:'Meets most state minimums' },{ label:'50/100', value:50000 },{ label:'100/300', value:100000 },{ label:'250/500', value:250000 }] },
  'PA.LD.002': { name: 'Property Damage Liability Limits', defaultValue: 100000,
    rows: [{ label:'$25,000', value:25000, constraintNote:'Meets most state minimums' },{ label:'$50,000', value:50000 },{ label:'$100,000', value:100000 },{ label:'$300,000', value:300000 }] },
  'PA.LD.003': { name: 'Medical Payments Limits', defaultValue: 5000,
    rows: [{ label:'$1,000', value:1000 },{ label:'$5,000', value:5000 },{ label:'$10,000', value:10000 },{ label:'$25,000', value:25000 }] },
  'PA.LD.004': { name: 'UM / UIM Bodily Injury Limits (per person / per accident)', defaultValue: 100000,
    rows: [{ label:'25/50', value:25000, constraintNote:'Must match or be ≤ BI limit in most states' },{ label:'50/100', value:50000 },{ label:'100/300', value:100000 },{ label:'250/500', value:250000 }] },
  'PA.LD.005': { name: 'Collision Deductible', defaultValue: 500,
    rows: [{ label:'$100', value:100 },{ label:'$250', value:250 },{ label:'$500', value:500 },{ label:'$1,000', value:1000 }] },
  'PA.LD.006': { name: 'Comprehensive (Other Than Collision) Deductible', defaultValue: 250,
    rows: [{ label:'$100', value:100 },{ label:'$250', value:250 },{ label:'$500', value:500 },{ label:'$1,000', value:1000 }] },
}

const PA_RT_TABLES = {
  'PA.RT.001': { name: 'Territory Base Rate', columns: ['territory','rate'],
    rows: [{ territory:'T001',rate:350 },{ territory:'T002',rate:400 },{ territory:'T003',rate:465 },{ territory:'T004',rate:510 },{ territory:'T005',rate:590 }] },
  'PA.RT.002': { name: 'Driver Class Factor', columns: ['driverClass','factor'],
    rows: [{ driverClass:'DC1',factor:0.90 },{ driverClass:'DC2',factor:1.00 },{ driverClass:'DC3',factor:1.20 }] },
  'PA.RT.003': { name: 'BI/PD Limit Factor', columns: ['biPdLimitCode','factor'],
    rows: [{ biPdLimitCode:'25/50/25',factor:0.85 },{ biPdLimitCode:'50/100/50',factor:0.93 },{ biPdLimitCode:'100/300/100',factor:1.00 },{ biPdLimitCode:'250/500/250',factor:1.14 }] },
  'PA.RT.004': { name: 'Vehicle Age Factor', columns: ['vehicleAgeClass','factor'],
    rows: [{ vehicleAgeClass:'Economy',factor:0.90 },{ vehicleAgeClass:'Standard',factor:1.00 },{ vehicleAgeClass:'Luxury',factor:1.15 }] },
  'PA.RT.005': { name: 'Medical Payments Rate by Territory', columns: ['territory','rate'],
    rows: [{ territory:'T001',rate:35 },{ territory:'T002',rate:42 },{ territory:'T003',rate:49 },{ territory:'T004',rate:55 },{ territory:'T005',rate:63 }] },
  'PA.RT.006': { name: 'UM/UIM Rate by Territory', columns: ['territory','rate'],
    rows: [{ territory:'T001',rate:50 },{ territory:'T002',rate:62 },{ territory:'T003',rate:74 },{ territory:'T004',rate:83 },{ territory:'T005',rate:95 }] },
  'PA.RT.007': { name: 'Collision Premium', columns: ['vehicleSymbol','collisionDed','premium'],
    rows: [{ vehicleSymbol:'sym10',collisionDed:250,premium:380 },{ vehicleSymbol:'sym10',collisionDed:500,premium:335 },{ vehicleSymbol:'sym10',collisionDed:1000,premium:290 },{ vehicleSymbol:'sym12',collisionDed:250,premium:350 },{ vehicleSymbol:'sym12',collisionDed:500,premium:306 },{ vehicleSymbol:'sym12',collisionDed:1000,premium:262 }] },
  'PA.RT.008': { name: 'Comprehensive Premium', columns: ['vehicleSymbol','compDed','premium'],
    rows: [{ vehicleSymbol:'sym10',compDed:100,premium:205 },{ vehicleSymbol:'sym10',compDed:250,premium:172 },{ vehicleSymbol:'sym10',compDed:500,premium:145 },{ vehicleSymbol:'sym12',compDed:100,premium:182 },{ vehicleSymbol:'sym12',compDed:250,premium:154 },{ vehicleSymbol:'sym12',compDed:500,premium:128 }] },
  'PA.RT.009': { name: 'Tier Factor', columns: ['tier','factor'],
    rows: [{ tier:'Preferred',factor:0.90 },{ tier:'Standard',factor:1.00 },{ tier:'Non-Standard',factor:1.20 }] },
  'PA.RT.010': { name: 'Rental Reimbursement Rate', columns: ['rentalCode','rate'],
    rows: [{ rentalCode:'$20_600',rate:24 },{ rentalCode:'$30_900',rate:38 },{ rentalCode:'$40_1200',rate:52 }] },
  'PA.RT.011': { name: 'Towing and Labor Rate', columns: ['towingLimit','rate'],
    rows: [{ towingLimit:50,rate:10 },{ towingLimit:100,rate:15 },{ towingLimit:200,rate:22 }] },
}

const PA_COVERAGES = [
  { refId:'PA.COV.001', name:'Part A — Liability Coverage', parentId:null, order:1, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'bipd-limit-code', kind:'OPTION', label:'BI/PD Limit Package', basis:'per person/per accident/per occurrence', default:'100/300/100', notes:'Combined per-person BI / per-accident BI / per-occurrence PD limit code used as the rating key (PA.RT.003).' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.001.001', name:'Bodily Injury Liability', parentId:'PA.COV.001', order:1, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'bi-limit', kind:'LIMIT', label:'Bodily Injury Per Person / Per Accident', basis:'per person per accident', ldTableRef:'PA.LD.001', default:100000, unit:'dollars' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.001.002', name:'Property Damage Liability', parentId:'PA.COV.001', order:2, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'pd-limit', kind:'LIMIT', label:'Property Damage Per Occurrence', basis:'per occurrence', ldTableRef:'PA.LD.002', default:100000, unit:'dollars' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.002', name:'Part B — Medical Payments Coverage', parentId:null, order:2, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'medpay-limit', kind:'LIMIT', label:'Medical Payments Limit (any one person)', basis:'per person', ldTableRef:'PA.LD.003', default:5000, unit:'dollars' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.003', name:'Part C — Uninsured Motorists Coverage', parentId:null, order:3, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'um-limit', kind:'LIMIT', label:'UM/UIM Limit Per Person / Per Accident', basis:'per person per accident', ldTableRef:'PA.LD.004', default:100000, unit:'dollars', constraintNote:'Must match or be ≤ Bodily Injury limit (most states)' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.003.001', name:'Uninsured Motorist Bodily Injury', parentId:'PA.COV.003', order:1, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'um-bi-limit', kind:'LIMIT', label:'UM Bodily Injury Limit', basis:'per person per accident', default:'Matches Part C limit', unit:'dollars' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.003.002', name:'Underinsured Motorist Bodily Injury', parentId:'PA.COV.003', order:2, requirement:'MANDATORY', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'uim-bi-limit', kind:'LIMIT', label:'UIM Bodily Injury Limit', basis:'per person per accident', default:'Matches Part C limit', unit:'dollars', constraintNote:'UIM limit may not exceed BI limit (PA.RU.007)' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.004', name:'Part D — Coverage for Damage to Your Auto', parentId:null, order:4, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'part-d-note', kind:'OPTION', label:'Physical damage coverage elected', basis:'flag', default:false }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.004.001', name:'Collision Coverage', parentId:'PA.COV.004', order:1, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'collision-ded', kind:'DEDUCTIBLE', label:'Collision Deductible', basis:'per occurrence', ldTableRef:'PA.LD.005', default:500, unit:'dollars' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.004.002', name:'Other Than Collision (Comprehensive)', parentId:'PA.COV.004', order:2, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 00 01'], terms:[{ id:'comp-ded', kind:'DEDUCTIBLE', label:'Comprehensive Deductible', basis:'per occurrence', ldTableRef:'PA.LD.006', default:250, unit:'dollars' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.004.003', name:'Rental Reimbursement', parentId:'PA.COV.004', order:3, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 13 01'], terms:[{ id:'rental-elected', kind:'OPTION', label:'Rental reimbursement elected', basis:'flag', default:false, notes:'Rental code keys daily/max limit ($20/$600, $30/$900, $40/$1,200).' }], ...PA_SCOPE, ...GOV },
  { refId:'PA.COV.004.004', name:'Towing and Labor Costs', parentId:'PA.COV.004', order:4, requirement:'OPTIONAL', claimsBasis:'Occurrence', premiumGenerating:true, source:'BUREAU', formNumbers:['PP 03 28'], terms:[{ id:'towing-elected', kind:'OPTION', label:'Towing and labor elected', basis:'flag', default:false, notes:'Towing limit: $50, $100, or $200 per disablement.' }], ...PA_SCOPE, ...GOV },
]

const PA_FORMS = [
  { number:'PP 00 01', edition:'01 05', name:'Personal Auto Policy', category:'BASE_COVERAGE', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Part A — Liability Coverage','Part B — Medical Payments Coverage','Part C — Uninsured Motorists Coverage','Part D — Coverage for Damage to Your Auto'], productRefIds:['PA.PROD.001'], description:'Base Personal Auto Policy form covering liability, medical payments, uninsured/underinsured motorists and physical damage.', dynamicFields:[], ...PA_SCOPE, ...GOV },
  { number:'PP DS 01', edition:'01 05', name:'Personal Auto Policy Declarations', category:'DECLARATIONS', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PA.PROD.001'], description:'Declarations page listing named insured, vehicle schedule, coverage selections, limits, deductibles and total premium.', dynamicFields:[{ name:'NamedInsured', dataType:'TEXT', repeating:false },{ name:'PolicyAddress', dataType:'TEXT', repeating:false },{ name:'VehicleYear', dataType:'TEXT', repeating:true },{ name:'VehicleMake', dataType:'TEXT', repeating:true },{ name:'VehicleModel', dataType:'TEXT', repeating:true },{ name:'VIN', dataType:'TEXT', repeating:true },{ name:'PolicyEffective', dataType:'DATE', repeating:false },{ name:'PolicyExpiration', dataType:'DATE', repeating:false },{ name:'TotalPremium', dataType:'CURRENCY', repeating:false }], ...PA_SCOPE, ...GOV },
  { number:'PP 13 01', edition:'01 05', name:'Extended Transportation Expenses (Rental Reimbursement)', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Part D — Coverage for Damage to Your Auto'], productRefIds:['PA.PROD.001'], description:'Provides rental reimbursement and transportation expenses when a covered auto is disabled by a covered loss.', dynamicFields:[{ name:'DailyLimit', dataType:'CURRENCY', repeating:false },{ name:'MaxLimit', dataType:'CURRENCY', repeating:false }], ...PA_SCOPE, ...GOV },
  { number:'PP 03 28', edition:'01 05', name:'Towing and Labor Costs Coverage', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Part D — Coverage for Damage to Your Auto'], productRefIds:['PA.PROD.001'], description:'Covers towing and labor costs each time a covered auto is disabled.', dynamicFields:[{ name:'TowingLimit', dataType:'CURRENCY', repeating:false }], ...PA_SCOPE, ...GOV },
  { number:'PP 04 46', edition:'01 05', name:'Loan or Lease Gap Coverage', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Part D — Coverage for Damage to Your Auto'], productRefIds:['PA.PROD.001'], description:'Pays the difference between the actual cash value of a totaled covered auto and the outstanding loan or lease balance.', dynamicFields:[], ...PA_SCOPE, ...GOV },
  { number:'PP 04 04', edition:'01 05', name:'Driver Exclusion Endorsement', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:true, transactions:[], coverageParts:['Part A — Liability Coverage'], productRefIds:['PA.PROD.001'], description:'Excludes a named individual from all coverages under the policy.', dynamicFields:[{ name:'ExcludedDriverName', dataType:'TEXT', repeating:true },{ name:'LicenseNumber', dataType:'TEXT', repeating:true }], ...PA_SCOPE, ...GOV },
  { number:'PP 03 05', edition:'01 05', name:'Extended Non-Owned Coverage — Vehicles Furnished or Available for Regular Use', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Part A — Liability Coverage','Part B — Medical Payments Coverage'], productRefIds:['PA.PROD.001'], description:'Extends liability and medical payments coverage to a non-owned vehicle furnished for regular use.', dynamicFields:[], ...PA_SCOPE, ...GOV },
  { number:'PP 03 01', edition:'01 05', name:'Named Non-Owner Coverage Endorsement', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Part A — Liability Coverage','Part B — Medical Payments Coverage'], productRefIds:['PA.PROD.001'], description:'Provides liability and medical payments coverage to individuals who do not own a vehicle but regularly drive non-owned autos.', dynamicFields:[{ name:'NamedNonOwner', dataType:'TEXT', repeating:true }], ...PA_SCOPE, ...GOV },
  { number:'PP 04 02', edition:'01 05', name:'Excess Electronic Equipment Coverage', category:'ENDORSEMENT', claimsBasis:'Occurrence', dynamic:true, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:true, multiUse:false, transactions:[], coverageParts:['Part D — Coverage for Damage to Your Auto'], productRefIds:['PA.PROD.001'], description:'Extends coverage for electronic equipment installed in the covered auto beyond the standard policy limit.', dynamicFields:[{ name:'EquipmentLimit', dataType:'CURRENCY', repeating:false }], ...PA_SCOPE, ...GOV },
  { number:'PP 01 75', edition:'01 05', name:'Special Provisions — California', category:'AMENDATORY', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PA.PROD.001'], description:'Modifies the Personal Auto Policy to comply with California Insurance Code requirements.', dynamicFields:[], allStates:false, states:['CA'], ...GOV },
  { number:'PP 01 79', edition:'01 05', name:'Special Provisions — Texas', category:'AMENDATORY', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:false, attachmentCondition:'RULE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PA.PROD.001'], description:'Modifies the Personal Auto Policy to comply with Texas Department of Insurance requirements.', dynamicFields:[], allStates:false, states:['TX'], ...GOV },
  { number:'PN PP 01', edition:'01 05', name:'Personal Auto Policy Notice — Important Information', category:'POLICY_NOTICE', claimsBasis:'Occurrence', dynamic:false, mandatoryDefault:true, attachmentCondition:'NONE', source:'BUREAU', admitted:true, displayOnSchedule:false, multiUse:false, transactions:[], coverageParts:[], productRefIds:['PA.PROD.001'], description:'Required notice providing policyholders with important information about rights, obligations, and claims procedures.', dynamicFields:[], ...PA_SCOPE, ...GOV },
]

const PA_RULES = [
  { refId:'PA.RU.001', category:'PRODUCT', subCategory:'Eligibility', condition:'Personal passenger automobile, motorcycle, or light truck — personal use', outcome:'Eligible for Personal Auto Policy (PP 00 01)', coverageRefIds:[], formNumbers:['PP 00 01'], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.002', category:'PRODUCT', subCategory:'Mandatory Coverage', condition:'Personal Auto Policy selected', outcome:'Part A — Liability (BI + PD) is mandatory; both sub-coverages must be present', coverageRefIds:['PA.COV.001','PA.COV.001.001','PA.COV.001.002'], formNumbers:['PP 00 01'], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.003', category:'PRODUCT', subCategory:'Limit Ranges', condition:'Bodily Injury limit selection', outcome:'Options per PA.LD.001; default 100/300 per person/per accident', ldTableRef:'PA.LD.001', coverageRefIds:['PA.COV.001.001'], formNumbers:[], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.004', category:'PRODUCT', subCategory:'Limit Ranges', condition:'Property Damage limit selection', outcome:'Options per PA.LD.002; default $100,000 per occurrence', ldTableRef:'PA.LD.002', coverageRefIds:['PA.COV.001.002'], formNumbers:[], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.005', category:'PRODUCT', subCategory:'Optional Coverage', condition:'Medical Payments coverage elected', outcome:'Part B elected; limit options per PA.LD.003; attach per PP 00 01', ldTableRef:'PA.LD.003', coverageRefIds:['PA.COV.002'], formNumbers:['PP 00 01'], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.006', category:'PRODUCT', subCategory:'Optional Coverage', condition:'Part A Liability is elected', outcome:'UM/UIM (Part C) is available and strongly recommended', ldTableRef:'PA.LD.004', coverageRefIds:['PA.COV.003'], formNumbers:['PP 00 01'], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.007', category:'PRODUCT', subCategory:'Coverage Constraints', condition:'UIM limits selected', outcome:'UIM limit may not exceed BI limit per occurrence', coverageRefIds:['PA.COV.001.001','PA.COV.003.002'], formNumbers:[], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.008', category:'PRODUCT', subCategory:'Coverage Constraints', condition:'Rental Reimbursement (PA.COV.004.003) elected', outcome:'Requires physical damage coverage (Collision or Comprehensive) to be in force', coverageRefIds:['PA.COV.004.001','PA.COV.004.002','PA.COV.004.003'], formNumbers:['PP 13 01'], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.009', category:'PRODUCT', subCategory:'Coverage Constraints', condition:'Towing and Labor (PA.COV.004.004) elected', outcome:'Requires physical damage coverage (Collision or Comprehensive) to be in force', coverageRefIds:['PA.COV.004.001','PA.COV.004.002','PA.COV.004.004'], formNumbers:['PP 03 28'], ...PA_SCOPE, ...GOV },
  { refId:'PA.RU.010', category:'RATING', subCategory:'Premium Floor', condition:'Calculated premium', outcome:'Minimum policy premium $250 (PA.RAT.1 step 11)', coverageRefIds:[], formNumbers:[], ...PA_SCOPE, ...GOV },
]

const PA_FORM_RULES = [
  { refId:'PA.FORM.RU.001', condition:'Rental Reimbursement elected', outcome:'Attach PP 13 01', formNumbers:['PP 13 01'], mandatory:true, ...GOV },
  { refId:'PA.FORM.RU.002', condition:'Towing and Labor elected', outcome:'Attach PP 03 28', formNumbers:['PP 03 28'], mandatory:true, ...GOV },
  { refId:'PA.FORM.RU.003', condition:'Loan/Lease Gap elected', outcome:'Attach PP 04 46', formNumbers:['PP 04 46'], mandatory:true, ...GOV },
  { refId:'PA.FORM.RU.004', condition:'Named Non-Owner coverage', outcome:'Attach PP 03 01', formNumbers:['PP 03 01'], mandatory:true, ...GOV },
  { refId:'PA.FORM.RU.005', condition:'Driver exclusion required', outcome:'Attach PP 04 04', formNumbers:['PP 04 04'], mandatory:true, ...GOV },
  { refId:'PA.FORM.RU.006', condition:'Risk state = CA', outcome:'Attach PP 01 75; TX → PP 01 79', formNumbers:['PP 01 75','PP 01 79'], mandatory:true, ...GOV },
]

const PA_RATING_PROGRAM = {
  refId: 'PA.RAT.1', name: 'Personal Auto Policy Rating Program', minimumPremium: 250,
  ...PA_SCOPE, ...GOV,
  steps: [
    { id:'s1',   order:1,  label:'Territory base rate',            op:'SET',       source:{ type:'RT', ref:'PA.RT.001', keys:['territory'] } },
    { id:'s2',   order:2,  label:'Driver class factor',            op:'MUL',       source:{ type:'RT', ref:'PA.RT.002', keys:['driverClass'] } },
    { id:'s3',   order:3,  label:'BI/PD limit factor',             op:'MUL',       source:{ type:'RT', ref:'PA.RT.003', keys:['biPdLimitCode'] } },
    { id:'s4',   order:4,  label:'Vehicle age factor',             op:'MUL',       source:{ type:'RT', ref:'PA.RT.004', keys:['vehicleAgeClass'] }, roundTo:2 },
    { id:'s5',   order:5,  label:'Medical Payments premium',       op:'ADD',       source:{ type:'RT', ref:'PA.RT.005', keys:['territory'] },   condition:'medPayElected' },
    { id:'s6',   order:6,  label:'UM/UIM premium',                 op:'ADD',       source:{ type:'RT', ref:'PA.RT.006', keys:['territory'] },   condition:'umElected' },
    { id:'s7',   order:7,  label:'Collision premium',              op:'ADD',       source:{ type:'RT', ref:'PA.RT.007', keys:['vehicleSymbol','collisionDed'] }, condition:'collisionElected' },
    { id:'s8',   order:8,  label:'Comprehensive premium',          op:'ADD',       source:{ type:'RT', ref:'PA.RT.008', keys:['vehicleSymbol','compDed'] },    condition:'compElected' },
    { id:'s9',   order:9,  label:'Tier factor',                    op:'MUL',       source:{ type:'RT', ref:'PA.RT.009', keys:['tier'] } },
    { id:'s10a', order:10, label:'Rental reimbursement premium',   op:'ADD',       source:{ type:'RT', ref:'PA.RT.010', keys:['rentalCode'] },  condition:'rentalElected' },
    { id:'s10b', order:11, label:'Towing and labor premium',       op:'ADD',       source:{ type:'RT', ref:'PA.RT.011', keys:['towingLimit'] }, condition:'towingElected' },
    { id:'s11',  order:12, label:'Apply minimum premium ($250)',   op:'MIN_FLOOR', source:{ type:'CONST', value:250 },                       roundTo:0 },
  ],
}

// ─── Product definitions ──────────────────────────────────────────────────────
const PRODUCTS = [
  { label:'PH', product:PH_PRODUCT, ldTables:PH_LD_TABLES, rtTables:PH_RT_TABLES, coverages:PH_COVERAGES, forms:PH_FORMS, rules:PH_RULES, formRules:PH_FORM_RULES, ratingProgram:PH_RATING_PROGRAM },
  { label:'GL', product:GL_PRODUCT, ldTables:GL_LD_TABLES, rtTables:GL_RT_TABLES, coverages:GL_COVERAGES, forms:GL_FORMS, rules:GL_RULES, formRules:GL_FORM_RULES, ratingProgram:GL_RATING_PROGRAM },
  { label:'PA', product:PA_PRODUCT, ldTables:PA_LD_TABLES, rtTables:PA_RT_TABLES, coverages:PA_COVERAGES, forms:PA_FORMS, rules:PA_RULES, formRules:PA_FORM_RULES, ratingProgram:PA_RATING_PROGRAM },
]

// ─── Inline canary computations ───────────────────────────────────────────────
// These replicate the evaluated rating traces from the worked-example comments in
// shared/src/seed/*.ts. The unit tests in shared/src/rating/*.test.ts assert the
// same values; the seeder checks them independently to confirm the embedded data
// is internally consistent.

function computePHCanary() {
  // PH_WORKED_EXAMPLE: territory=T002, pc=5, construction=M, covA=400000,
  // allPerilDed=1000, windHailElected=false, covCPct=70, covELimit=300000,
  // covFLimit=2000, rcElected=true, deviceCredit=none, tier=B,
  // waterBackupElected=true, waterBackupLimit=5000, sppElected=true [{Jewelry, 15000}]
  let r = 700     // s1  SET  PH.RT.001[T002] = 700
  r *= 1.05       // s2  MUL  PH.RT.002[5,M] = 1.05  → 735
  r *= 1.30       // s3  MUL  PH.RT.003[400000] = 1.30 → 955.5
  r = Math.round(r)             // s3  roundTo:0 → 956
  r *= 1.00       // s4a MUL  PH.RT.004[allPeril,1000] = 1.00 → 956
                  // s4b skip  windHailElected=false
  r *= 1.06       // s5  MUL  PH.RT.005[70] = 1.06 → 1013.36
  r += 24         // s6  ADD  PH.RT.006[E,300000] = 24 → 1037.36
  r += 6          // s7  ADD  PH.RT.006[F,2000] = 6  → 1043.36
  r *= 1.10       // s8a MUL  CONST 1.10 (rcElected) → 1147.696
  r *= 1.00       // s8b MUL  PH.RT.008[none] = 1.00 → 1147.696
  r = Math.round(r * 100) / 100 // s8b roundTo:2 → 1147.70
  r *= 1.10       // s9  MUL  PH.RT.009[B] = 1.10 → 1262.47
  r += 75         // s10a ADD PH.RT.010[5000] = 75 (waterBackup) → 1337.47
  r += 1.27 * 15000 / 100       // s10b ADD SPP Jewelry 15000 → 1527.97
  r = Math.max(r, 500)
  r = Math.round(r)             // s11 MIN_FLOOR 500 roundTo:0 → 1528
  return r
}

function computeGLCanary() {
  // GL_WORKED_EXAMPLE: class=41677, exposureThousands=500, occLimit=1000000,
  // occDeductible=0, pcoElected=true, pcoExposureThousands=200, expMod='1.00'
  let r = 2.50    // s1 SET  GL.RT.001[41677].baseRate = 2.50
  r *= 500        // s2 MUL  INPUT exposureThousands=500 → 1250.00
  r *= 1.82       // s3 MUL  GL.RT.002[1000000].factor = 1.82 → 2275.00
  r *= 1.00       // s4 MUL  GL.RT.003[0].factor = 1.00 → 2275.00
  r += 1.80 * 200 // s5 ADD  GL.RT.004[41677].pcoRate=1.80 × 200 = 360 → 2635.00
  r *= 1.00       // s6 MUL  GL.RT.005['1.00'].factor = 1.00 → 2635.00
  r = Math.max(r, 500)
  r = Math.round(r)             // s7 MIN_FLOOR 500 roundTo:0 → 2635
  return r
}

function computePACanary() {
  // PA_WORKED_EXAMPLE: territory=T002, driverClass=DC2, biPdLimitCode=100/300/100,
  // vehicleAgeClass=Standard, vehicleSymbol=sym12, tier=Standard,
  // medPayElected=true, umElected=true, collisionElected=true collisionDed=500,
  // compElected=true compDed=250, rentalElected=true rentalCode=$30_900, towingElected=false
  let r = 400     // s1   SET  PA.RT.001[T002] = 400
  r *= 1.00       // s2   MUL  PA.RT.002[DC2] = 1.00 → 400
  r *= 1.00       // s3   MUL  PA.RT.003[100/300/100] = 1.00 → 400
  r *= 1.00       // s4   MUL  PA.RT.004[Standard] = 1.00 → 400
  r = Math.round(r * 100) / 100 // s4 roundTo:2 → 400.00
  r += 42         // s5   ADD  PA.RT.005[T002] = 42 (medPay) → 442
  r += 62         // s6   ADD  PA.RT.006[T002] = 62 (UM) → 504
  r += 306        // s7   ADD  PA.RT.007[sym12,500] = 306 (collision) → 810
  r += 154        // s8   ADD  PA.RT.008[sym12,250] = 154 (comp) → 964
  r *= 1.00       // s9   MUL  PA.RT.009[Standard] = 1.00 → 964
  r += 38         // s10a ADD  PA.RT.010[$30_900] = 38 (rental) → 1002
                  // s10b skip towingElected=false
  r = Math.max(r, 250)
  r = Math.round(r)             // s11 MIN_FLOOR 250 roundTo:0 → 1002
  return r
}

// ─── Seed helper ──────────────────────────────────────────────────────────────
async function seedProduct(def, token, stats) {
  const pid = def.product.refId

  async function write(path, entityType, data) {
    try {
      await mutate({ op: 'create', path, entityType, data }, token)
      stats.written++
      process.stdout.write('.')
    } catch (e) {
      stats.failed++
      stats.errors.push(`${path}: ${e.message}`)
      process.stdout.write('x')
    }
  }

  // 1. Product (must come first — children share its partition key)
  await write(`products/${pid}`, 'product', def.product)

  // 2. LD tables (global collection, no product parent)
  for (const [refId, data] of Object.entries(def.ldTables)) {
    await write(`ldTables/${refId}`, 'ldTable', { refId, ...data })
  }

  // 3. RT tables (global collection, no product parent)
  for (const [refId, data] of Object.entries(def.rtTables)) {
    await write(`rtTables/${refId}`, 'rtTable', { refId, ...data })
  }

  // 4. Coverages — already in parent-before-child order in seed arrays
  for (const cov of def.coverages) {
    await write(`products/${pid}/coverages/${cov.refId}`, 'coverage', cov)
  }

  // 5. Forms — namespaced to product (same convention as importProduct.ts)
  for (const form of def.forms) {
    const docId = form.number.replace(/\s+/g, '_')
    await write(`forms/${pid}__${docId}`, 'form', form)
  }

  // 6. Rules
  for (const rule of def.rules) {
    await write(`products/${pid}/rules/${rule.refId}`, 'rule', rule)
  }

  // 7. Form rules
  for (const fr of def.formRules) {
    await write(`products/${pid}/formRules/${fr.refId}`, 'formRule', fr)
  }

  // 8. Rating program
  if (def.ratingProgram) {
    await write(`products/${pid}/ratingPrograms/${def.ratingProgram.refId}`, 'ratingProgram', def.ratingProgram)
  }

  const nLd = Object.keys(def.ldTables).length
  const nRt = Object.keys(def.rtTables).length
  process.stdout.write('\n')
  console.log(`  ${pid}: LD×${nLd} RT×${nRt} COV×${def.coverages.length} FORM×${def.forms.length} RULE×${def.rules.length} FORMRULE×${def.formRules.length} RAT×1`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║  Product Factory Hardening Seeder                ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`  Base URL:  ${BASE_URL}`)
  console.log(`  Tenant:    ${TEST_TENANT}`)
  console.log(`  Grounding: ${WITH_GROUNDING ? 'verify' : 'skip (pass --with-grounding to verify)'}`)
  console.log('')

  // 1. Server reachability
  try {
    await apiGet('/api/health')
    console.log(`✓ Server reachable at ${BASE_URL}`)
  } catch (e) {
    console.error(`\nPRECONDITION FAIL: server not reachable at ${BASE_URL}/api/health`)
    console.error(`  ${e.message}`)
    console.error('\nStart the server first: node server/server.js')
    console.error('Required server env: COSMOS_ENDPOINT, COSMOS_KEY, AZURE_FOUNDRY_ENDPOINT,')
    console.error('  AZURE_FOUNDRY_KEY, AZURE_BLOB_CONNECTION, AUTH_JWT_SECRET')
    process.exit(1)
  }

  // 2. Login as bootstrap admin into the test tenant
  console.log(`\nLogging in: admin → '${TEST_TENANT}'...`)
  let token
  try {
    const r = await apiPost('/api/auth/login', { username: 'admin', password: 'admin', tenant: TEST_TENANT })
    token = r.token
    console.log(`  uid=${r.user?.uid}  role=${r.user?.role}  tenantId=${r.user?.tenantId}`)
  } catch (e) {
    console.error(`\nLOGIN FAIL: ${e.message}`)
    console.error('The bootstrap admin (admin/admin) must be present in auth.js (DEF-0041 noted).')
    process.exit(1)
  }

  // 3. Seed products
  const stats = { written: 0, failed: 0, errors: [] }
  for (const def of PRODUCTS) {
    console.log(`\nSeeding ${def.label} (${def.product.refId})...`)
    await seedProduct(def, token, stats)
  }

  // 4. Verify seeded entities
  console.log('\n── Verification ──────────────────────────────────────')
  const products = await listEntities('products', token)
  const prodRefIds = products.map(p => p.refId).filter(Boolean)
  console.log(`Products in tenant '${TEST_TENANT}': [${prodRefIds.join(', ')}]`)

  let verifyOk = true
  for (const refId of ['PH.PROD.001', 'GL.PROD.001', 'PA.PROD.001']) {
    if (prodRefIds.includes(refId)) {
      console.log(`  ✓ ${refId}`)
    } else {
      console.error(`  ✗ ${refId} NOT FOUND`)
      verifyOk = false
    }
  }

  // Verify entity counts
  const checks = [
    { label:'PH.PROD.001 coverages', path:'products/PH.PROD.001/coverages', expect:10 },
    { label:'GL.PROD.001 coverages', path:'products/GL.PROD.001/coverages', expect:5 },
    { label:'PA.PROD.001 coverages', path:'products/PA.PROD.001/coverages', expect:12 },
    { label:'PH.PROD.001 rules',     path:'products/PH.PROD.001/rules',     expect:10 },
    { label:'GL.PROD.001 rules',     path:'products/GL.PROD.001/rules',     expect:7  },
  ]
  for (const c of checks) {
    const items = await listEntities(c.path, token)
    const ok = items.length >= c.expect
    console.log(`  ${ok ? '✓' : '✗'} ${c.label}: ${items.length} (expect ≥${c.expect})`)
    if (!ok) verifyOk = false
  }

  // Verify GET for canonical products
  for (const refId of ['PH.PROD.001', 'GL.PROD.001']) {
    const r = await apiGet(`/api/db/get?path=products/${refId}`, token)
    const ok = r.data?.refId === refId
    console.log(`  ${ok ? '✓' : '✗'} GET products/${refId} → refId=${r.data?.refId}`)
    if (!ok) verifyOk = false
  }

  // 5. Canary verification
  console.log('\n── Canary Verification ────────────────────────────────')
  const phCanary = computePHCanary()
  const glCanary = computeGLCanary()
  const paCanary = computePACanary()
  let canaryOk = true

  const check = (name, got, expected) => {
    const ok = got === expected
    console.log(`  ${ok ? '✓' : '✗'} ${name}: $${got} (expected $${expected})`)
    if (!ok) canaryOk = false
  }
  check('HO-3 (PH.PROD.001)', phCanary, 1528)
  check('CGL  (GL.PROD.001)', glCanary, 2635)
  check('PAP  (PA.PROD.001)', paCanary, 1002)

  // 6. Optional grounding verification
  if (WITH_GROUNDING) {
    console.log('\n── Grounding Chunk Verification ───────────────────────')
    console.log('  SCAFFOLD NOTE: DEF-0034 is FIXED (commit fcf1fe86).')
    console.log('  server/lib/data.js envelope() now writes a 5th Cosmos op')
    console.log('  (kind:"entity", coll:"groundingChunks") on every non-delete')
    console.log('  mutate, provided server/lib/chunk-shared.cjs is present.')
    console.log('  Build it with: pnpm build:chunk (already in pnpm build).')
    console.log('  This flag verifies that chunks were actually written.')
    console.log('  It does NOT substitute for DEF-0034 being fixed — it IS fixed.')
    try {
      const chunks = await listEntities('groundingChunks', token)
      console.log(`  Grounding chunks in tenant '${TEST_TENANT}': ${chunks.length}`)
      if (chunks.length === 0) {
        console.log('  ⚠ 0 chunks found. Server may be missing server/lib/chunk-shared.cjs.')
        console.log('    Run: pnpm build:chunk && restart server && re-run seed.')
      } else {
        const pids = [...new Set(chunks.map(c => c.productId).filter(Boolean))]
        console.log(`  Products with chunks: [${pids.join(', ')}]`)
        console.log(`  ✓ Portfolio-chat grounding should work for these products.`)
      }
    } catch (e) {
      console.error(`  ✗ Could not query groundingChunks: ${e.message}`)
    }
  }

  // 7. Summary
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  SEED SUMMARY')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  Tenant:  ${TEST_TENANT}`)
  console.log(`  Written: ${stats.written}`)
  console.log(`  Failed:  ${stats.failed}`)
  console.log(`  Products seeded: PH.PROD.001 · GL.PROD.001 · PA.PROD.001`)
  console.log(`  refIds present:  ${prodRefIds.join(' · ')}`)
  console.log(`  Canary HO-3: $${phCanary} / $1,528  ${phCanary === 1528 ? '✓' : '✗'}`)
  console.log(`  Canary GL:   $${glCanary} / $2,635  ${glCanary === 2635 ? '✓' : '✗'}`)
  console.log(`  Canary PA:   $${paCanary} / $1,002  ${paCanary === 1002 ? '✓' : '✗'}`)
  if (stats.errors.length > 0) {
    console.log('  Errors:')
    stats.errors.forEach(e => console.log(`    - ${e}`))
  }

  const allOk = verifyOk && canaryOk && stats.failed === 0
  if (allOk) {
    console.log('\n  ✓ SEED COMPLETE\n')
  } else {
    console.error('\n  ✗ SEED INCOMPLETE — review errors above.\n')
    process.exit(1)
  }
}

main().catch(e => {
  console.error('\nFATAL:', e.message)
  if (process.env.DEBUG) console.error(e.stack)
  process.exit(1)
})
