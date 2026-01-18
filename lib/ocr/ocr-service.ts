/**
 * OCR Service - Simplified text extraction using gutenye OCR
 */

// Type matching actual OCR library output
export interface OcrTextResult {
  text: string
  mean: number
  box: number[][]
}

// Singleton state
let ocrInstance: any = null
let initPromise: Promise<any> | null = null

/**
 * Initialize OCR engine (singleton)
 */
async function getOCR(): Promise<any> {
  if (ocrInstance) return ocrInstance
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const OcrModule = await import('@gutenye/ocr-browser')
      const Ocr = OcrModule.default || OcrModule.Ocr || OcrModule

      ocrInstance = await Ocr.create({
        models: {
          detectionPath: '/models/ch_PP-OCRv4_det_infer.onnx',
          recognitionPath: '/models/ch_PP-OCRv4_rec_infer.onnx',
          dictionaryPath: '/models/ppocr_keys_v1.txt',
        },
      })
      return ocrInstance
    } catch (error) {
      initPromise = null
      throw error
    }
  })()

  return initPromise
}

/**
 * Convert File to ImageData
 */
function fileToImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas context failed'))
          return
        }
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height))
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * Extract text from image file
 */
export async function extractTextFromImage(file: File): Promise<OcrTextResult[]> {
  const ocr = await getOCR()
  const imageData = await fileToImageData(file)
  const result = await ocr.detect(imageData)
  return result?.lines || []
}

/**
 * Initialize OCR (for preloading)
 */
export async function initializeOCR(): Promise<void> {
  await getOCR()
}

/**
 * Check if OCR is ready
 */
export function isOCRReady(): boolean {
  return ocrInstance !== null
}

/**
 * Preload OCR models
 */
export async function preloadOCR(): Promise<void> {
  try {
    await getOCR()
  } catch (e) {
    console.warn('OCR preload failed:', e)
  }
}

/**
 * Reset OCR instance
 */
export function resetOCR(): void {
  ocrInstance = null
  initPromise = null
}
