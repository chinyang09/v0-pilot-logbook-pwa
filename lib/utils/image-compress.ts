/**
 * Client-side image compression using Canvas API
 * Prevents memory crashes on mobile devices (iPad, iPhone)
 * when processing large camera photos for OCR
 */

export async function compressImage(
  file: File,
  maxDimension = 2048,
  quality = 0.8
): Promise<File> {
  // Skip if already small enough or not an image
  if (file.size < 1024 * 1024 || !file.type.startsWith("image/")) {
    return file
  }

  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      let { width, height } = img

      // Scale down if exceeds maxDimension
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }

      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(file)
        return
      }
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
