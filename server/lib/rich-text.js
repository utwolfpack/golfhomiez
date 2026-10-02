const ALLOWED_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 'p', 'div', 'br', 'ul', 'ol', 'li'])
const VOID_TAGS = new Set(['br'])

function canonicalTag(tag) {
  if (tag === 'b') return 'strong'
  if (tag === 'i') return 'em'
  return tag
}

function escapeAngles(value) {
  return String(value ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function sanitizeRichTextHtml(value, { maxTextLength = 5000 } = {}) {
  let source = String(value ?? '').replace(/\0/g, '')
  source = source.replace(/<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  if (!source.trim()) return null

  const pieces = source.split(/(<[^>]*>)/g)
  const out = []
  let textCount = 0
  for (const piece of pieces) {
    if (!piece) continue
    if (piece.startsWith('<')) {
      const match = piece.match(/^<\s*(\/?)\s*([a-z0-9]+)(?:\s[^>]*)?\s*\/?\s*>$/i)
      if (!match) continue
      const closing = Boolean(match[1])
      const rawTag = match[2].toLowerCase()
      if (!ALLOWED_TAGS.has(rawTag)) continue
      const tag = canonicalTag(rawTag)
      if (VOID_TAGS.has(tag)) {
        if (!closing) out.push('<br>')
        continue
      }
      out.push(closing ? `</${tag}>` : `<${tag}>`)
      continue
    }

    if (textCount >= maxTextLength) continue
    const normalized = piece.replace(/\r\n?/g, '\n')
    const remaining = maxTextLength - textCount
    const truncated = normalized.slice(0, remaining)
    textCount += truncated.length
    out.push(escapeAngles(truncated).replace(/\n/g, '<br>'))
  }

  const html = out.join('').trim()
  return richTextToPlainText(html).trim() ? html : null
}

export function richTextToPlainText(value) {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
}

export function richTextHasContent(value) {
  return Boolean(richTextToPlainText(value).trim())
}
