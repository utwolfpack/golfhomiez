import { logFrontendEvent } from './frontend-logger'

export type ImageUploadResult = {
  dataUrl: string
  originalSize: number
  compressedSize: number
  width: number
  height: number
  mimeType: string
}

export type ImageUploadOptions = {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  outputType?: string
  maxBytes?: number
  minQuality?: number
  correlationData?: Record<string, unknown>
}

const DEFAULT_MAX_WIDTH = 1600
const DEFAULT_MAX_HEIGHT = 1600
const DEFAULT_QUALITY = 0.78
const DEFAULT_MIN_QUALITY = 0.5
const DEFAULT_MAX_BYTES = 450 * 1024
const DEFAULT_OUTPUT_TYPE = 'image/jpeg'

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || ''
  return Math.round((base64.length * 3) / 4)
}

function renderToDataUrl(image: HTMLImageElement, width: number, height: number, mimeType: string, quality: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image compression is not available in this browser.')
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL(mimeType, quality)
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The selected image could not be loaded.'))
    image.src = dataUrl
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read image file.'))
    reader.readAsDataURL(file)
  })
}

export async function compressImageFile(file: File, options: ImageUploadOptions = {}): Promise<ImageUploadResult> {
  if (!file.type.startsWith('image/')) throw new Error('Please select an image file.')

  const sourceDataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(sourceDataUrl)
  const maxWidth = options.maxWidth || DEFAULT_MAX_WIDTH
  const maxHeight = options.maxHeight || DEFAULT_MAX_HEIGHT
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES
  const minQuality = options.minQuality ?? DEFAULT_MIN_QUALITY
  const mimeType = options.outputType || DEFAULT_OUTPUT_TYPE

  let ratio = Math.min(1, maxWidth / image.width, maxHeight / image.height)
  let width = Math.max(1, Math.round(image.width * ratio))
  let height = Math.max(1, Math.round(image.height * ratio))
  let quality = options.quality ?? DEFAULT_QUALITY
  let compressedDataUrl = renderToDataUrl(image, width, height, mimeType, quality)
  let compressedSize = estimateDataUrlBytes(compressedDataUrl)
  let attempts = 0

  while (compressedSize > maxBytes && attempts < 12) {
    attempts += 1
    if (quality > minQuality) {
      quality = Math.max(minQuality, quality - 0.1)
    } else {
      ratio *= 0.82
      width = Math.max(1, Math.round(image.width * ratio))
      height = Math.max(1, Math.round(image.height * ratio))
      quality = options.quality ?? DEFAULT_QUALITY
    }
    compressedDataUrl = renderToDataUrl(image, width, height, mimeType, quality)
    compressedSize = estimateDataUrlBytes(compressedDataUrl)
  }

  if (compressedSize > maxBytes) {
    throw new Error('The selected image is still too large after compression. Please choose a smaller image.')
  }

  const result = {
    dataUrl: compressedDataUrl,
    originalSize: file.size,
    compressedSize,
    width,
    height,
    mimeType,
  }

  logFrontendEvent({
    category: 'image.upload',
    message: 'image_compressed',
    data: { fileType: file.type, ...result, ...(options.correlationData || {}) },
  })

  return result
}
