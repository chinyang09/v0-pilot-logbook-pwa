/**
 * The OCR pipeline in the BROWSER: onnxruntime-web (aliased to its WASM-only
 * build in next.config.mjs), models from `/models/` — which the service worker
 * precaches — and the photo decoded by the browser's own image decoder.
 */

import { primeModels, readText, type OcrModels, type ReadOptions, type RgbaImage } from "./core"
import { OCR_MAX_SIDE } from "../limits"

/** At the stable URLs the service worker precaches (see public/sw.js). */
export const BROWSER_MODEL_URLS = {
  det: "/models/ch_PP-OCRv4_det_infer.onnx",
  rec: "/models/ch_PP-OCRv4_rec_infer.onnx",
  keys: "/models/ppocr_keys_v1.txt",
  wasm: "/models/ort-wasm-simd-threaded.wasm",
  /** The glue that loads it — and the script every engine thread starts from. */
  mjs: "/models/ort-wasm-simd-threaded.mjs",
} as const

/**
 * WebAssembly threads need SharedArrayBuffer, which a browser only hands to a
 * cross-origin ISOLATED page (the COOP/COEP headers in next.config.mjs). A page
 * served from an older cache without them simply runs single-threaded.
 */
export function ocrThreadCount(): number {
  if (typeof self === "undefined" || !self.crossOriginIsolated) return 1
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2
  return Math.max(1, Math.min(4, cores - 1))
}

let modelsPromise: Promise<OcrModels> | null = null

export function loadBrowserModels(): Promise<OcrModels> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const ort = await import("onnxruntime-web")
      ort.env.wasm.wasmPaths = { wasm: BROWSER_MODEL_URLS.wasm, mjs: BROWSER_MODEL_URLS.mjs }
      ort.env.wasm.numThreads = ocrThreadCount()
      const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" as const }
      const [det, rec, keys] = await Promise.all([
        ort.InferenceSession.create(BROWSER_MODEL_URLS.det, options),
        ort.InferenceSession.create(BROWSER_MODEL_URLS.rec, options),
        fetch(BROWSER_MODEL_URLS.keys).then((r) => {
          if (!r.ok) throw new Error(`OCR dictionary: ${r.status}`)
          return r.text()
        }),
      ])
      return { Tensor: ort.Tensor, det, rec, dictionary: [...keys.split("\n"), " "] }
    })()
    // A failed load (a model missing offline) is not the answer for the session.
    modelsPromise.catch(() => {
      modelsPromise = null
    })
  }
  return modelsPromise
}

let primed: Promise<void> | null = null

/** Load AND run the models once, so the first photo is not their first run. */
export function primeBrowserModels(): Promise<void> {
  if (!primed) {
    primed = loadBrowserModels().then(primeModels)
    primed.catch(() => {
      primed = null
    })
  }
  return primed
}

/**
 * The photo as RGBA at `OCR_MAX_SIDE`, straight from the browser's decoder —
 * no JPEG round trip. `createImageBitmap` applies the EXIF orientation
 * (`from-image` is the default), so a portrait photo is read upright.
 */
export async function decodeForOcr(file: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, OCR_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height })
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error("No 2D canvas for OCR")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)
    return { data, width, height }
  } finally {
    bitmap.close()
  }
}

export async function readImageInBrowser(file: Blob, options?: ReadOptions) {
  const [models, image] = await Promise.all([loadBrowserModels(), decodeForOcr(file)])
  return readText(image, models, options)
}
