// X1 — overlay emitter + OVERLAY-DELTA LINT (spec §1–§4, §6 L0–L2; ledger XE-01/XE-02).
import { describe, expect, it } from 'vitest'
import { buildOverlay, coverageConfigIds } from './overlay'
import { manifestTables } from './tables'
import { harvestIds, runOverlayLint, type LintInputs } from './lint'
import { parseXml, serialize, type XmlNode } from './xml'
import { LOB_BASE_MANUSCRIPTS, SCAFFOLD_CHAIN } from './spec'
import { paExportInput } from './paFixture'

const PA_BASE = LOB_BASE_MANUSCRIPTS['PA.LOB.001']!

function paOverlay() {
  const input = paExportInput()
  const overlay = buildOverlay(input, PA_BASE)
  const lintInputs: LintInputs = {
    baseIds: new Set<string>(SCAFFOLD_CHAIN),
    generatedIds: coverageConfigIds(input),
    tables: manifestTables(input.rtTables),
    manifestIds: overlay.ids,
  }
  return { input, overlay, lintInputs }
}

function find(root: XmlNode, pred: (n: XmlNode) => boolean): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => { if (pred(n)) out.push(n); n.children.forEach(walk) }
  walk(root)
  return out
}

describe('X1 overlay emitter — deltas on the inherited chain, never a flatten', () => {
  it('binds the PA base as a BARE manuscript id and omits inheritedPage (spec §1.1 MUST)', () => {
    const { overlay } = paOverlay()
    const props = parseXml(overlay.xml).children[0]!
    expect(props.name).toBe('properties')
    expect(props.attrs.inherited).toBe('Carrier_ProductBase_PersonalAuto_1_0_0_0')
    expect(props.attrs.inherited!.endsWith('.xml')).toBe(false)
    expect(props.attrs.inheritedPage).toBeUndefined()
    expect(props.attrs.manuscriptID).toBe('Hub_PA_PROD_001_1_0_0_0')
    expect(overlay.fileName).toBe('Hub_PA_PROD_001_1_0_0_0.xml')
  })

  it('emits the productCode="Data" key block (presentation is Express-generated, §3.7)', () => {
    const { overlay } = paOverlay()
    const keyInfos = find(parseXml(overlay.xml), (n) => n.name === 'keyInfo')
    const byName = Object.fromEntries(keyInfos.map((k) => [k.attrs.name, k.attrs.value]))
    expect(byName.productCode).toBe('Data')
    expect(byName.lob).toBe('PersonalAuto')
    expect(byName.masterID).toBe('None')
    expect(byName.version).toBe('1.0.0.0')
  })

  it('re-declares the abstract scaffold chain WITHOUT override (observed SP3 shape)', () => {
    const { overlay } = paOverlay()
    const root = parseXml(overlay.xml)
    for (const id of SCAFFOLD_CHAIN) {
      const nodes = find(root, (n) => n.name === 'object' && n.attrs.id === id)
      expect(nodes, id).toHaveLength(1)
      expect(nodes[0]!.attrs.abstract, id).toBe('1')
      expect(nodes[0]!.attrs.override, id).toBeUndefined()
    }
  })

  it('marks restatements of CoverageConfig-generated inputs override="1" and net-new ids without it', () => {
    const { overlay } = paOverlay()
    const root = parseXml(overlay.xml)
    // Generated-input restatement (term options, spec §5 row 10).
    const biInput = find(root, (n) => n.attrs.id === 'BodilyInjuryLiabilityInput.BodilyInjuryPerPersonPerAccident')
    expect(biInput).toHaveLength(1)
    expect(biInput[0]!.attrs.override).toBe('1')
    // Its coverage object is net-new — no override, manifest-traced.
    const covObj = find(root, (n) => n.name === 'object' && n.attrs.id === 'BodilyInjuryLiability')
    expect(covObj).toHaveLength(1)
    expect(covObj[0]!.attrs.override).toBeUndefined()
    expect(covObj[0]!.attrs.path).toBe('coverage[Type="Bodily Injury Liability"]')
    expect(overlay.ids['BodilyInjuryLiability']).toBe('PA.COV.001.001')
    // Rating privates are net-new — no override.
    const step1 = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyPrivate.Step01_Territorybaserate')
    expect(step1).toHaveLength(1)
    expect(step1[0]!.attrs.override).toBeUndefined()
  })

  it('emits full option lists with the default marked (term canonical values, §3.3 + row 10)', () => {
    const { overlay } = paOverlay()
    const root = parseXml(overlay.xml)
    const biInput = find(root, (n) => n.attrs.id === 'BodilyInjuryLiabilityInput.BodilyInjuryPerPersonPerAccident')[0]!
    const options = find(biInput, (n) => n.name === 'option')
    expect(options.map((o) => o.attrs.value)).toEqual(['25000', '50000', '100000', '250000'])
    expect(options.find((o) => o.attrs.default === '1')?.attrs.value).toBe('100000')
  })

  it('wires rating step s1 as lookup(tableRef/fieldRef/keyRef) with byte-matched headers (§3.5)', () => {
    const { overlay } = paOverlay()
    const root = parseXml(overlay.xml)
    const step1 = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyPrivate.Step01_Territorybaserate')[0]!
    const lookup = find(step1, (n) => n.name === 'lookup')[0]!
    expect(find(lookup, (n) => n.name === 'tableRef')[0]!.attrs.value).toBe('TerritoryBaseRate')
    expect(find(lookup, (n) => n.name === 'fieldRef')[0]!.attrs.value).toBe('rate')
    const keyRef = find(lookup, (n) => n.name === 'keyRef')[0]!
    expect(keyRef.attrs.name).toBe('territory')
    expect(keyRef.attrs.type).toBe('string')
    expect(keyRef.attrs.idref).toBe('PersonalAutoPolicyInput.Territory')
  })

  it('gates conditional steps behind their election and chains each run on its predecessor', () => {
    const { overlay } = paOverlay()
    const root = parseXml(overlay.xml)
    // s5 (Medical Payments, condition medPayElected) → if/condition/comparison.
    const s5 = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyPrivate.Step05_MedicalPaymentspremium')[0]!
    const cmp = find(s5, (n) => n.name === 'comparison')[0]!
    expect(cmp.attrs.compare).toBe('eq')
    const thenNode = find(s5, (n) => n.name === 'then')[0]!
    expect(thenNode.attrs.idref).toBe('PersonalAutoPolicyPrivate.Step05_MedicalPaymentspremium_Amount')
    // Run05 consumes Run04 (dependency-driven ROC order, §3.5).
    const run5 = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyPrivate.Run05')[0]!
    const args = find(run5, (n) => n.name === 'argument')
    expect(args[0]!.attrs.idref).toBe('PersonalAutoPolicyPrivate.Run04')
    expect(args[1]!.attrs.op).toBe('add')
  })

  it('emits MIN_FLOOR as the observed compare="gt" if-shape and rounds via multiply-by-1', () => {
    const { overlay } = paOverlay()
    const root = parseXml(overlay.xml)
    const run12 = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyPrivate.Run12')[0]!
    const cmp = find(run12, (n) => n.name === 'comparison')[0]!
    expect(cmp.attrs.compare).toBe('gt')
    // roundTo 0 on the floor step → a rounded chain head feeds the premium output.
    const rounded = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyPrivate.Run12Rounded')[0]!
    const roundArg = find(rounded, (n) => n.name === 'argument' && n.attrs.round !== undefined)[0]!
    expect(roundArg.attrs.round).toBe('1')
    expect(roundArg.attrs.roundType).toBe('round')
    const premium = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyOutput.Premium')[0]!
    expect(find(premium, (n) => n.name === 'value')[0]!.attrs.idref).toBe('PersonalAutoPolicyPrivate.Run12Rounded')
  })

  it('reuses CoverageConfig-generated ids for Hub-linked rating drivers instead of duplicating them', () => {
    const { overlay } = paOverlay()
    const root = parseXml(overlay.xml)
    const s7 = find(root, (n) => n.attrs.id === 'PersonalAutoPolicyPrivate.Step07_Collisionpremium_Amount')[0]!
    const keyRefs = find(s7, (n) => n.name === 'keyRef')
    expect(keyRefs.map((k) => k.attrs.idref)).toContain('CollisionCoverageInput.CollisionDeductible')
  })

  it('emits every form as a documentSet with derived printDefault and compiled/stubbed conditions (§3.8)', () => {
    const { overlay, input } = paOverlay()
    const root = parseXml(overlay.xml)
    const sets = find(root, (n) => n.name === 'documentSet')
    expect(sets).toHaveLength(input.forms.length)
    const byName = new Map(sets.map((s) => [s.attrs.name, s]))
    expect(byName.get('PP0001_0105')!.attrs.printDefault).toBe('Mandatory')
    expect(byName.get('PP1301_0105')!.attrs.printDefault).toBe('Selected')
    // Mechanical coverage-elected case compiles against the generated election id.
    expect(byName.get('PP1301_0105')!.attrs.condition).toBe('FormsPrivate.Show_PP1301')
    const show = find(root, (n) => n.attrs.id === 'FormsPrivate.Show_PP1301')[0]!
    expect(find(show, (n) => n.name === 'operand')[0]!.attrs.idref).toBe('RentalReimbursementInput.Rentalreimbursementelected')
    // Free-text case is a GUESSED stub returning 1 — flagged, never compiled.
    const stub = find(root, (n) => n.attrs.id === 'FormsPrivate.Show_PP0446')[0]!
    expect(find(stub, (n) => n.name === 'value')[0]!.attrs.value).toBe('1')
    expect(overlay.hitl.some((h) => h.kind === 'form-condition' && h.target === 'FormsPrivate.Show_PP0446')).toBe(true)
    expect(overlay.xml).toContain('HITL:GUESSED')
  })

  it('never inlines a rate table: zero <table> elements; rates ride Unity (§3.6)', () => {
    const { overlay } = paOverlay()
    expect(find(parseXml(overlay.xml), (n) => n.name === 'table')).toHaveLength(0)
  })

  it('traces EVERY net-new id in the manifest id map (clause 2 — nothing untraceable)', () => {
    const { overlay, lintInputs } = paOverlay()
    const root = parseXml(overlay.xml)
    const netNew = [...harvestIds(root)].filter(
      (id) => !lintInputs.baseIds.has(id) && !lintInputs.generatedIds.has(id),
    )
    expect(netNew.length).toBeGreaterThan(0)
    for (const id of netNew) {
      expect(overlay.ids[id], `net-new id ${id} must be manifest-traced`).toBeDefined()
    }
  })

  it('is byte-stable: two builds of the same input serialize identically', () => {
    const a = buildOverlay(paExportInput(), PA_BASE)
    const b = buildOverlay(paExportInput(), PA_BASE)
    expect(a.xml).toBe(b.xml)
  })

  it('is pure ASCII end to end', () => {
    const { overlay } = paOverlay()
    expect([...overlay.xml].every((ch) => ch.charCodeAt(0) <= 126)).toBe(true)
  })
})

