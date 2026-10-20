/**
 * The device OCR engine, in a worker of its own.
 *
 * On the page's main thread the engine shared every frame with the app: ONNX
 * Runtime's calling thread is one of its compute threads, and the decode, the
 * crops and the box search are plain JavaScript — all of it competing with
 * React and the UI's animations. Measured in the app at a 3× CPU throttle the
 * same read took ~3.0s where the bare engine took ~2.0s. Here nothing else
 * runs, and the page stays responsive while it works.
 *
 * Messages: `{ id, type: "prime" }` loads and primes the models;
 * `{ id, type: "read", file }` reads one photo. Each answers
 * `{ id, ok: true, lines }` or `{ id, ok: false, error }`.
 */

import { primeBrowserModels, readImageInBrowser } from "./browser"

// Fetch ONNX Runtime's JavaScript as soon as the worker starts — that is what
// `warmDeviceEngineCode` relies on to have it cached before an offline photo.
void import("onnxruntime-web").catch(() => {})

type Request = { id: number; type: "prime" } | { id: number; type: "read"; file: Blob }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === "prime") {
      await primeBrowserModels()
      scope.postMessage({ id: data.id, ok: true })
    } else {
      const { lines } = await readImageInBrowser(data.file)
      scope.postMessage({ id: data.id, ok: true, lines })
    }
  } catch (error) {
    scope.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
