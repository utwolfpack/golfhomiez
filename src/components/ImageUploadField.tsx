import { useState } from 'react'
import { compressImageFile, type ImageUploadOptions } from '../lib/image-upload'
import { logFrontendEvent } from '../lib/frontend-logger'

type Props = {
  label: string
  value?: string | null
  emptyText?: string
  previewAlt: string
  onChange: (dataUrl: string) => void
  onRemove?: () => void
  options?: ImageUploadOptions
}

export default function ImageUploadField({ label, value, emptyText = 'No image uploaded.', previewAlt, onChange, onRemove, options }: Props) {
  const [uploadError, setUploadError] = useState('')

  async function handleFile(file?: File | null) {
    if (!file) return
    try {
      setUploadError('')
      logFrontendEvent({ category: 'image.upload', message: 'image_upload_started', data: { label, size: file.size, type: file.type } })
      const result = await compressImageFile(file, options)
      onChange(result.dataUrl)
      logFrontendEvent({ category: 'image.upload', message: 'image_upload_completed', data: { label, originalSize: result.originalSize, compressedSize: result.compressedSize } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUploadError(message)
      logFrontendEvent({ category: 'image.upload', level: 'error', message: 'image_upload_failed', data: { label, error: message } })
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <label className="label">{label}</label>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {value ? <img src={value} alt={previewAlt} style={{ width: 160, height: 100, borderRadius: 12, objectFit: 'cover', border: '1px solid #d1d5db' }} /> : <div className="small" style={{ width: 160 }}>{emptyText}</div>}
        <input className="input" type="file" accept="image/*" onChange={(e) => { void handleFile(e.target.files?.[0]); e.currentTarget.value = '' }} style={{ maxWidth: 340 }} />
        {value && onRemove ? <button type="button" className="btn" onClick={onRemove}>Remove image</button> : null}
      </div>
      {uploadError ? <div className="error" role="alert" style={{ marginTop: 8 }}>{uploadError}</div> : null}
    </div>
  )
}
