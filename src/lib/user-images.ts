import { api } from './api'
import { compressImageFile } from './image-upload'
import { getCorrelationId, logFrontendEvent } from './frontend-logger'

export type UserImageRecord = {
  id: string
  entityType: 'score' | 'challenge' | 'tournament' | string
  entityId: string
  mimeType: string
  byteSize: number
  width?: number | null
  height?: number | null
  originalName?: string | null
  displayOrder?: number
  createdAt?: string | null
  url: string
}

export type PictureTarget =
  | { kind: 'score'; id: string }
  | { kind: 'challenge'; id: string }
  | { kind: 'host-tournament'; id: string }

export type PictureLibraryResponse = {
  images: UserImageRecord[]
  maxImages: number
  canUpload: boolean
}

function targetBaseUrl(target: PictureTarget) {
  const id = encodeURIComponent(target.id)
  if (target.kind === 'score') return `/api/scores/${id}/images`
  if (target.kind === 'challenge') return `/api/inbox/messages/${id}/images`
  return `/api/host/tournaments/${id}/images`
}

export async function fetchPictureLibrary(target: PictureTarget) {
  return api<PictureLibraryResponse>(targetBaseUrl(target))
}

export async function uploadPicture(target: PictureTarget, file: File) {
  const correlationId = getCorrelationId()
  logFrontendEvent({
    category: 'pictures.upload',
    message: 'picture_upload_started',
    data: { correlationId, targetKind: target.kind, targetId: target.id, originalBytes: file.size, originalType: file.type },
  })
  const compressed = await compressImageFile(file, {
    maxWidth: 1600,
    maxHeight: 1600,
    maxBytes: 450 * 1024,
    quality: 0.82,
    minQuality: 0.56,
    correlationData: { correlationId, targetKind: target.kind, targetId: target.id },
  })
  const response = await api<{ image: UserImageRecord; imageCount: number; maxImages: number }>(targetBaseUrl(target), {
    method: 'POST',
    body: JSON.stringify({
      dataUrl: compressed.dataUrl,
      originalName: file.name,
      width: compressed.width,
      height: compressed.height,
    }),
  })
  logFrontendEvent({
    category: 'pictures.upload',
    message: 'picture_upload_completed',
    data: { correlationId, targetKind: target.kind, targetId: target.id, imageId: response.image.id, compressedBytes: compressed.compressedSize, imageCount: response.imageCount },
  })
  return response
}

export async function deletePicture(target: PictureTarget, imageId: string) {
  const correlationId = getCorrelationId()
  logFrontendEvent({ category: 'pictures.delete', message: 'picture_delete_started', data: { correlationId, targetKind: target.kind, targetId: target.id, imageId } })
  await api<void>(`${targetBaseUrl(target)}/${encodeURIComponent(imageId)}`, { method: 'DELETE' })
  logFrontendEvent({ category: 'pictures.delete', message: 'picture_delete_completed', data: { correlationId, targetKind: target.kind, targetId: target.id, imageId } })
}

export async function fetchPublicTournamentPictures(tournamentId: string) {
  return api<{ tournament: { id: string; name: string; startDate?: string | null; status?: string | null; imageCount?: number }; images: UserImageRecord[] }>(
    `/api/tournament-portals/${encodeURIComponent(tournamentId)}/images`,
  )
}
