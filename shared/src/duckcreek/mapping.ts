// duckcreek/mapping.ts — the PARAMETERIZED canonical→Duck Creek mapping. Every Duck Creek
// element name, attribute name, namespace, id-prefix letter and manuScriptID token lives
// here as DATA, never hard-coded in the serializer. That is deliberate: the true Duck Creek
// manuscript-DEFINITION schema is proprietary and versioned per carrier, and the golden
// reference we studied (DuckCreekXML.xml — an INSTANCE document, not committed as it holds
// instance PII) is a quote, not a definition — so the vocabulary is our best-effort mirror
// of that sample, and swapping it for a real
// carrier's tag set is a config edit, not a code change. See docs/DUCKCREEK_MAPPING.md for
// the honest instance-vs-definition caveat and the field-by-field mapping.

// ─── Node types that receive a GUID id (each maps to a prefix letter) ─────────
// The sample's convention is "id prefix = first letter of the element/type name"
// (c=coverage, l=limit, S=StatCode, i=indicator, o=options, e=exposure, p=peril …).
// The prefix is a human hint only — global uniqueness comes from the 128-bit GUID body.
export type DcNodeType =
  | 'manuscript' | 'product' | 'line' | 'risk'
  | 'coverage' | 'limit' | 'deductible' | 'option' | 'statCode' | 'exposure' | 'peril'
  | 'form' | 'edition'
  | 'ratingProgram' | 'ratingStep' | 'factorTable' | 'tableDimension'
  | 'rule' | 'validValue' | 'dynamicField' | 'tableRow'

export interface DcNamespace {
  prefix:        string   // e.g. "dctSys"
  uri:           string   // e.g. "http://www.duckcreektech.com/dctSys"
  declareOnRoot: boolean  // declare xmlns:<prefix> on the root element
}

export interface DcManuscriptConfig {
  carrier:       string   // "PCG"
  country:       string   // "US"
  version:       { major: number; minor: number; build: number; rev: number }
  engineVersion: string
  cultureCode:   string
  currencyCode:  string
  /** Line code → Duck Creek LOB token. Personal Home → "HO" (sample-confirmed); Personal
   *  Auto → "PA" (no golden sample for auto — see the mapping doc). */
  lobTokens:     Record<string, string>
  /** Market + layer token per manuscript layer, following
   *  Carrier_LOB_Market_Layer_Country_major_minor_build_rev. */
  layers: {
    viewModel:      { market: string; layer: string }
    forms:          { market: string; layer: string }
    rating:         { market: string; layer: string }
    tables:         { market: string; layer: string }
    communications: string   // full literal (Carrier_ProductBase_Communications_1_0_0_0)
  }
}

export interface DcElements {
  manuscript:    string
  product:       string
  caption:       string
  description:   string
  marketSegment: string
  type:          string
  line:          string
  risk:          string
  exposure:      string
  coverage:      string
  statCode:      string
  formNumber:    string
  limit:         string
  deductible:    string
  validValues:   string
  value:         string
  options:       string
  section:       string
  forms:         string
  form:          string
  formName:      string
  edition:       string
  editions:      string
  coveragePart:  string
  fields:        string
  field:         string
  fieldOption:   string
  states:        string
  state:         string
  rating:        string
  program:       string
  step:          string
  factorTables:  string
  table:         string
  columns:       string
  column:        string
  dimensions:    string
  dimension:     string
  dimValue:      string
  rows:          string
  row:           string
  cell:          string
  rules:         string
  rule:          string
  ifEl:          string
  thenEl:        string
  action:        string
  coverageRef:   string
  ldTableRef:    string
  manuscriptRefs:            string
  policyManuScriptID:        string
  policyManuScriptVersionID: string
  formsManuScriptID:         string
  ratingManuScriptID:        string
  tableManuScriptID:         string
  communicationsManuScriptID: string
  useDctForms:               string
  useDctFormsAndMessages:    string
}