describe('X1 OVERLAY-DELTA LINT — the hard gate', () => {
  it('passes the real PA overlay (green path)', () => {
    const { overlay, lintInputs } = paOverlay()
    const result = runOverlayLint(overlay.xml, lintInputs)
    expect(result.findings.filter((f) => f.level === 'FAIL')).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('FAILS a deliberately flattened document (>5% of base ids restated concretely)', () => {
    const { lintInputs } = paOverlay()
    const baseIds = new Set([...Array.from({ length: 40 }, (_, i) => `Base.Field${i}`), ...SCAFFOLD_CHAIN])
    const flattened = [
      '<ManuScript>',
      '  <properties manuscriptID="X_1_0_0_0" inherited="B" caption="X" />',
      '  <model>',
      '    <object id="data" abstract="1">',
      ...Array.from({ length: 40 }, (_, i) => `      <public id="Base.Field${i}" path="F${i}" type="string" override="1" />`),
      '    </object>',
      '  </model>',
      '</ManuScript>',
    ].join('\n')
    const result = runOverlayLint(flattened, { ...lintInputs, baseIds })
    expect(result.ok).toBe(false)
    expect(result.findings.some((f) => f.rule === 'R-flatten' && f.level === 'FAIL')).toBe(true)
  })

  it('FAILS an untraceable net-new id (a fabrication) and an override of an unknown id', () => {
    const { lintInputs } = paOverlay()
    const doc = [
      '<ManuScript>',
      '  <properties manuscriptID="X_1_0_0_0" inherited="B" caption="X" />',
      '  <model>',
      '    <object id="data" abstract="1">',
      '      <object id="Invented" path="x">',
      '        <public id="Invented.Value" path="V" type="string" />',
      '      </object>',
      '      <object id="AlsoInvented" path="y" override="1" />',
      '    </object>',
      '  </model>',
      '</ManuScript>',
    ].join('\n')
    const result = runOverlayLint(doc, { ...lintInputs, manifestIds: {} })
    expect(result.findings.some((f) => f.rule === 'L2-untraceable-net-new' && f.id === 'Invented.Value')).toBe(true)
    expect(result.findings.some((f) => f.rule === 'L2-override-of-unknown-id' && f.id === 'AlsoInvented')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('FAILS an inlined rate table whose id collides with the TableConfig manifest (R-rates)', () => {
    const { lintInputs } = paOverlay()
    const doc = [
      '<ManuScript>',
      '  <properties manuscriptID="X_1_0_0_0" inherited="B" caption="X" />',
      '  <model>',
      '    <object id="data" abstract="1">',
      '      <object id="Rating" path="">',
      '        <table id="TerritoryBaseRate" tableType="local">',
      '          <fields><field type="int" name="rate" /></fields>',
      '          <rowKeys name="territory" type="string" find="eq"><key value="T001" /></rowKeys>',
      '          <data><row value="350" /></data>',
      '        </table>',
      '      </object>',
      '    </object>',
      '  </model>',
      '</ManuScript>',
    ].join('\n')
    const result = runOverlayLint(doc, { ...lintInputs, manifestIds: { Rating: 'x', TerritoryBaseRate: 'x' } })
    expect(result.findings.some((f) => f.rule === 'R-rates')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('FAILS dangling references and mismatched key headers (R-idref / L3)', () => {
    const { lintInputs } = paOverlay()
    const doc = [
      '<ManuScript>',
      '  <properties manuscriptID="X_1_0_0_0" inherited="B" caption="X" />',
      '  <model>',
      '    <object id="data" abstract="1">',
      '      <object id="R" path="">',
      '        <private id="R.Step" caption="" type="float">',
      '          <value><lookup><tableRef value="NoSuchTable" /><fieldRef value="rate" /><keyRef idref="R.Missing" type="string" name="territory" /></lookup></value>',
      '        </private>',
      '        <private id="R.Step2" caption="" type="float">',
      '          <value><lookup><tableRef value="TerritoryBaseRate" /><fieldRef value="rate" /><keyRef idref="R.Step" type="string" name="Territory" /></lookup></value>',
      '        </private>',
      '      </object>',
      '    </object>',
      '  </model>',
      '</ManuScript>',
    ].join('\n')
    const result = runOverlayLint(doc, { ...lintInputs, manifestIds: { R: 'x', 'R.Step': 'x', 'R.Step2': 'x' } })
    expect(result.findings.some((f) => f.rule === 'R-idref' && f.detail.includes('NoSuchTable'))).toBe(true)
    // keyRef name "Territory" vs the byte-authoritative header "territory".
    expect(result.findings.some((f) => f.rule === 'R-idref' && f.detail.includes('"Territory"'))).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('FAILS dead scaffolding and non-"1" override values', () => {
    const { lintInputs } = paOverlay()
    const doc = [
      '<ManuScript>',
      '  <properties manuscriptID="X_1_0_0_0" inherited="B" caption="X" />',
      '  <model>',
      '    <object id="data" abstract="1">',
      '      <object id="LineCoverages" abstract="1"></object>',
      '      <object id="Line" override="2" />',
      '    </object>',
      '  </model>',
      '</ManuScript>',
    ].join('\n')
    const result = runOverlayLint(doc, lintInputs)
    expect(result.findings.some((f) => f.rule === 'L2-dead-scaffolding' && f.id === 'LineCoverages')).toBe(true)
    expect(result.findings.some((f) => f.rule === 'R-override-attr' && f.id === 'Line')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('FAILS unknown elements and unknown attributes (L1 grammar conformance)', () => {
    const { lintInputs } = paOverlay()
    const doc = [
      '<ManuScript>',
      '  <properties manuscriptID="X_1_0_0_0" inherited="B" caption="X" />',
      '  <model>',
      '    <object id="data" abstract="1" wobble="9">',
      '      <frobnicator id="Z" />',
      '    </object>',
      '  </model>',
      '</ManuScript>',
    ].join('\n')
    const result = runOverlayLint(doc, lintInputs)
    expect(result.findings.some((f) => f.rule === 'L1-unknown-element' && f.element === 'frobnicator')).toBe(true)
    expect(result.findings.some((f) => f.rule === 'L1-attribute' && f.detail.includes('wobble'))).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('round-trips the emitted overlay through the hardened parser (writer ↔ parser agree)', () => {
    const { overlay } = paOverlay()
    const stripComments = (s: string) => s.replace(/^[ \t]*<!--.*?-->\r?\n/gm, '')
    const reparsed = parseXml(overlay.xml)
    expect(serialize(reparsed)).toBe(stripComments(overlay.xml))
  })
})
