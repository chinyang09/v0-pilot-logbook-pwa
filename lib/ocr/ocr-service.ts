/**
 * OCR Service - Hybrid implementation
 *
 * Primary: Server-side OCR using gutenye/ocr-node (when online)
 * Fallback: Browser-based OCR using gutenye/ocr-browser (when offline)
 *
 * The server-side OCR is faster and more reliable, but requires network.
 * Browser-based OCR works completely offline using WebAssembly.
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

// Browser OCR singleton
let browserOcrInstance: OcrInstance | null = null
let browserInitPromise: Promise<OcrInstance> | null = null

/** The runtime binary, at the URL the service worker precaches. */
const ORT_WASM_URL = "/models/ort-wasm-simd-threaded.wasm"

/**
 * How long the server may take before the browser engine is used instead.
 * Covers a cold start (the function boots and loads two models, ~3-5s) with
 * room to spare; past that the connection is the problem, and waiting longer
 * only delays the fallback.
 */
const SERVER_TIMEOUT_MS = 20_000

/**
 * After the server fails, skip it for a while. Every attempt costs an upload
 * and a round trip BEFORE the fallback starts, so retrying a server that just
 * refused made every photo pay twice — which is what each one did while the
 * deployed route could not load its engine.
 */
const SERVER_RETRY_AFTER_MS = 5 * 60_000
let serverDownUntil = 0

function serverUsable(): boolean {
  return isOnline() && Date.now() >= serverDownUntil
}

function markServerDown(): void {
  serverDownUntil = Date.now() + SERVER_RETRY_AFTER_MS
}

/**
 * Initialize browser-based OCR (fallback)
 */
async function initializeBrowserOCR(): Promise<OcrInstance> {
  if (browserOcrInstance) return browserOcrInstance
  if (browserInitPromise) return browserInitPromise

  browserInitPromise = (async () => {
    // Load the runtime binary from the stable URL the service worker
    // precaches beside the models (scripts/copy-ort-wasm.mjs), rather than
    // the hashed copy webpack emits, which nothing can fetch ahead of time.
    // `onnxruntime-web` is aliased to its WASM-only build (next.config.mjs),
    // so this is the same module instance ocr-browser imports.
    const ort = await import("onnxruntime-web")
    ort.env.wasm.wasmPaths = { wasm: ORT_WASM_URL }
    const { default: Ocr } = await import("@gutenye/ocr-browser")

    const instance = (await Ocr.create({
      models: {
        detectionPath: "/models/ch_PP-OCRv4_det_infer.onnx",
        recognitionPath: "/models/ch_PP-OCRv4_rec_infer.onnx",
        dictionaryPath: "/models/ppocr_keys_v1.txt",
      },
    })) as unknown as OcrInstance

    browserOcrInstance = instance
    return instance
  })()
  // A failed load (the chunk or a model missing offline) must not be the
  // answer for the rest of the session: the next attempt tries again.
  browserInitPromise.catch(() => {
    browserInitPromise = null
  })

  return browserInitPromise!
}

/**
 * Fetch the offline OCR engine's CODE while the network is up, so the service
 * worker has it cached. OCR goes to the server whenever the device is online,
 * so the browser engine's chunk was only ever requested OFFLINE — the one
 * moment it could not be fetched — and offline OCR failed on first use.
 */
export function warmBrowserOCR(): void {
  if (typeof window === "undefined" || !isOnline()) return
  void import("@gutenye/ocr-browser").catch(() => {})
  void import("onnxruntime-web").catch(() => {})
}

let lastWarmAt = 0

/**
 * Get the engine that WILL read the photo ready while the pilot is still
 * taking it — called when the camera menu opens, which is several seconds
 * before a photo arrives.
 *
 * Online, that is the server: the health check boots the function and loads
 * its models, so a cold start (~3-5s) is spent behind the camera instead of
 * in front of a progress bar. If the server says it has no engine, it is
 * marked down and the browser engine is started instead. Offline, the browser
 * engine is created now rather than after the photo.
 */
export function warmOCR(): void {
  if (typeof window === "undefined") return
  if (!serverUsable()) {
    void initializeBrowserOCR().catch(() => {})
    return
  }
  if (Date.now() - lastWarmAt < 60_000) return
  lastWarmAt = Date.now()
  void fetch("/api/ocr", { method: "GET", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { available?: boolean } | null) => {
      if (d?.available) return
      markServerDown()
      void initializeBrowserOCR().catch(() => {})
    })
    .catch(() => {})
}

