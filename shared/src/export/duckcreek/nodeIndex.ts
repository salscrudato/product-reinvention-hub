// The emitted-vocabulary subset of the Author XML node index.
//
// GENERATED from docs/export-templates/author-xml/author-xml-node-index.json
// (the machine grammar: 240 observed elements across the corpus). This module
// carries only the elements the overlay emitter can produce; the drift test in
// tests/export/node-index-drift.test.ts proves every entry here byte-matches the
// canonical docs JSON, so the two cannot diverge silently.
//
// L1 grammar conformance (spec §6): every emitted element must exist here, sit
// under an observed parent, and carry only observed attributes; the emitter
// controls its own vocabulary, so an unknown element is always a bug.

export interface NodeIndexEntry {
  parents: readonly string[]
  attributes: readonly string[]
  supportsOverride: boolean
  supportsAbstract: boolean
}

export const NODE_INDEX_SUBSET: Readonly<Record<string, NodeIndexEntry>> = {
  "ManuScript": { parents: [], attributes: [], supportsOverride: false, supportsAbstract: false },
  "properties": { parents: ["ManuScript"], attributes: ["manuscriptID","versionID","versionDate","version","boolean","fieldCache","cultureCode","cultureName","caption","inherited","image","dataSchema","shortCircuitCond","multiLanguages","usePersistedState","multiCurrency","inheritedPage","compiled"], supportsOverride: false, supportsAbstract: false },
  "notes": { parents: ["properties"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "keys": { parents: ["properties"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "keyInfo": { parents: ["keys"], attributes: ["name","value"], supportsOverride: false, supportsAbstract: false },
  "model": { parents: ["ManuScript"], attributes: ["defaultValue"], supportsOverride: false, supportsAbstract: false },
  "object": { parents: ["object","model"], attributes: ["id","abstract","path","override","document","fragment","cleanup","caption","share","persistedDocument"], supportsOverride: true, supportsAbstract: true },
  "public": { parents: ["object"], attributes: ["id","path","type","override","comment","class","index","alwaysRun"], supportsOverride: true, supportsAbstract: false },
  "private": { parents: ["object"], attributes: ["id","type","caption","path","override","comment","alwaysRun","class"], supportsOverride: true, supportsAbstract: false },
  "definition": { parents: ["public"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "caption": { parents: ["definition","worksheet"], attributes: ["value","idref","type"], supportsOverride: false, supportsAbstract: false },
  "options": { parents: ["definition"], attributes: ["validRef","idref","name","codeRef","captionRef","referenceListRef"], supportsOverride: false, supportsAbstract: false },
  "option": { parents: ["options"], attributes: ["value","caption","validRef","default"], supportsOverride: false, supportsAbstract: false },
  "rules": { parents: ["public"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "default": { parents: ["rules","request"], attributes: ["value","idref"], supportsOverride: false, supportsAbstract: false },
  "minimum": { parents: ["rules"], attributes: ["value"], supportsOverride: false, supportsAbstract: false },
  "maximum": { parents: ["rules"], attributes: ["value"], supportsOverride: false, supportsAbstract: false },
  "value": { parents: ["private","rules"], attributes: ["value","idref","resourceString"], supportsOverride: false, supportsAbstract: false },
  "lookup": { parents: ["value","caption","else"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "tableRef": { parents: ["lookup"], attributes: ["value","idref"], supportsOverride: false, supportsAbstract: false },
  "fieldRef": { parents: ["lookup"], attributes: ["value"], supportsOverride: false, supportsAbstract: false },
  "keyRef": { parents: ["lookup"], attributes: ["type","name","value","idref"], supportsOverride: false, supportsAbstract: false },
  "calculation": { parents: ["value","else","default","caption","argument"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "argument": { parents: ["calculation"], attributes: ["op","type","idref","value","round","roundType"], supportsOverride: false, supportsAbstract: false },
  "if": { parents: ["misc","value","default","caption"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "condition": { parents: ["if"], attributes: ["idref"], supportsOverride: false, supportsAbstract: false },
  "comparison": { parents: ["comparison","condition","value","worksheet","where","required","readOnly"], attributes: ["compare","idref","type"], supportsOverride: false, supportsAbstract: false },
  "operand": { parents: ["comparison"], attributes: ["type","idref","value"], supportsOverride: false, supportsAbstract: false },
  "then": { parents: ["if"], attributes: ["idref","value","type","message"], supportsOverride: false, supportsAbstract: false },
  "else": { parents: ["if"], attributes: ["idref","value","type"], supportsOverride: false, supportsAbstract: false },
  "iterator": { parents: ["value"], attributes: ["type","scope","action","idref","includeDeleted"], supportsOverride: false, supportsAbstract: false },
  "reference": { parents: ["affects","section","mapping","iterator","tableLayout","grid"], attributes: ["idref","effect","index","mapId","name","type","onBlur","compute","caption","fldClass","capClass","hoverHelp","wsCond"], supportsOverride: false, supportsAbstract: false },
  "worksheet": { parents: ["public","private"], attributes: ["suppress"], supportsOverride: false, supportsAbstract: false },
  "documents": { parents: ["ManuScript"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "documentSet": { parents: ["documents"], attributes: ["name","paperBinNum","printDefault","prevPage","caption","category","modelCollectionRef","viewModelRef","condition","inherited","override","topicRef","pageRef"], supportsOverride: true, supportsAbstract: false },
  "scope": { parents: ["documentSet","subdoc"], attributes: ["name","increment","startIter","endIter","restriction"], supportsOverride: false, supportsAbstract: false },
  "document": { parents: ["documentSet"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "subdoc": { parents: ["document","subdoc"], attributes: ["name","path","condition"], supportsOverride: false, supportsAbstract: false },
  "merge": { parents: ["documentSet"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "mergeField": { parents: ["merge"], attributes: ["name","iter","formatValue","idref","readOnly","formatSpecifier","condition","format","dataField","wsCond","wsSuppressRound"], supportsOverride: false, supportsAbstract: false },
  "maxLength": { parents: ["definition"], attributes: ["idref","value"], supportsOverride: false, supportsAbstract: false },
  "minOccurs": { parents: ["object"], attributes: ["value"], supportsOverride: false, supportsAbstract: false },
  "maxOccurs": { parents: ["object"], attributes: ["value"], supportsOverride: false, supportsAbstract: false },
  "required": { parents: ["definition"], attributes: ["idref"], supportsOverride: false, supportsAbstract: false },
  "message": { parents: ["messages"], attributes: ["name","flag","category"], supportsOverride: false, supportsAbstract: false },
  "table": { parents: ["object"], attributes: ["id","tableType","separator","override","comment"], supportsOverride: true, supportsAbstract: false },
  "fields": { parents: ["table"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "field": { parents: ["group","fields"], attributes: ["idref","id","groupId","copy","class","readOnlyRef","type","name","compute","index","onBlur","caption","showRef","hideRef","usePartyMappings","hoverHelp","removeZero","capClass"], supportsOverride: false, supportsAbstract: false },
  "rowKeys": { parents: ["table"], attributes: ["name","type","find","pageKey"], supportsOverride: false, supportsAbstract: false },
  "key": { parents: ["rowKeys","colKeys"], attributes: ["value","caption","default"], supportsOverride: false, supportsAbstract: false },
  "data": { parents: ["table"], attributes: [], supportsOverride: false, supportsAbstract: false },
  "row": { parents: ["data"], attributes: ["value"], supportsOverride: false, supportsAbstract: false },
  "contexts": { parents: ["properties"], attributes: ["inherited"], supportsOverride: false, supportsAbstract: false },
}

/**
 * Required attributes per element (spec §6 L1 + §3.10 node-map "required attrs").
 * The node index records observed attributes; the REQUIRED set is pinned by the
 * spec (public → id/path/type; table → id/tableType; keyRef → name/type; …).
 */
export const REQUIRED_ATTRS: Readonly<Record<string, readonly string[]>> = {
  properties:  ['manuscriptID', 'inherited', 'caption'],
  keyInfo:     ['name', 'value'],
  object:      ['id'],
  public:      ['id', 'path', 'type'],
  private:     ['id', 'type'],
  table:       ['id', 'tableType'],
  keyRef:      ['name', 'type'],
  argument:    ['op'],
  operand:     ['type'],
  comparison:  ['compare'],
  iterator:    ['type', 'scope', 'action', 'idref'],
  documentSet: ['name', 'printDefault'],
  scope:       ['name'],
  subdoc:      ['name'],
  mergeField:  ['name', 'idref'],
  tableRef:    [],
  fieldRef:    ['value'],
  rowKeys:     ['name', 'type'],
}
