/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

const SUPPORT_IMAGE_MAX_WIDTH = 1920
const SUPPORT_IMAGE_JPEG_QUALITY = 0.82
const SUPPORT_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const SUPPORT_IMAGE_OUTPUT_TYPES = ['image/jpeg', 'image/png'] as const

function isCompressibleImageFile(file: File): boolean {
  if (!(file instanceof File) || file.size <= 0) return false
  const type = String(file.type || '')
    .trim()
    .toLowerCase()
  if (!type || type === 'application/octet-stream') return true
  return type.startsWith('image/')
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (!result.startsWith('data:')) {
        reject(new Error('Unable to upload image'))
        return
      }
      resolve(result)
    })
    reader.addEventListener('error', () => {
      reject(new Error('Unable to upload image'))
    })
    reader.readAsDataURL(blob)
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () =>
      reject(new Error('Unable to upload image'))
    )
    image.src = dataUrl
  })
}

function canvasToBlob(
  image: HTMLImageElement,
  maxWidth: number,
  mimeType: (typeof SUPPORT_IMAGE_OUTPUT_TYPES)[number],
  quality?: number
): Promise<Blob> {
  const scale = image.width > maxWidth ? maxWidth / image.width : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to upload image')
  }
  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Unable to upload image'))
          return
        }
        resolve(blob)
      },
      mimeType,
      quality
    )
  })
}

function normalizeOutputContentType(blob: Blob, fallback: string): string {
  const type = String(blob.type || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (type === 'image/jpg') return 'image/jpeg'
  if (
    type === 'image/jpeg' ||
    type === 'image/png' ||
    type === 'image/webp' ||
    type === 'image/gif'
  ) {
    return type
  }
  return fallback
}

function extensionForContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'image/gif') return 'gif'
  return 'jpg'
}

async function encodeSupportImage(image: HTMLImageElement): Promise<Blob> {
  const widths = [SUPPORT_IMAGE_MAX_WIDTH, 1600, 1280, 1024]
  const qualities = [SUPPORT_IMAGE_JPEG_QUALITY, 0.7, 0.55, 0.4]
  let smallest: Blob | null = null

  for (const mimeType of SUPPORT_IMAGE_OUTPUT_TYPES) {
    const qualitySteps = mimeType === 'image/jpeg' ? qualities : [undefined]
    for (const width of widths) {
      for (const quality of qualitySteps) {
        const blob = await canvasToBlob(image, width, mimeType, quality)
        smallest = !smallest || blob.size < smallest.size ? blob : smallest
        if (blob.size <= SUPPORT_IMAGE_MAX_BYTES) return blob
      }
    }
  }

  if (!smallest || smallest.size > SUPPORT_IMAGE_MAX_BYTES) {
    throw new Error('Unable to upload image')
  }
  return smallest
}

export async function compressSupportImage(file: File): Promise<string> {
  if (!isCompressibleImageFile(file)) {
    throw new Error('Unable to upload image')
  }

  const originalDataUrl = await readBlobAsDataUrl(file)
  const image = await loadImage(originalDataUrl)
  const compressed = await encodeSupportImage(image)
  const contentType = normalizeOutputContentType(compressed, 'image/jpeg')
  const compressedFile = new File(
    [compressed],
    `${file.name.replace(/\.[^/.]+$/, '')}.${extensionForContentType(contentType)}`,
    {
      type: contentType,
      lastModified: Date.now(),
    }
  )
  return readBlobAsDataUrl(compressedFile)
}