/**
 * Check if we're online and can reach the server
 */
function isOnline(): boolean {
  if (typeof navigator === "undefined") return false
  return navigator.onLine
}

/**
 * Convert File to base64 data URL
 */
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

/**
 * Process image with server-side OCR (primary)
 */
async function processWithServerOCR(
  file: File
): Promise<import("./oooi-extractor").OcrResult[]> {
  const formData = new FormData()
  formData.append("image", file)

  // The timeout covers the BODY too: a connection dropping mid-response would
  // otherwise leave `response.json()` pending and the fallback never start.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS)
  let data: { success?: boolean; results?: import("./oooi-extractor").OcrResult[] }
  try {
    const response = await fetch("/api/ocr", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    })

    if (!response.ok) {
      // A 401 is this session, not the engine — the next photo may succeed.
      if (response.status !== 401) markServerDown()
      const error = await response.json().catch(() => ({ error: "Unknown error" }))
      throw new Error(error.error || `Server OCR failed: ${response.status}`)
    }

    data = await response.json()
  } catch (error) {
    if (controller.signal.aborted) markServerDown()
    throw error
  } finally {
    clearTimeout(timer)
  }

  if (!data.success || !data.results) {
    throw new Error("Invalid server OCR response")
  }

  return data.results
}

/**
 * Process image with browser-based OCR (fallback)
 */
async function processWithBrowserOCR(
  file: File
): Promise<import("./oooi-extractor").OcrResult[]> {
  const ocr = await initializeBrowserOCR()
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

/**
 * Extract text from image using hybrid OCR
 *
 * Tries server-side OCR first (faster, more reliable),
 * falls back to browser-based OCR when offline or on error.
 */
export async function extractTextFromImage(
  file: File
): Promise<import("./oooi-extractor").OcrResult[]> {
  // Try server-side OCR first if online
  if (serverUsable()) {
    try {
      console.log("[OCR] Attempting server-side OCR...")
      const results = await processWithServerOCR(file)
      console.log("[OCR] Server-side OCR successful")
      return results
    } catch (error) {
      console.warn("[OCR] Server-side OCR failed, falling back to browser:", error)
      // Fall through to browser OCR
    }
  } else {
    console.log("[OCR] Offline or server unavailable - using browser-based OCR")
  }

  // Fallback to browser-based OCR
  console.log("[OCR] Using browser-based OCR...")
  const results = await processWithBrowserOCR(file)
  console.log("[OCR] Browser-based OCR successful")
  return results
}

/**
 * Extract text as concatenated string
 */
export async function extractTextAsString(file: File): Promise<string> {
  const results = await extractTextFromImage(file)
  return results.map((r) => r.text).join("\n")
}

/**
 * Initialize OCR for preloading
 * This primarily preloads the browser OCR for offline use
 */
export async function initializeOCR(): Promise<OcrInstance> {
  return initializeBrowserOCR()
}

/**
 * Preload OCR for faster first use
 */
export async function preloadOCR(): Promise<void> {
  try {
    await initializeBrowserOCR()
  } catch (e) {
    console.warn("OCR preload failed:", e)
  }
}

/**
 * Check if browser OCR is ready
 */
export function isOCRReady(): boolean {
  return browserOcrInstance !== null
}

/**
 * Reset OCR instances
 */
export function resetOCR(): void {
  browserOcrInstance = null
  browserInitPromise = null
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
    registration.active?.postMessage({ type: "CHECK_OCR_MODELS_CACHED" })

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
    registration.active?.postMessage({ type: "CACHE_OCR_MODELS" })

    // Timeout after 60 seconds (models are large)
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", messageHandler)
      resolve({ success: false, details: [] })
    }, 60000)
  })
}

/**
 * Check server OCR availability
 */
export async function checkServerOCRAvailability(): Promise<boolean> {
  if (!isOnline()) return false

  try {
    const response = await fetch("/api/ocr", {
      method: "GET",
    })

    if (!response.ok) return false

    const data = await response.json()
    return data.available === true
  } catch {
    return false
  }
}
