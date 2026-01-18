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
