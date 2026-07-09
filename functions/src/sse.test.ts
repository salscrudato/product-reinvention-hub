// SSE plumbing tests (B7) — the happy path and the error path of the server-sent-events
// helpers every streaming AI function (chat/analyzeClaim/draftRule/…) shares. A broken record
// framing here would silently corrupt every streamed answer, so lock the wire contract:
// `openSse` sets the streaming headers, and `send` emits exactly `data: <json>\n\n`.
import { describe, it, expect } from 'vitest'
import { openSse, send, type SseResponse, type StreamEvent } from './runtime'

/** Minimal SseResponse spy — captures headers, written chunks, and end(). */
function mockRes() {
  const headers: Record<string, string> = {}
  const chunks: string[] = []
  let ended = false
  const res: SseResponse & { headers: Record<string, string>; chunks: string[]; isEnded: () => boolean } = {
    setHeader: (k, v) => { headers[k] = v },
    write:     (c) => { chunks.push(c); return true },
    end:       () => { ended = true },
    flushHeaders: () => {},
    headers, chunks, isEnded: () => ended,
  }
  return res
}

/** Parse the JSON payload out of a single `data: …\n\n` SSE record. */
function parseRecord(chunk: string): unknown {
  expect(chunk.startsWith('data: ')).toBe(true)
  expect(chunk.endsWith('\n\n')).toBe(true)
  return JSON.parse(chunk.slice('data: '.length, -2))
}

describe('openSse', () => {
  it('sets the event-stream headers', () => {
    const res = mockRes()
    openSse(res)
    expect(res.headers['Content-Type']).toBe('text/event-stream')
    expect(res.headers['Cache-Control']).toBe('no-cache')
    expect(res.headers['Connection']).toBe('keep-alive')
  })
})

describe('send — happy path', () => {
  it('frames a token event as data: <json>\\n\\n', () => {
    const res = mockRes()
    send(res, { t: 'token', v: 'hello' })
    expect(res.chunks).toHaveLength(1)
    expect(parseRecord(res.chunks[0]!)).toEqual({ t: 'token', v: 'hello' })
  })

  it('frames a json determination event and a terminal done event', () => {
    const res = mockRes()
    const determination: StreamEvent = { t: 'json', key: 'determination', value: { verdict: 'COVERED', cites: ['HO 00 03'] } }
    send(res, determination)
    send(res, { t: 'done' })
    expect(res.chunks).toHaveLength(2)
    expect(parseRecord(res.chunks[0]!)).toEqual(determination)
    expect(parseRecord(res.chunks[1]!)).toEqual({ t: 'done' })
  })

  it('escapes newlines so one event is always one SSE record', () => {
    const res = mockRes()
    send(res, { t: 'token', v: 'line1\nline2' })
    // Exactly one record terminator (the trailing blank line) — the inner \n is JSON-escaped.
    expect(res.chunks[0]!.match(/\n\n/g)).toHaveLength(1)
    expect(parseRecord(res.chunks[0]!)).toEqual({ t: 'token', v: 'line1\nline2' })
  })
})

describe('send — error path', () => {
  it('frames an error event the client can surface', () => {
    const res = mockRes()
    send(res, { t: 'error', message: 'Could not reach a grounded answer.' })
    const parsed = parseRecord(res.chunks[0]!) as StreamEvent
    expect(parsed).toEqual({ t: 'error', message: 'Could not reach a grounded answer.' })
  })
})
