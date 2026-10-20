/**
 * The page's handle on the device OCR engine, which runs in a worker
 * (`ocr.worker.ts`). Where a worker cannot be started, or dies, the same
 * engine runs on the page instead — slower, but the photo is still read.
 */

import type { OcrLine } from "./core"

type Reply = { id: number; ok: true; lines?: OcrLine[] } | { id: number; ok: false; error: string }

let worker: Worker | null = null
let workerBroken = false
let nextId = 0
const waiting = new Map<number, { resolve: (lines: OcrLine[]) => void; reject: (error: Error) => void }>()

function failAll(error: Error) {
  for (const { reject } of waiting.values()) reject(error)
  waiting.clear()
}

function getWorker(): Worker | null {
  if (worker || workerBroken) return worker
  if (typeof Worker === "undefined") {
    workerBroken = true
    return null
  }
  try {
    worker = new Worker(new URL("./ocr.worker.ts", import.meta.url), { type: "module" })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    const entry = waiting.get(data.id)
    if (!entry) return
    waiting.delete(data.id)
    if (data.ok) entry.resolve(data.lines ?? [])
    else entry.reject(new Error(data.error))
  }
  // A worker that fails to start (its script would not load) or crashes is
  // not tried again this session: the page runs the engine instead.
  worker.onerror = (event) => {
    event.preventDefault()
    worker?.terminate()
    worker = null
    workerBroken = true
    failAll(new Error(event.message || "OCR worker failed"))
  }
  return worker
}

function ask(message: { type: "prime" } | { type: "read"; file: Blob }): Promise<OcrLine[]> | null {
  const w = getWorker()
  if (!w) return null
  const id = ++nextId
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ id, ...message })
  })
}

/** Load the models and run them once, so the photo is not their first run. */
export async function primeDeviceEngine(): Promise<void> {
  const viaWorker = ask({ type: "prime" })
  if (viaWorker) {
    try {
      await viaWorker
      return
    } catch (error) {
      if (!workerBroken) throw error
    }
  }
  const { primeBrowserModels } = await import("./browser")
  await primeBrowserModels()
}

export async function readOnDevice(file: Blob): Promise<OcrLine[]> {
  const viaWorker = ask({ type: "read", file })
  if (viaWorker) {
    try {
      return await viaWorker
    } catch (error) {
      // An error FROM the engine is the answer; only a dead worker falls back.
      if (!workerBroken) throw error
    }
  }
  const { readImageInBrowser } = await import("./browser")
  return (await readImageInBrowser(file)).lines
}

/**
 * Fetch the engine's code (the worker and ONNX Runtime's JavaScript) while
 * online, so the service worker holds it for the first photo taken offline.
 * The worker is started and left idle; it loads no models until asked.
 */
export function warmDeviceEngineCode(): void {
  getWorker()
}
