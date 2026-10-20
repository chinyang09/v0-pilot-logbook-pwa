/**
 * OCR Service — server when online, the browser when not.
 *
 * Both run the SAME pipeline (`./engine/core`) over the same PP-OCRv4 models;
 * only the runtime differs (onnxruntime-node vs onnxruntime-web). The server
 * is preferred because it has more cores and no model download, but the
 * browser engine is a complete offline answer, not a degraded one.
 */

// Re-export type from extractor (single source of truth)
export type { OcrResult } from "./oooi-extractor"
import type { OcrResult } from "./oooi-extractor"

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

/** Load the browser engine's two models (cached by the service worker). */
let browserReady = false

async function initializeBrowserOCR(): Promise<void> {
  const { primeBrowserModels } = await import("./engine/browser")
  await primeBrowserModels()
  browserReady = true
}

/**
 * Fetch the offline OCR engine's CODE while the network is up, so the service
 * worker has it cached. OCR goes to the server whenever the device is online,
 * so the browser engine's chunk was only ever requested OFFLINE — the one
 * moment it could not be fetched — and offline OCR failed on first use.
 */
export function warmBrowserOCR(): void {
  if (typeof window === "undefined" || !isOnline()) return
  void import("./engine/browser").catch(() => {})
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
 * Process image with server-side OCR (primary)
 */
async function processWithServerOCR(file: File): Promise<OcrResult[]> {
  // Downscale before the upload (OCR_MAX_SIDE): a phone photo is 12MP and
  // several MB, and the server would only shrink it again. A few hundred KB.
  const { compressImage } = await import("@/lib/utils/image-compress")
  const formData = new FormData()
  formData.append("image", await compressImage(file))

  // The timeout covers the BODY too: a connection dropping mid-response would
  // otherwise leave `response.json()` pending and the fallback never start.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS)
  let data: { success?: boolean; results?: OcrResult[] }
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
async function processWithBrowserOCR(file: File): Promise<OcrResult[]> {
  const { readImageInBrowser } = await import("./engine/browser")
  const { lines } = await readImageInBrowser(file)
  return lines
}

/**
 * Extract text from image using hybrid OCR
 *
 * Tries server-side OCR first (faster, more reliable),
 * falls back to browser-based OCR when offline or on error.
 */
export async function extractTextFromImage(
  file: File
): Promise<OcrResult[]> {
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
export async function initializeOCR(): Promise<void> {
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
  return browserReady
}

/**
 * Reset OCR instances
 */
export function resetOCR(): void {
  browserReady = false
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
