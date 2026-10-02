import { useEffect, useRef, useState } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'
import { emojiTextFromClipboardImage, richTextToPlainText, sanitizeRichTextHtml } from '../lib/rich-text'

type Props = {
  id?: string
  label: string
  value?: string | null
  onChange: (value: string) => void
  placeholder?: string
  helpText?: string
  maxLength?: number
  required?: boolean
  logCategory?: string
}

const FORMATS = ['bold', 'italic', 'underline', 'list']

function normalizeQuillSemanticHtml(html: string) {
  if (typeof document === 'undefined' || !html) return html
  const host = document.createElement('div')
  host.innerHTML = html

  // Quill 2 can represent bullet lists as <ol><li data-list="bullet"> internally.
  // Normalize contiguous list items to semantic <ul>/<ol> markup before persistence so
  // the existing GolfHomiez sanitizer and public/print renderers preserve list intent.
  for (const list of Array.from(host.querySelectorAll('ol, ul'))) {
    const children = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    if (!children.length) continue

    const groups: Array<{ type: 'bullet' | 'ordered'; items: HTMLLIElement[] }> = []
    for (const item of children) {
      const explicitType = item.getAttribute('data-list')
      const type: 'bullet' | 'ordered' = explicitType === 'bullet' || list.tagName === 'UL' ? 'bullet' : 'ordered'
      const previous = groups.at(-1)
      if (previous?.type === type) previous.items.push(item)
      else groups.push({ type, items: [item] })
    }

    if (groups.length === 1 && ((groups[0].type === 'bullet' && list.tagName === 'UL') || (groups[0].type === 'ordered' && list.tagName === 'OL'))) {
      for (const item of groups[0].items) item.removeAttribute('data-list')
      continue
    }

    const fragment = document.createDocumentFragment()
    for (const group of groups) {
      const replacement = document.createElement(group.type === 'bullet' ? 'ul' : 'ol')
      for (const item of group.items) {
        const clone = item.cloneNode(true) as HTMLLIElement
        clone.removeAttribute('data-list')
        clone.querySelectorAll('.ql-ui').forEach((node) => node.remove())
        replacement.appendChild(clone)
      }
      fragment.appendChild(replacement)
    }
    list.replaceWith(fragment)
  }

  host.querySelectorAll('.ql-ui').forEach((node) => node.remove())
  return host.innerHTML
}

function quillPlainLength(quill: Quill) {
  const text = quill.getText()
  return text.endsWith('\n') ? text.length - 1 : text.length
}

