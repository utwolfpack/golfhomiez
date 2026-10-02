import { sanitizeRichTextHtml, richTextHasContent } from '../lib/rich-text'

type Props = {
  value?: string | null
  className?: string
  ariaLabel?: string
}

export default function RichTextContent({ value, className = '', ariaLabel }: Props) {
  if (!richTextHasContent(value)) return null
  const html = sanitizeRichTextHtml(value)
  return <div className={`richTextContent${className ? ` ${className}` : ''}`} aria-label={ariaLabel} dangerouslySetInnerHTML={{ __html: html }} />
}
