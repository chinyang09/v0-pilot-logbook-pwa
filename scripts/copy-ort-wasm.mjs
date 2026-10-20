/**
 * Put the in-browser OCR engine's WebAssembly binary at a STABLE URL —
 * `/models/ort-wasm-simd-threaded.wasm`, beside the models — so the service
 * worker can precache it at install, the same as the models.
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
// onnxruntime-web is ocr-browser's dependency, not the app's, so resolve it
// from there. Its `./wasm` entry's CommonJS file sits in dist/ with the binary.
const fromOcr = createRequire(fromApp.resolve("@gutenye/ocr-browser"))
const dist = path.dirname(fromOcr.resolve("onnxruntime-web/wasm"))
const src = path.join(dist, "ort-wasm-simd-threaded.wasm")
const dest = path.join(root, "public", "models", "ort-wasm-simd-threaded.wasm")

mkdirSync(path.dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log(`[ocr] copied ${path.basename(src)} (${(statSync(dest).size / 1e6).toFixed(1)}MB) -> public/models/`)
