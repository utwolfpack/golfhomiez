const ALLOWED_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 'p', 'div', 'br', 'ul', 'ol', 'li'])
const VOID_TAGS = new Set(['br'])

const EMOJI_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u
const ASCII_ALNUM_RE = /[A-Za-z0-9]/

function decodeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16)
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ''
    })
    .replace(/&#(\d+);/g, (_match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10)
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ''
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function isEmojiOnlyText(value) {
  const candidate = decodeHtmlAttribute(value).trim()
  return Boolean(candidate && candidate.length <= 64 && EMOJI_PICTOGRAPHIC_RE.test(candidate) && !ASCII_ALNUM_RE.test(candidate))
}

function emojiFromFacebookSrc(src) {
  if (!src) return ''
  try {
    const url = new URL(src, 'https://golfhomiez.invalid')
    if (!/(^|\.)fbcdn\.net$/i.test(url.hostname)) return ''
    const filename = decodeURIComponent(url.pathname.split('/').pop() || '')
    const match = filename.match(/^([0-9a-f]{4,6}(?:_[0-9a-f]{4,6})*)\.(?:png|gif|webp)$/i)
    if (!match) return ''
    const sourcePoints = match[1].split('_').map((part) => Number.parseInt(part, 16))
    if (sourcePoints.some((point) => !Number.isFinite(point) || point < 0 || point > 0x10ffff)) return ''

    const points = []
    sourcePoints.forEach((point, index) => {
      points.push(point)
      const next = sourcePoints[index + 1]
      if (next === 0x200d && point !== 0xfe0f && point !== 0x200d) points.push(0xfe0f)
      if ((point === 0x2640 || point === 0x2642) && next !== 0xfe0f) points.push(0xfe0f)
    })
    return String.fromCodePoint(...points)
  } catch {
    return ''
  }
}

function emojiTextFromImageTag(imageTag) {
  const attributes = {}
  const attributePattern = /\b(alt|aria-label|data-emoji|title|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
  for (const match of imageTag.matchAll(attributePattern)) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  for (const candidate of [attributes.alt, attributes['aria-label'], attributes['data-emoji'], attributes.title]) {
    const decoded = decodeHtmlAttribute(candidate ?? '').trim()
    if (isEmojiOnlyText(decoded)) return decoded
  }
  return emojiFromFacebookSrc(attributes.src ?? '')
}

function replaceEmojiImagesWithText(source) {
  return source.replace(/<img\b[^>]*>/gi, (imageTag) => emojiTextFromImageTag(imageTag))
}

function canonicalTag(tag) {
  if (tag === 'b') return 'strong'
  if (tag === 'i') return 'em'
  return tag
}

function escapeAngles(value) {
  return String(value ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function sanitizeRichTextHtml(value, { maxTextLength = 5000 } = {}) {
  let source = replaceEmojiImagesWithText(String(value ?? '').replace(/\0/g, ''))
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
    const normalized = piece
      .replace(/&(?:nbsp|#160|#x0*a0|NonBreakingSpace);/gi, ' ')
      .replace(/[\u00a0\u2007\u202f\ufeff]/g, ' ')
      .replace(/\r\n?/g, '\n')
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