export interface DcAttrs {
  id:            string
  refId:         string
  key:           string
  t:             string   // term/type key
  ind:           string   // indicator (0/1)
  req:           string   // requirement
  order:         string
  source:        string
  premiumGenerating: string
  effective:     string   // "e" in the sample
  cid:           string   // coverage id reference (on options)
  isValid:       string
  isMandatory:   string
  isSelected:    string
  caption:       string
  notes:         string
  default:       string
  enabled:       string
  valueType:     string
  allStates:     string
  label:         string
  name:          string
  dataType:      string
  repeating:     string
  values:        string
  kind:          string
  valueColumn:   string
  op:            string
  sourceType:    string
  tableRef:      string
  inputKeys:     string
  constValue:    string
  condition:     string
  roundTo:       string
  category:      string
  subCategory:   string
  mandatory:     string
  ruleType:      string
  market:        string
  manuScriptID:  string
  engineVersion: string
  cultureCode:   string
  currencyCode:  string
  col:           string
  editionValue:  string
  defaultValue:  string
  structure:     string
  basis:         string
  unit:          string
  ldRef:         string
  stateList:     string   // per-value state list (attribute, pipe-joined)
  admitted:      string
  mandatoryDefault: string
  attach:        string
  dynamic:       string
  minimumPremium: string
  description:   string
}

export interface DuckCreekMapping {
  namespace:       DcNamespace
  manuscript:      DcManuscriptConfig
  idPrefix:        Record<DcNodeType, string>
  elements:        DcElements
  attrs:           DcAttrs
  premiumChildren: string[]   // Premium / change / offset / onset / written
  premiumZero:     string     // "0" — a definition has no computed premium
  boolTrue:        string     // "1"
  boolFalse:       string     // "0"
  /** The `t` term-key on the risk-level policy-form exposure (sample: PolicyForm=HO). */
  policyFormExposureKey: string
}

// ─── The default mapping (mirrors the golden sample's vocabulary) ─────────────

