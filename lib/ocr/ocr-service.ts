/**
 * OCR Service - Handles text extraction from images using gutenye OCR
 *
 * This service provides OCR capabilities for extracting text from flight documents,
 * specifically focused on OOOI times extraction from AOC VOYAGE reports.
 */

// Type definitions matching the actual OCR library output
export interface OcrTextResult {
  text: string
  mean: number // Confidence score (0-1)
  box: number[][] // Bounding box coordinates [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
}

interface OcrDetectResult {
  lines: OcrTextResult[]
}

interface OcrInstance {
  detect: (imagePath: string | ImageData | HTMLImageElement) => Promise<OcrDetectResult>
}

interface OcrConfig {
  models: {
    detectionPath: string
    recognitionPath: string
    dictionaryPath: string
  }
}

// Singleton instance
let ocrInstance: OcrInstance | null = null
let isInitializing = false
let initializationPromise: Promise<OcrInstance> | null = null

/**
 * Initialize the OCR engine
 * This is an expensive operation, so we use a singleton pattern
 */
export async function initializeOCR(): Promise<OcrInstance> {
  // Return existing instance if available
  if (ocrInstance) {
    return ocrInstance
  }

  // If already initializing, wait for that promise
  if (isInitializing && initializationPromise) {
    return initializationPromise
  }

  isInitializing = true

  initializationPromise = (async () => {
    try {
      // Dynamically import the OCR library (client-side only)
      const { default: Ocr } = await import('@gutenye/ocr-browser')

      const config: OcrConfig = {
        models: {
          detectionPath: '/models/ch_PP-OCRv4_det_infer.onnx',
          recognitionPath: '/models/ch_PP-OCRv4_rec_infer.onnx',
          dictionaryPath: '/models/ppocr_keys_v1.txt',
        },
      }

      const instance = await Ocr.create(config)
      ocrInstance = instance
      isInitializing = false
      return instance
    } catch (error) {
      isInitializing = false
      initializationPromise = null
      throw new Error(`Failed to initialize OCR: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()

  return initializationPromise
}

/**
 * Extract raw OCR results from an image file
 * Returns the unprocessed OCR output for downstream processing
 */
export async function extractTextFromImage(file: File): Promise<OcrTextResult[]> {
  try {
    const ocr = await initializeOCR()
    const imageData = await fileToImageData(file)
    const result = await ocr.detect(imageData)
    return result.lines || []
  } catch (error) {
    console.error('Error extracting text from image:', error)
    throw error
  }
}

/**
 * Convert a File to ImageData for OCR processing
 */
async function fileToImageData(file: File): Promise<ImageData> {
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
          reject(new Error('Failed to get canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        resolve(imageData)
      }

      img.onerror = () => {
        reject(new Error('Failed to load image'))
      }

      img.src = e.target?.result as string
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsDataURL(file)
  })
}

/**
 * Preload OCR models (optional, for better UX)
 */
export async function preloadOCR(): Promise<void> {
  try {
    await initializeOCR()
    console.log('OCR models preloaded successfully')
  } catch (error) {
    console.warn('Failed to preload OCR models:', error)
  }
}

/**
 * Check if OCR is ready (models loaded)
 */
export function isOCRReady(): boolean {
  return ocrInstance !== null
}

/**
 * Reset OCR instance (useful for testing or troubleshooting)
 */
export function resetOCR(): void {
  ocrInstance = null
  isInitializing = false
  initializationPromise = null
}
