/**
 * The OCR pipeline on the SERVER: onnxruntime-node, sharp for the decode.
 * Server-only — imported by `app/api/ocr/route.ts`.
 */

import { readFile } from "node:fs/promises"
import { availableParallelism } from "node:os"
import { primeModels, readText, type OcrModels, type ReadOptions, type RgbaImage } from "./core"
import { OCR_MAX_SIDE } from "../limits"

let modelsPromise: Promise<OcrModels> | null = null

/** Load both sessions once per warm function. A failed load is retried next call. */
export function loadServerModels(): Promise<OcrModels> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const ort = await import("onnxruntime-node")
      const { default: paths } = await import("@gutenye/ocr-models/node")
      // Every core the function has: ORT's default is the same in principle,
      // but stating it keeps a container's CPU quota from being guessed wrong.
      const options = {
        intraOpNumThreads: Math.max(1, availableParallelism()),
        interOpNumThreads: 1,
        graphOptimizationLevel: "all" as const,
      }
      const [det, rec, keys] = await Promise.all([
        ort.InferenceSession.create(paths.detectionPath, options),
        ort.InferenceSession.create(paths.recognitionPath, options),
        readFile(paths.dictionaryPath, "utf8"),
      ])
      return { Tensor: ort.Tensor, det, rec, dictionary: [...keys.split("\n"), " "] }
    })()
    modelsPromise.catch(() => {
      modelsPromise = null
    })
  }
  return modelsPromise
}

let primed: Promise<void> | null = null

/** Load AND run the models once — what the health check (the warm-up) does. */
export function primeServerModels(): Promise<void> {
  if (!primed) {
    primed = loadServerModels().then(primeModels)
    primed.catch(() => {
      primed = null
    })
  }
  return primed
}

/**
 * Decode, apply the EXIF orientation and cap the size in one sharp pass, to
 * raw RGBA. The cap is applied here as well as on the client: an older client
 * build uploads at 2048, and detection runs at whatever it is handed.
 */
export async function decodeForOcr(bytes: Buffer): Promise<RgbaImage> {
  const { default: sharp } = await import("sharp")
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: OCR_MAX_SIDE, height: OCR_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}

export async function readImageOnServer(bytes: Buffer, options?: ReadOptions) {
  const [models, image] = await Promise.all([loadServerModels(), decodeForOcr(bytes)])
  return readText(image, models, options)
}
