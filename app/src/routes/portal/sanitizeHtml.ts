// sanitizeHtml.ts — client-side allowlist sanitizer for the portal coverage summary.
//
// The server already sanitizes generated HTML before persisting it, but the client
// NEVER trusts that: this DOM-based pass rebuilds the fragment node-by-node against a
// strict allowlist, so nothing reaches dangerouslySetInnerHTML that wasn't explicitly
// permitted. Rules:
//   • Only the tags below survive; disallowed script-capable elements are dropped WITH
//     their entire subtree; other unknown elements are unwrapped (safe children kept).
//   • The ONLY attribute that survives is `class`, and only when it matches CLASS_RE.
//     No style, no href/src, no event handlers, no data-* — ever.
//   • Text nodes are re-created as text; comments/CDATA/PIs are discarded.

const ALLOWED_TAGS = new Set([
  'section', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'details', 'summary', 'strong', 'em', 'br',
])

// Elements whose CONTENT must never surface, even as text.
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'template', 'noscript', 'textarea', 'select', 'title', 'link', 'meta', 'base', 'form',
])

const CLASS_RE = /^[a-z0-9 _-]{1,160}$/i

function copyChildren(from: Node, to: Element, doc: Document): void {
  for (const node of Array.from(from.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      to.appendChild(doc.createTextNode(node.textContent ?? ''))
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue   // comments, PIs, CDATA → dropped
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (DROP_WITH_CONTENT.has(tag)) continue
    if (!ALLOWED_TAGS.has(tag)) {
      copyChildren(el, to, doc)   // unwrap unknown-but-harmless wrappers, keep safe children
      continue
    }
    const safe = doc.createElement(tag)
    const cls = el.getAttribute('class')
    if (cls && CLASS_RE.test(cls)) safe.setAttribute('class', cls)
    copyChildren(el, safe, doc)
    to.appendChild(safe)
  }
}

/** Sanitize an HTML fragment for rendering inside the portal. Returns safe HTML. */
export function sanitizePortalHtml(html: string): string {
  if (!html) return ''
  // Parse in a detached document so nothing (images, scripts) loads during parsing.
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = document.createElement('div')
  copyChildren(parsed.body, out, document)
  return out.innerHTML
}
