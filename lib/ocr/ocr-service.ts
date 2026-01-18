/**
 * OCR Service - Handles text extraction from images using gutenye OCR
 *
 * This service provides OCR capabilities for extracting text from flight documents,
 * pilot logs, and other aviation-related images containing OOOI times and flight data.
 */

// Type definitions for the OCR library
interface OcrResult {
  text: string
  confidence: number
  box: number[][] // Bounding box coordinates
}

interface OcrDetectResult {
  lines: OcrResult[]
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
 * Extract text from an image file
 */
export async function extractTextFromImage(file: File): Promise<OcrResult[]> {
  try {
    // Initialize OCR if needed
    const ocr = await initializeOCR()

    // Convert file to data URL - the OCR library expects a URL string, not ImageData
    const dataUrl = await fileToDataUrl(file)

    // Perform OCR
    const result = await ocr.detect(dataUrl)

    // Return the detected text lines
    return result.lines || []
  } catch (error) {
    console.error('Error extracting text from image:', error)
    throw error
  }
}

/**
 * Extract all text as a single string (concatenated)
 */
export async function extractTextAsString(file: File): Promise<string> {
  const lines = await extractTextFromImage(file)
  return lines.map(line => line.text).join('\n')
}

/**
 * Convert a File to a data URL string for OCR processing
 * The @gutenye/ocr-browser library expects a URL string (file path or data URL),
 * not an ImageData object. Passing ImageData directly causes load errors because
 * the library tries to use it as a URL in image.src = url.
 */
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (!dataUrl) {
        reject(new Error('Failed to read file as data URL'))
        return
      }
      resolve(dataUrl)
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsDataURL(file)
  })
}

/**
 * Preload OCR models (optional, for better UX)
 * Call this early in the app lifecycle to avoid delays later
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
