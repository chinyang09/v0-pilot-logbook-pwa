/**
 * OCR Service - Browser-based text extraction using gutenye OCR
 */

// Re-export type from extractor (single source of truth)
export type { OcrResult } from "./oooi-extractor"

interface OcrRawResult {
  text: string
  mean: number
  box: number[][]
}

interface OcrInstance {
  detect: (input: string) => Promise<OcrRawResult[]>
}

let ocrInstance: OcrInstance | null = null
let initPromise: Promise<OcrInstance> | null = null

export async function initializeOCR(): Promise<OcrInstance> {
  if (ocrInstance) return ocrInstance
  if (initPromise) return initPromise

  initPromise = (async () => {
    const { default: Ocr } = await import("@gutenye/ocr-browser")

    const instance = await Ocr.create({
      models: {
        detectionPath: "/models/ch_PP-OCRv4_det_infer.onnx",
        recognitionPath: "/models/ch_PP-OCRv4_rec_infer.onnx",
        dictionaryPath: "/models/ppocr_keys_v1.txt",
      },
    }) as unknown as OcrInstance

    ocrInstance = instance
    return instance
  })()

  return initPromise!
}

export async function extractTextFromImage(
  file: File
): Promise<import("./oooi-extractor").OcrResult[]> {
  const ocr = await initializeOCR()
  const dataUrl = await fileToDataUrl(file)
  const rawResults = await ocr.detect(dataUrl)

  return rawResults
    .map((item) => ({
      text: item.text.trim(),
      confidence: item.mean,
      box: item.box,
    }))
    .filter((item) => item.text.length > 0)
    .sort((a, b) => {
      // Sort by Y then X
      const ay = (a.box[0][1] + a.box[2][1]) / 2
      const by = (b.box[0][1] + b.box[2][1]) / 2
      if (Math.abs(ay - by) > 10) return ay - by
      return a.box[0][0] - b.box[0][0]
    })
}

export async function extractTextAsString(file: File): Promise<string> {
  const results = await extractTextFromImage(file)
  return results.map((r) => r.text).join("\n")
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

export async function preloadOCR(): Promise<void> {
  try {
    await initializeOCR()
  } catch (e) {
    console.warn("OCR preload failed:", e)
  }
}

export function isOCRReady(): boolean {
  return ocrInstance !== null
}

export function resetOCR(): void {
  ocrInstance = null
  initPromise = null
}

/**
 * Check if OCR models are cached for offline use
 */
export async function checkOCRModelsCached(): Promise<{
  allCached: boolean
  details: Array<{ path: string; cached: boolean }>
}> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { allCached: false, details: [] }
  }

  const registration = await navigator.serviceWorker.ready
  if (!registration.active) {
    return { allCached: false, details: [] }
  }

  return new Promise((resolve) => {
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === "OCR_MODELS_CACHE_STATUS") {
        navigator.serviceWorker.removeEventListener("message", messageHandler)
        resolve({
          allCached: event.data.allCached,
          details: event.data.details,
        })
      }
    }

    navigator.serviceWorker.addEventListener("message", messageHandler)
    registration.active.postMessage({ type: "CHECK_OCR_MODELS_CACHED" })

    // Timeout after 5 seconds
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", messageHandler)
      resolve({ allCached: false, details: [] })
    }, 5000)
  })
}

/**
 * Ensure OCR models are cached for offline use
 * Call this proactively when online to prepare for offline usage
 */
export async function ensureOCRModelsCached(): Promise<{
  success: boolean
  details: Array<{ path: string; success: boolean; error?: string }>
}> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { success: false, details: [] }
  }

  const registration = await navigator.serviceWorker.ready
  if (!registration.active) {
    return { success: false, details: [] }
  }

  return new Promise((resolve) => {
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === "OCR_MODELS_CACHE_RESULT") {
        navigator.serviceWorker.removeEventListener("message", messageHandler)
        resolve({
          success: event.data.success,
          details: event.data.details,
        })
      }
    }

    navigator.serviceWorker.addEventListener("message", messageHandler)
    registration.active.postMessage({ type: "CACHE_OCR_MODELS" })

    // Timeout after 60 seconds (models are large)
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", messageHandler)
      resolve({ success: false, details: [] })
    }, 60000)
  })
}