export default function RichTextEditor({ id, label, value = '', onChange, placeholder = '', helpText, maxLength = 5000, required = false, logCategory = 'richText.editor' }: Props) {
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  const quillRef = useRef<Quill | null>(null)
  const onChangeRef = useRef(onChange)
  const labelRef = useRef(label)
  const maxLengthRef = useRef(maxLength)
  const logCategoryRef = useRef(logCategory)
  const lastEmittedHtmlRef = useRef(sanitizeRichTextHtml(value, maxLength))
  const lastValidContentsRef = useRef<ReturnType<Quill['getContents']> | null>(null)
  const applyingExternalValueRef = useRef(false)
  const [plainLength, setPlainLength] = useState(richTextToPlainText(value).length)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { labelRef.current = label }, [label])
  useEffect(() => { maxLengthRef.current = maxLength }, [maxLength])
  useEffect(() => { logCategoryRef.current = logCategory }, [logCategory])

  useEffect(() => {
    const editorContainer = editorContainerRef.current
    const toolbar = toolbarRef.current
    if (!editorContainer || !toolbar || quillRef.current) return

    const quill = new Quill(editorContainer, {
      theme: 'snow',
      placeholder,
      formats: FORMATS,
      modules: {
        toolbar: {
          container: toolbar,
        },
      },
    })
    quillRef.current = quill

    // Facebook and some other sites place emoji on the clipboard as <img> elements.
    // Convert only emoji images to Unicode text; ordinary pasted images remain rejected.
    const Delta = Quill.import('delta') as any
    quill.clipboard.addMatcher('IMG', (node) => {
      const image = node as HTMLImageElement
      const emoji = emojiTextFromClipboardImage({
        alt: image.getAttribute('alt'),
        ariaLabel: image.getAttribute('aria-label'),
        dataEmoji: image.getAttribute('data-emoji'),
        title: image.getAttribute('title'),
        src: image.getAttribute('src'),
      })
      if (!emoji) {
        logFrontendEvent({
          category: logCategoryRef.current,
          message: 'quill_pasted_image_rejected',
          data: { field: labelRef.current, correlationId: getCorrelationId() },
        })
        return new Delta()
      }
      logFrontendEvent({
        category: logCategoryRef.current,
        message: 'quill_pasted_emoji_image_converted',
        data: { field: labelRef.current, emoji, correlationId: getCorrelationId() },
      })
      return new Delta().insert(emoji)
    })

    quill.root.id = id || ''
    quill.root.setAttribute('aria-label', label)
    quill.root.setAttribute('aria-multiline', 'true')
    quill.root.setAttribute('role', 'textbox')
    if (required) quill.root.setAttribute('aria-required', 'true')

    const initialHtml = sanitizeRichTextHtml(value, maxLength)
    applyingExternalValueRef.current = true
    if (initialHtml) quill.clipboard.dangerouslyPasteHTML(0, initialHtml, 'silent')
    else quill.setText('', 'silent')
    applyingExternalValueRef.current = false
    lastValidContentsRef.current = quill.getContents()
    lastEmittedHtmlRef.current = initialHtml
    setPlainLength(richTextToPlainText(initialHtml).length)

    const handleTextChange = (_delta: unknown, _oldDelta: unknown, source: string) => {
      if (applyingExternalValueRef.current || source === 'silent') return

      const length = quillPlainLength(quill)
      if (length > maxLengthRef.current) {
        const selection = quill.getSelection()
        if (lastValidContentsRef.current) quill.setContents(lastValidContentsRef.current, 'silent')
        const safeIndex = Math.max(0, Math.min(selection?.index ?? quill.getLength() - 1, quill.getLength() - 1))
        quill.setSelection(safeIndex, 0, 'silent')
        setPlainLength(richTextToPlainText(lastEmittedHtmlRef.current).length)
        logFrontendEvent({
          category: logCategoryRef.current,
          message: 'quill_rich_text_max_length_rejected',
          data: { field: labelRef.current, maxLength: maxLengthRef.current, attemptedLength: length, correlationId: getCorrelationId() },
        })
        return
      }

      const semanticHtml = normalizeQuillSemanticHtml(quill.getSemanticHTML())
      const sanitized = sanitizeRichTextHtml(semanticHtml, maxLengthRef.current)
      lastValidContentsRef.current = quill.getContents()
      lastEmittedHtmlRef.current = sanitized
      setPlainLength(richTextToPlainText(sanitized).length)
      onChangeRef.current(sanitized)
      logFrontendEvent({
        category: logCategoryRef.current,
        message: 'quill_rich_text_changed',
        data: { field: labelRef.current, plainLength: richTextToPlainText(sanitized).length, correlationId: getCorrelationId() },
      })
    }

    const handleToolbarClick = (event: Event) => {
      const button = (event.target as HTMLElement | null)?.closest('button') as HTMLButtonElement | null
      if (!button) return
      const format = ['bold', 'italic', 'underline', 'list', 'clean'].find((name) => button.classList.contains(`ql-${name}`))
      if (!format) return
      logFrontendEvent({
        category: logCategoryRef.current,
        message: 'quill_rich_text_format_applied',
        data: { field: labelRef.current, format, value: button.value || null, correlationId: getCorrelationId() },
      })
    }

    const handlePaste = () => {
      logFrontendEvent({
        category: logCategoryRef.current,
        message: 'quill_rich_text_paste_received',
        data: { field: labelRef.current, correlationId: getCorrelationId() },
      })
    }

    quill.on('text-change', handleTextChange)
    toolbar.addEventListener('click', handleToolbarClick)
    quill.root.addEventListener('paste', handlePaste)

    logFrontendEvent({
      category: logCategoryRef.current,
      message: 'quill_rich_text_editor_initialized',
      data: { field: labelRef.current, formats: FORMATS, correlationId: getCorrelationId() },
    })

    return () => {
      quill.off('text-change', handleTextChange)
      toolbar.removeEventListener('click', handleToolbarClick)
      quill.root.removeEventListener('paste', handlePaste)
      quillRef.current = null
      editorContainer.innerHTML = ''
    }
    // Quill is intentionally initialized once; prop changes are synchronized by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const quill = quillRef.current
    if (!quill) return
    quill.root.id = id || ''
    quill.root.setAttribute('aria-label', label)
    if (required) quill.root.setAttribute('aria-required', 'true')
    else quill.root.removeAttribute('aria-required')
    quill.root.setAttribute('data-placeholder', placeholder)
  }, [id, label, placeholder, required])

  useEffect(() => {
    const quill = quillRef.current
    if (!quill) return
    const incoming = sanitizeRichTextHtml(value, maxLength)
    if (incoming === lastEmittedHtmlRef.current) return

    applyingExternalValueRef.current = true
    if (incoming) quill.clipboard.dangerouslyPasteHTML(0, incoming, 'silent')
    else quill.setText('', 'silent')
    applyingExternalValueRef.current = false
    lastValidContentsRef.current = quill.getContents()
    lastEmittedHtmlRef.current = incoming
    setPlainLength(richTextToPlainText(incoming).length)
  }, [value, maxLength])

  return (
    <div className="richTextEditor richTextEditor--quill">
      <label className="label" htmlFor={id}>{label}</label>
      <div ref={toolbarRef} className="richTextEditor__toolbar ql-toolbar ql-snow" role="toolbar" aria-label={`${label} formatting`}>
        <button type="button" className="ql-bold" title="Bold" aria-label={`Bold ${label}`} />
        <button type="button" className="ql-italic" title="Italic" aria-label={`Italic ${label}`} />
        <button type="button" className="ql-underline" title="Underline" aria-label={`Underline ${label}`} />
        <button type="button" className="ql-list" value="bullet" title="Bulleted list" aria-label={`Bulleted list ${label}`} />
        <button type="button" className="ql-list" value="ordered" title="Numbered list" aria-label={`Numbered list ${label}`} />
        <button type="button" className="ql-clean" title="Clear formatting" aria-label={`Clear formatting ${label}`} />
      </div>
      <div ref={editorContainerRef} className="richTextEditor__quill" />
      <div className="richTextEditor__meta">
        {helpText ? <span className="small">{helpText}</span> : <span />}
        <span className="small">{plainLength.toLocaleString()} / {maxLength.toLocaleString()}</span>
      </div>
    </div>
  )
}
