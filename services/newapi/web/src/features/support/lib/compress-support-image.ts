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
const SUPPORT_IMAGE_WEBP_QUALITY = 0.7
const SUPPORT_IMAGE_MAX_BYTES = 2.75 * 1024 * 1024

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (!result.startsWith('data:image/')) {
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

function canvasToWebpBlob(
  image: HTMLImageElement,
  maxWidth: number,
  quality: number
): Promise<Blob> {
  const scale = image.width > maxWidth ? maxWidth / image.width : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to upload image')
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
      'image/webp',
      quality
    )
  })
}

async function encodeSupportImage(image: HTMLImageElement): Promise<Blob> {
  const widths = [SUPPORT_IMAGE_MAX_WIDTH, 1600, 1280, 1024]
  const qualities = [SUPPORT_IMAGE_WEBP_QUALITY, 0.55, 0.4, 0.3]
  let smallest: Blob | null = null

  for (const width of widths) {
    for (const quality of qualities) {
      const blob = await canvasToWebpBlob(image, width, quality)
      smallest = !smallest || blob.size < smallest.size ? blob : smallest
      if (blob.size <= SUPPORT_IMAGE_MAX_BYTES) return blob
    }
  }

  if (!smallest || smallest.size > SUPPORT_IMAGE_MAX_BYTES) {
    throw new Error('Unable to upload image')
  }
  return smallest
}

export async function compressSupportImage(file: File): Promise<string> {
  if (
    !(file instanceof File) ||
    file.size <= 0 ||
    !file.type.startsWith('image/')
  ) {
    throw new Error('Unable to upload image')
  }

  const originalDataUrl = await readBlobAsDataUrl(file)
  const image = await loadImage(originalDataUrl)
  const compressed = await encodeSupportImage(image)
  const webpFile = new File(
    [compressed],
    `${file.name.replace(/\.[^/.]+$/, '')}.webp`,
    {
      type: 'image/webp',
      lastModified: Date.now(),
    }
  )
  return readBlobAsDataUrl(webpFile)
}
