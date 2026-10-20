/**
 * Client-side image compression using Canvas API
 * Prevents memory crashes on mobile devices (iPad, iPhone)
 * when processing large camera photos for OCR
 */

import { OCR_MAX_SIDE } from "@/lib/ocr/limits"

/**
 * Downscale an image so its longest side is at most `maxDimension`.
 *
 * Decided on PIXELS, not bytes. It used to return anything under 1MB
 * untouched, but a phone's JPEG can be 12 megapixels and well under 1MB — and
 * the OCR engine's detection pass runs at the full resolution it is handed, so
 * that photo was read at 4032px for no gain. An image already within the limit
 * is returned as it came.
 */
export async function compressImage(
  file: File,
  maxDimension = OCR_MAX_SIDE,
  quality = 0.85
): Promise<File> {
  if (!file.type.startsWith("image/")) return file

  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Natural size is post-EXIF-orientation in every current engine
      // (`image-orientation: from-image` is the default), so the canvas below
      // draws the photo the right way up.
      let { naturalWidth: width, naturalHeight: height } = img
      if (Math.max(width, height) <= maxDimension) {
        resolve(file)
        return
      }

      const scale = maxDimension / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)

      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(file)
        return
      }
      // A 4x single-step reduction with the default (low) smoothing aliases
      // thin strokes — exactly what a 7-segment-ish MCDU digit is made of.
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          resolve(new File([blob], file.name, { type: "image/jpeg" }))
        },
        "image/jpeg",
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }

    img.src = url
  })
}
