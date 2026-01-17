/**
 * Server-Side OCR Service - Handles text extraction from images using gutenye OCR Node
 *
 * This service provides OCR capabilities for extracting text from flight documents,
 * pilot logs, and other aviation-related images containing OOOI times and flight data.
 *
 * Unlike the browser version, this runs on the server using @gutenye/ocr-node
 */

import path from 'path'
import { promises as fs } from 'fs'

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
  detect: (imagePath: string | Buffer) => Promise<OcrDetectResult>
}

interface OcrConfig {
  models: {
    detectionPath: string
    recognitionPath: string
    dictionaryPath: string
  }
}

// Singleton instance for server-side OCR
let ocrInstance: OcrInstance | null = null
let isInitializing = false
let initializationPromise: Promise<OcrInstance> | null = null

/**
 * Get the absolute path to the models directory
 */
function getModelsPath(): string {
  // In production, models are in public/models
  // In development, they're also in public/models
  return path.join(process.cwd(), 'public', 'models')
}

/**
 * Initialize the OCR engine (server-side)
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
      // Dynamically import the OCR library (server-side)
      const { default: Ocr } = await import('@gutenye/ocr-node')

      const modelsPath = getModelsPath()

      // Verify models exist
      const detectionPath = path.join(modelsPath, 'ch_PP-OCRv4_det_infer.onnx')
      const recognitionPath = path.join(modelsPath, 'ch_PP-OCRv4_rec_infer.onnx')
      const dictionaryPath = path.join(modelsPath, 'ppocr_keys_v1.txt')

      // Check if model files exist
      await Promise.all([
        fs.access(detectionPath),
        fs.access(recognitionPath),
        fs.access(dictionaryPath),
      ]).catch(() => {
        throw new Error(`OCR model files not found in ${modelsPath}. Ensure models are downloaded.`)
      })

      const config: OcrConfig = {
        models: {
          detectionPath,
          recognitionPath,
          dictionaryPath,
        },
      }

      console.log('[OCR Server] Initializing OCR with models from:', modelsPath)
      const instance = await Ocr.create(config)
      ocrInstance = instance
      isInitializing = false
      console.log('[OCR Server] OCR initialized successfully')
      return instance
    } catch (error) {
      isInitializing = false
      initializationPromise = null
      console.error('[OCR Server] Failed to initialize OCR:', error)
      throw new Error(`Failed to initialize OCR: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()

  return initializationPromise
}

/**
 * Extract text from an image buffer
 */
export async function extractTextFromBuffer(buffer: Buffer): Promise<OcrResult[]> {
  try {
    // Initialize OCR if needed
    const ocr = await initializeOCR()

    // Perform OCR on the buffer
    const result = await ocr.detect(buffer)

    // Return the detected text lines
    return result.lines || []
  } catch (error) {
    console.error('[OCR Server] Error extracting text from buffer:', error)
    throw error
  }
}

/**
 * Extract text from an image file path
 */
export async function extractTextFromFile(filePath: string): Promise<OcrResult[]> {
  try {
    // Initialize OCR if needed
    const ocr = await initializeOCR()

    // Perform OCR on the file
    const result = await ocr.detect(filePath)

    // Return the detected text lines
    return result.lines || []
  } catch (error) {
    console.error('[OCR Server] Error extracting text from file:', error)
    throw error
  }
}

/**
 * Extract all text as a single string from a buffer
 */
export async function extractTextAsString(buffer: Buffer): Promise<string> {
  const lines = await extractTextFromBuffer(buffer)
  return lines.map(line => line.text).join('\n')
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

/**
 * Pre-warm the OCR engine (optional, for better performance)
 */
export async function warmupOCR(): Promise<void> {
  try {
    await initializeOCR()
    console.log('[OCR Server] OCR engine warmed up')
  } catch (error) {
    console.warn('[OCR Server] Failed to warm up OCR:', error)
  }
}
