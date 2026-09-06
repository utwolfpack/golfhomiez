import { useEffect, useRef, useState } from 'react'
import { deletePicture, fetchPictureLibrary, uploadPicture, type PictureTarget, type UserImageRecord } from '../lib/user-images'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function PictureLibraryModal({
  open,
  title,
  target,
  onClose,
  onImageCountChange,
  viewOnly = false,
}: {
  open: boolean
  title: string
  target: PictureTarget | null
  onClose: () => void
  onImageCountChange?: (count: number) => void
  viewOnly?: boolean
}) {
  const [images, setImages] = useState<UserImageRecord[]>([])
  const [maxImages, setMaxImages] = useState(target?.kind === 'host-tournament' ? 8 : 3)
  const [canUpload, setCanUpload] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open || !target) return
    let cancelled = false
    setLoading(true)
    setError('')
    setActiveIndex(0)
    void fetchPictureLibrary(target)
      .then((response) => {
        if (cancelled) return
        setImages(response.images || [])
        setMaxImages(response.maxImages || (target.kind === 'host-tournament' ? 8 : 3))
        setCanUpload(Boolean(response.canUpload))
        onImageCountChange?.((response.images || []).length)
        logFrontendEvent({ category: 'pictures.library', message: 'picture_library_opened', data: { targetKind: target.kind, targetId: target.id, imageCount: response.images?.length || 0, canUpload: Boolean(response.canUpload) } })
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load pictures.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, target?.kind, target?.id])

  if (!open || !target) return null

  const remaining = Math.max(maxImages - images.length, 0)
  const activeImage = images.length ? images[Math.min(activeIndex, images.length - 1)] : null

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !canUpload || remaining <= 0) return
    const selected = Array.from(files).slice(0, remaining)
    setBusy(true)
    setError('')
    try {
      let nextImages = [...images]
      for (const file of selected) {
        const response = await uploadPicture(target!, file)
        nextImages = [...nextImages, response.image]
        setImages(nextImages)
        onImageCountChange?.(nextImages.length)
      }
      setActiveIndex(Math.max(0, nextImages.length - selected.length))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload picture.')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function removeImage(image: UserImageRecord) {
    if (!canUpload || busy) return
    setBusy(true)
    setError('')
    try {
      await deletePicture(target!, image.id)
      const next = images.filter((item) => item.id !== image.id)
      setImages(next)
      setActiveIndex((current) => Math.max(0, Math.min(current, next.length - 1)))
      onImageCountChange?.(next.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete picture.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modalOverlay pictureLibraryOverlay" role="presentation" onClick={onClose}>
      <div className="modalCard pictureLibraryModal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="pictureLibraryHeader">
          <div>
            <h2>{title}</h2>
            <div className="small">{images.length} of {maxImages} pictures</div>
          </div>
          <button className="btn btnSmall" type="button" onClick={onClose}>Close</button>
        </div>

        {error ? <div className="errorBox" role="alert">{error}</div> : null}
        {loading ? <div className="small">Loading pictures…</div> : null}

        {!loading && activeImage ? (
          <div className="pictureViewer">
            <img src={activeImage.url} alt={`Picture ${activeIndex + 1} of ${images.length}`} />
            {images.length > 1 ? (
              <div className="pictureViewerControls">
                <button className="btn btnSmall" type="button" onClick={() => setActiveIndex((activeIndex - 1 + images.length) % images.length)}>Previous</button>
                <span className="small">{activeIndex + 1} of {images.length}</span>
                <button className="btn btnSmall" type="button" onClick={() => setActiveIndex((activeIndex + 1) % images.length)}>Next</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading && images.length === 0 ? <div className="pictureLibraryEmpty">No pictures have been added yet.</div> : null}

        {images.length > 1 ? (
          <div className="pictureThumbnailGrid" aria-label="Picture thumbnails">
            {images.map((image, index) => (
              <button key={image.id} type="button" className={`pictureThumbnail${index === activeIndex ? ' pictureThumbnail--active' : ''}`} onClick={() => setActiveIndex(index)}>
                <img src={image.url} alt={`Open picture ${index + 1}`} />
              </button>
            ))}
          </div>
        ) : null}

        {!viewOnly && canUpload ? (
          <div className="pictureLibraryActions">
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => void handleFiles(event.target.files)} />
            <button className="btnPrimary" type="button" disabled={busy || remaining <= 0} onClick={() => fileInputRef.current?.click()}>
              {busy ? 'Working…' : remaining > 0 ? `Add Pictures (${remaining} remaining)` : `Maximum ${maxImages} Pictures`}
            </button>
            {activeImage ? <button className="btn" type="button" disabled={busy} onClick={() => void removeImage(activeImage)}>Delete Current Picture</button> : null}
          </div>
        ) : !viewOnly && images.length ? <div className="small">Only the golfer who created this challenge can add or delete pictures.</div> : null}
      </div>
    </div>
  )
}
