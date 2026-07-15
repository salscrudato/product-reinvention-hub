// X4 — PARSER HARDENING (binding): DTDs disabled, external entities disabled,
// entity expansion off, document size cap, depth cap. XXE and billion-laughs
// payloads must be REJECTED WITH A CLEAN ERROR — no entity resolver is ever
// reachable, no memory blow-up is possible, because the parser has no DTD
// machinery at all (<!DOCTYPE is rejected outright; custom entities cannot be
// declared, so expansion cannot happen).
import { describe, expect, it } from 'vitest'
import { mapManuscriptOverlay } from '../../shared/src/insurance/manuscriptImport'
import { parseXml, XmlParseError } from '../../shared/src/export/duckcreek/xml'

const XXE_PAYLOAD = `<?xml version="1.0"?>
<!DOCTYPE ManuScript [
  <!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">
]>
<ManuScript>
  <properties manuscriptID="Evil_1_0_0_0" inherited="B" caption="&xxe;" />
</ManuScript>`

const BILLION_LAUGHS = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<ManuScript><properties manuscriptID="Evil_1_0_0_0" inherited="B" caption="&lol9;" /></ManuScript>`

describe('X4 parser hardening — hostile overlays are rejected with clean errors', () => {
  it('REJECTS the XXE payload: DOCTYPE is not allowed, no entity resolver is reachable', () => {
    expect(() => mapManuscriptOverlay(XXE_PAYLOAD)).toThrowError(XmlParseError)
    expect(() => mapManuscriptOverlay(XXE_PAYLOAD)).toThrowError(/DOCTYPE is not allowed/)
  })

  it('REJECTS the billion-laughs payload before any expansion can happen', () => {
    const before = process.memoryUsage().heapUsed
    expect(() => mapManuscriptOverlay(BILLION_LAUGHS)).toThrowError(/DOCTYPE is not allowed/)
    const grown = process.memoryUsage().heapUsed - before
    // No expansion: rejection is O(1) — far under a single expanded payload tier.
    expect(grown).toBeLessThan(50 * 1024 * 1024)
  })

  it('REJECTS undefined entities even WITHOUT a DOCTYPE (custom entities cannot exist)', () => {
    const doc = '<ManuScript><properties manuscriptID="X_1_0_0_0" inherited="B" caption="&lol9;" /></ManuScript>'
    expect(() => mapManuscriptOverlay(doc)).toThrowError(/undefined entity/)
  })

  it('caps document size (5 MB default)', () => {
    const big = `<ManuScript><properties manuscriptID="X_1_0_0_0" inherited="B" caption="${'a'.repeat(5 * 1024 * 1024)}" /></ManuScript>`
    expect(() => mapManuscriptOverlay(big)).toThrowError(/exceeds the .*-character cap/)
  })

  it('caps element depth (64 default)', () => {
    const open = Array.from({ length: 70 }, (_, i) => `<object id="D${i}">`).join('')
    const close = Array.from({ length: 70 }, (_, i) => `</object>`).join('')
    const doc = `<ManuScript><model>${open}${close}</model></ManuScript>`
    expect(() => mapManuscriptOverlay(doc)).toThrowError(/depth exceeds/)
  })

  it('caps node count', () => {
    const many = Array.from({ length: 300 }, () => '<keyInfo name="k" value="v" />').join('')
    const doc = `<ManuScript><properties manuscriptID="X" inherited="B" caption="c"><keys>${many}</keys></properties></ManuScript>`
    expect(() => parseXml(doc, { maxChars: 10_000_000, maxDepth: 64, maxNodes: 100 })).toThrowError(/node count exceeds/)
  })

  it('rejects malformed markup with clean errors (never partial trees)', () => {
    expect(() => mapManuscriptOverlay('<ManuScript><unclosed></ManuScript>')).toThrowError(XmlParseError)
    expect(() => mapManuscriptOverlay('<ManuScript foo="1" foo="2" />')).toThrowError(/duplicate attribute/)
    expect(() => mapManuscriptOverlay('not xml at all')).toThrowError(XmlParseError)
    expect(() => mapManuscriptOverlay('<NotManuScript />')).toThrowError(/not a ManuScript overlay/)
  })
})
