/**
 * Put the in-browser OCR engine's runtime at STABLE URLs —
 * `/models/ort-wasm-simd-threaded.{wasm,mjs}`, beside the models — so the
 * service worker can precache it at install, the same as the models.
 *
 * Left to webpack it is emitted under a content hash nobody knows until the
 * build has run, so nothing could fetch it ahead of time: the first OCR made
 * OFFLINE asked the network for the ~12MB runtime and failed. Copied from the
 * installed onnxruntime-web on every build and dev start, so it can never be
 * a different version from the JavaScript that loads it. Not committed.
 */
import { createRequire } from "node:module"
import { copyFileSync, mkdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const fromApp = createRequire(path.join(root, "package.json"))
// The `./wasm` entry's CommonJS file sits in dist/ with the binary.
const dist = path.dirname(fromApp.resolve("onnxruntime-web/wasm"))
const out = path.join(root, "public", "models")
mkdirSync(out, { recursive: true })
// The binary, and the JavaScript that instantiates it — which is also the
// script each engine thread is started from.
for (const name of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
  const dest = path.join(out, name)
  copyFileSync(path.join(dist, name), dest)
  console.log(`[ocr] copied ${name} (${(statSync(dest).size / 1e6).toFixed(2)}MB) -> public/models/`)
}