export const DEFAULT_DUCKCREEK_MAPPING: DuckCreekMapping = {
  namespace: {
    prefix:        'dctSys',
    uri:           'http://www.duckcreektech.com/dctSys',
    declareOnRoot: true,
  },
  manuscript: {
    carrier:       'PCG',
    country:       'US',
    version:       { major: 1, minor: 0, build: 0, rev: 0 },
    engineVersion: '2.0.0',
    cultureCode:   'en-US',
    currencyCode:  'USD',
    lobTokens:     { PH: 'HO', PA: 'PA' },
    layers: {
      viewModel:      { market: 'Admitted', layer: 'ViewModel' },
      forms:          { market: 'Admitted', layer: 'Forms' },
      rating:         { market: 'Admitted', layer: 'Rating' },
      tables:         { market: 'Admitted', layer: 'Tables' },
      communications: 'Carrier_ProductBase_Communications_1_0_0_0',
    },
  },
  // id-prefix letters — the sample's first-letter-of-element convention.
  idPrefix: {
    manuscript:     'm',
    product:        'P',
    line:           'l',
    risk:           'r',
    coverage:       'c',
    limit:          'l',
    deductible:     'd',
    option:         'o',
    statCode:       'S',
    exposure:       'e',
    peril:          'p',
    form:           'f',
    edition:        'e',
    ratingProgram:  'p',
    ratingStep:     's',
    factorTable:    't',
    tableDimension: 'D',
    rule:           'r',
    validValue:     'v',
    dynamicField:   'F',
    tableRow:       'w',
  },
  elements: {
    manuscript:    'manuscript',
    product:       'product',
    caption:       'Caption',
    description:   'Description',
    marketSegment: 'MarketSegment',
    type:          'Type',
    line:          'line',
    risk:          'risk',
    exposure:      'exposure',
    coverage:      'coverage',
    statCode:      'StatCode',
    formNumber:    'FormNumber',
    limit:         'limit',
    deductible:    'deductible',
    validValues:   'validValues',
    value:         'value',
    options:       'options',
    section:       'Section',
    forms:         'forms',
    form:          'form',
    formName:      'Form',
    edition:       'edition',
    editions:      'editions',
    coveragePart:  'CoveragePart',
    fields:        'dynamicFields',
    field:         'field',
    fieldOption:   'FieldOption',
    states:        'states',
    state:         'State',
    rating:        'rating',
    program:       'program',
    step:          'step',
    factorTables:  'factorTables',
    table:         'table',
    columns:       'columns',
    column:        'Column',
    dimensions:    'dimensions',
    dimension:     'dimension',
    dimValue:      'Value',
    rows:          'rows',
    row:           'row',
    cell:          'cell',
    rules:         'rules',
    rule:          'rule',
    ifEl:          'if',
    thenEl:        'then',
    action:        'action',
    coverageRef:   'CoverageRef',
    ldTableRef:    'LdTableRef',
    manuscriptRefs:             'policyAdmin',
    policyManuScriptID:         'PolicyManuScriptID',
    policyManuScriptVersionID:  'PolicyManuScriptVersionID',
    formsManuScriptID:          'FormsManuScriptID',
    ratingManuScriptID:         'RatingManuScriptID',
    tableManuScriptID:          'TableManuScriptID',
    communicationsManuScriptID: 'CommunicationsManuScriptID',
    useDctForms:                'UseDCTForms',
    useDctFormsAndMessages:     'UseDCTFormsAndMessages',
  },
  attrs: {
    id:            'id',
    refId:         'refId',
    key:           'key',
    t:             't',
    ind:           'ind',
    req:           'req',
    order:         'order',
    source:        'src',
    premiumGenerating: 'pg',
    effective:     'e',
    cid:           'cid',
    isValid:       'isvalid',
    isMandatory:   'Ismandatory',
    isSelected:    'Isselected',
    caption:       'caption',
    notes:         'notes',
    default:       'default',
    enabled:       'enabled',
    valueType:     'valueType',
    allStates:     'allStates',
    label:         'label',
    name:          'name',
    dataType:      'dataType',
    repeating:     'repeating',
    values:        'values',
    kind:          'kind',
    valueColumn:   'valueColumn',
    op:            'op',
    sourceType:    'sourceType',
    tableRef:      'tableRef',
    inputKeys:     'keys',
    constValue:    'const',
    condition:     'condition',
    roundTo:       'roundTo',
    category:      'category',
    subCategory:   'subCategory',
    mandatory:     'mandatory',
    ruleType:      'ruleType',
    market:        'market',
    manuScriptID:  'manuScriptID',
    engineVersion: 'engineVersion',
    cultureCode:   'cultureCode',
    currencyCode:  'currencyCode',
    col:           'col',
    editionValue:  'value',
    defaultValue:  'defaultValue',
    structure:     'structure',
    basis:         'basis',
    unit:          'unit',
    ldRef:         'ldRef',
    stateList:     'states',
    admitted:      'admitted',
    mandatoryDefault: 'mandatoryDefault',
    attach:        'attach',
    dynamic:       'dynamic',
    minimumPremium: 'minimumPremium',
    description:   'description',
  },
  premiumChildren: ['Premium', 'change', 'offset', 'onset', 'written'],
  premiumZero:     '0',
  boolTrue:        '1',
  boolFalse:       '0',
  policyFormExposureKey: 'PolicyForm',
}

// ─── manuScriptID composition (the Carrier_LOB_Market_Layer_Country_v_v_v_v pattern) ──

export type DcLayerKey = 'viewModel' | 'forms' | 'rating' | 'tables'

/** Compose a manuScriptID for a line + layer, e.g.
 *  PCG_HO_Admitted_ViewModel_US_1_0_0_0. `market` values already carry their own
 *  underscores where needed (e.g. "Non_Admitted"). */
export function composeManuscriptId(
  mapping: DuckCreekMapping, lineCode: string, layer: DcLayerKey,
): string {
  const m = mapping.manuscript
  const lob = m.lobTokens[lineCode] ?? lineCode
  const { market, layer: layerToken } = m.layers[layer]
  const { major, minor, build, rev } = m.version
  return [m.carrier, lob, market, layerToken, m.country, major, minor, build, rev].join('_')
}

/** The version-only manuScriptID (no version suffix) — mirrors PolicyManuScriptVersionID. */
export function composeManuscriptVersionId(
  mapping: DuckCreekMapping, lineCode: string, layer: DcLayerKey,
): string {
  const m = mapping.manuscript
  const lob = m.lobTokens[lineCode] ?? lineCode
  const { market, layer: layerToken } = m.layers[layer]
  return [m.carrier, lob, market, layerToken, m.country].join('_')
}
