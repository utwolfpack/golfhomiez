import { useEffect, useRef, useState } from 'react'
import { deletePicture, fetchPictureLibrary, uploadPicture, type UserImageRecord } from '../lib/user-images'

export default function TournamentPicturesField({ tournamentId, onImageCountChange }: { tournamentId: string; onImageCountChange?: (count: number) => void }) {
  const target = { kind: 'host-tournament' as const, id: tournamentId }
  const [images, setImages] = useState<UserImageRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const maxImages = 8

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchPictureLibrary(target)
      .then((response) => {
        if (cancelled) return
        setImages(response.images || [])
        onImageCountChange?.((response.images || []).length)
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load tournament pictures.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tournamentId])

  async function addFiles(files: FileList | null) {
    const remaining = Math.max(maxImages - images.length, 0)
    if (!files?.length || remaining <= 0) return
    setBusy(true)
    setError('')
    try {
      let next = [...images]
      for (const file of Array.from(files).slice(0, remaining)) {
        const response = await uploadPicture(target, file)
        next = [...next, response.image]
        setImages(next)
        onImageCountChange?.(next.length)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload tournament picture.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(image: UserImageRecord) {
    setBusy(true)
    setError('')
    try {
      await deletePicture(target, image.id)
      const next = images.filter((item) => item.id !== image.id)
      setImages(next)
      onImageCountChange?.(next.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete tournament picture.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="tournamentPicturesField" aria-label="Tournament Pictures">
      <div className="tournamentPicturesFieldHeader">
        <div>
          <h3>Tournament Pictures</h3>
          <div className="small">Add up to 8 compressed tournament pictures. {images.length} of 8 used.</div>
        </div>
        <div>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => void addFiles(event.target.files)} />
          <button className="btn" type="button" disabled={busy || images.length >= maxImages} onClick={() => inputRef.current?.click()}>
            {busy ? 'Working…' : images.length >= maxImages ? '8 Pictures Added' : 'Add Pictures'}
          </button>
        </div>
      </div>
      {error ? <div className="errorBox" role="alert">{error}</div> : null}
      {loading ? <div className="small">Loading pictures…</div> : null}
      {!loading && images.length ? (
        <div className="tournamentPicturesGrid">
          {images.map((image, index) => (
            <div className="tournamentPictureCard" key={image.id}>
              <img src={image.url} alt={`Tournament picture ${index + 1}`} />
              <button className="btn btnSmall" type="button" disabled={busy} onClick={() => void remove(image)}>Remove</button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
