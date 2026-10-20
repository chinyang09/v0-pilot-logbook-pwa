/**
 * The OCR pipeline, written once for BOTH runtimes: the server
 * (onnxruntime-node) and the phone (onnxruntime-web). Only the model sessions
 * and the image decode differ between them, and they are passed in.
 *
 * It runs the same two PP-OCRv4 models the @gutenye packages ship, and keeps
 * their numerics (BGR, value/255, the 0.03 detection threshold, CTC decode),
 * but not their plumbing, for three reasons — each measured on real MCDU
 * photos:
 *
 * 1. **The keypad is never READ.** Recognition is one model call per box, and
 *    on a photo of an MCDU about half the boxes are keys (A–Z, 0–9, DIR,
 *    PROG…). Boxes are read top to bottom and reading stops at the screen's
 *    last line (`RETURN TO` / `<AOC MENU` / `SEND*`), so everything below it
 *    is detected but never recognised. A photo with no such line — a cropped
 *    shot, or the EFB Time Summary — is read in full, exactly as before.
 * 2. **No OpenCV.** The library cut its text boxes out with opencv.js — a 10MB
 *    script the phone downloaded and parsed before the first photo could be
 *    read — for a job that, on level horizontal text, is connected components
 *    and a rectangle. Here it is a flood fill over a typed array.
 * 3. **Typed arrays throughout.** The library built every model input as three
 *    plain JS arrays of one number per pixel, spread into a fourth.
 */

export interface RgbaImage {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/** The slice of onnxruntime both runtimes share. */
export interface OrtTensor {
  readonly data: unknown
  readonly dims: readonly number[]
}
export type OrtTensorCtor = new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtTensor
export interface OrtSession {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}

export interface OcrModels {
  Tensor: OrtTensorCtor
  det: OrtSession
  rec: OrtSession
  /** ppocr_keys_v1.txt, one entry per line, with " " appended (index 0 is CTC blank). */
  dictionary: string[]
}

export interface OcrLine {
  text: string
  confidence: number
  /** [[x,y]×4], clockwise from top-left, in the INPUT image's pixels. */
  box: number[][]
}

export interface ReadStats {
  detMs: number
  recMs: number
  /** Boxes detection found. */
  boxes: number
  /** Boxes actually recognised (the rest were below the screen). */
  recognised: number
}

export interface ReadOptions {
  /**
   * Longest side detection runs at. Detection cost is per pixel and the boxes
   * are cut from the full-size input regardless, so this can sit below the
   * input size without costing recognition any detail.
   */
  detSide?: number
  /** Stop recognising below the first line matching this. `null` reads everything. */
  stopAt?: RegExp | null
  /** Boxes per recognition call. */
  batch?: number
}

/** The voyage report's last lines — below them is the keypad. */
export const MCDU_STOP = /AOC\s*MENU|RETURN\s*TO|SEND\s*\*|PRINT\s*\*/i

export const DEFAULT_DET_SIDE = 800
export const DEFAULT_BATCH = 4
const DET_BASE = 32
const DET_THRESHOLD = 0.03
const REC_HEIGHT = 48
const UNCLIP_RATIO = 1.5
const MIN_SIDE = 3
/** The library drops a read whose mean character confidence is below this. */
const MIN_CONFIDENCE = 0.5

// ─── Images ─────────────────────────────────────────────────────────────────

/** Bilinear resize. Shrinking by more than 2× box-averages first, so thin strokes survive. */
export function resizeRgba(src: RgbaImage, width: number, height: number): RgbaImage {
  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  if (width === src.width && height === src.height) return src
  let from = src
  // A big reduction in one bilinear step samples 4 of N² pixels and aliases.
  while (from.width >= width * 2 && from.height >= height * 2) from = halve(from)
  const out = new Uint8ClampedArray(width * height * 4)
  const sx = from.width / width
  const sy = from.height / height
  const d = from.data
  const fw = from.width
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5)
    const y0 = Math.min(from.height - 1, Math.floor(fy))
    const y1 = Math.min(from.height - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5)
      const x0 = Math.min(fw - 1, Math.floor(fx))
      const x1 = Math.min(fw - 1, x0 + 1)
      const wx = fx - x0
      const a = (y0 * fw + x0) * 4
      const b = (y0 * fw + x1) * 4
      const c = (y1 * fw + x0) * 4
      const e = (y1 * fw + x1) * 4
      const o = (y * width + x) * 4
      for (let k = 0; k < 4; k++) {
        const top = d[a + k] + (d[b + k] - d[a + k]) * wx
        const bot = d[c + k] + (d[e + k] - d[c + k]) * wx
        out[o + k] = top + (bot - top) * wy
      }
    }
  }
  return { data: out, width, height }
}

function halve(src: RgbaImage): RgbaImage {
  const w = Math.floor(src.width / 2)
  const h = Math.floor(src.height / 2)
  const out = new Uint8ClampedArray(w * h * 4)
  const d = src.data
  const sw = src.width
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = ((2 * y) * sw + 2 * x) * 4
      const b = a + 4
      const c = a + sw * 4
      const e = c + 4
      const o = (y * w + x) * 4
      for (let k = 0; k < 4; k++) out[o + k] = (d[a + k] + d[b + k] + d[c + k] + d[e + k]) >> 2
    }
  }
  return { data: out, width: w, height: h }
}

export function cropRgba(src: RgbaImage, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  const w = x1 - x0
  const h = y1 - y0
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * src.width + x0) * 4
    out.set(src.data.subarray(from, from + w * 4), y * w * 4)
  }
  return { data: out, width: w, height: h }
}

/** NCHW float input in the models' channel order (B, G, R), each value / 255. */
function toTensorData(img: RgbaImage, padW = img.width, padH = img.height): Float32Array {
  const plane = padW * padH
  const out = new Float32Array(plane * 3)
  const d = img.data
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const o = y * padW + x
      out[o] = d[i + 2] / 255
      out[plane + o] = d[i + 1] / 255
      out[2 * plane + o] = d[i] / 255
    }
  }
  return out
}

// ─── Detection ──────────────────────────────────────────────────────────────

export interface TextBox {
  /** Axis-aligned, in input-image pixels. */
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Connected regions of the probability map, each grown by the DB "unclip"
 * distance (area × 1.5 / perimeter) — the same expansion the library applied
 * to its rotated rectangles. Pure, so the geometry is testable on its own.
 */
export function boxesFromProbabilityMap(
  prob: Float32Array,
  mapW: number,
  mapH: number,
  /** The part of the map that is image rather than padding. */
  validW: number,
  validH: number,
  threshold = DET_THRESHOLD
): TextBox[] {
  const seen = new Uint8Array(mapW * mapH)
  const stack = new Int32Array(mapW * mapH)
  const boxes: TextBox[] = []
  for (let y = 0; y < validH; y++) {
    for (let x = 0; x < validW; x++) {
      const start = y * mapW + x
      if (seen[start] || prob[start] <= threshold) continue
      let minX = x, maxX = x, minY = y, maxY = y
      let top = 0
      stack[top++] = start
      seen[start] = 1
      while (top > 0) {
        const p = stack[--top]
        const px = p % mapW
        const py = (p - px) / mapW
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        // 8-connected, as findContours treats a binary map.
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy
          if (ny < 0 || ny >= validH) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx
            if (nx < 0 || nx >= validW) continue
            const q = ny * mapW + nx
            if (!seen[q] && prob[q] > threshold) {
              seen[q] = 1
              stack[top++] = q
            }
          }
        }
      }
      const w = maxX - minX + 1
      const h = maxY - minY + 1
      if (Math.min(w, h) < MIN_SIDE) continue
      const grow = (w * h * UNCLIP_RATIO) / (2 * (w + h))
      boxes.push({ x0: minX - grow, y0: minY - grow, x1: maxX + 1 + grow, y1: maxY + 1 + grow })
    }
  }
  return boxes
}

async function detect(image: RgbaImage, models: OcrModels, detSide: number): Promise<TextBox[]> {
  const scale = Math.min(1, detSide / Math.max(image.width, image.height))
  const dw = Math.max(1, Math.round(image.width * scale))
  const dh = Math.max(1, Math.round(image.height * scale))
  // The model wants multiples of 32: pad, don't stretch, so the boxes map
  // back by one exact scale factor.
  const mw = Math.max(DET_BASE, Math.ceil(dw / DET_BASE) * DET_BASE)
  const mh = Math.max(DET_BASE, Math.ceil(dh / DET_BASE) * DET_BASE)
  const small = resizeRgba(image, dw, dh)
  const input = new models.Tensor("float32", toTensorData(small, mw, mh), [1, 3, mh, mw])
  const out = await models.det.run({ [models.det.inputNames[0]]: input })
  const prob = out[models.det.outputNames[0]].data as Float32Array
  const rx = image.width / dw
  const ry = image.height / dh
  return boxesFromProbabilityMap(prob, mw, mh, dw, dh).flatMap((b) => {
    const x0 = Math.max(0, Math.round(b.x0 * rx))
    const y0 = Math.max(0, Math.round(b.y0 * ry))
    const x1 = Math.min(image.width, Math.round(b.x1 * rx))
    const y1 = Math.min(image.height, Math.round(b.y1 * ry))
    return x1 - x0 > MIN_SIDE && y1 - y0 > MIN_SIDE ? [{ x0, y0, x1, y1 }] : []
  })
}

// ─── Recognition ────────────────────────────────────────────────────────────

/** CTC greedy decode: argmax per step, drop blanks (0) and repeats. */
export function ctcDecode(
  logits: Float32Array,
  steps: number,
  classes: number,
  dictionary: string[]
): { text: string; confidence: number } {
  let text = ""
  let sum = 0
  let n = 0
  let prev = -1
  for (let t = 0; t < steps; t++) {
    let best = 0
    let bestP = -Infinity
    const base = t * classes
    for (let c = 0; c < classes; c++) {
      const p = logits[base + c]
      if (p > bestP) {
        bestP = p
        best = c
      }
    }
    if (best !== 0 && best !== prev) {
      text += dictionary[best - 1] ?? ""
      sum += bestP
      n++
    }
    prev = best
  }
  return { text, confidence: n ? sum / n : 0 }
}

/**
 * Recognise several boxes in ONE model call. Each line is scaled to 48px high
 * and padded on the right to the widest in the batch — with black, which is
 * what an MCDU screen is anyway. One call per box spent most of its time on
 * per-call overhead rather than on the boxes.
 */
async function recogniseBatch(image: RgbaImage, boxes: TextBox[], models: OcrModels) {
  const lines = boxes.map((box) => {
    const crop = cropRgba(image, box.x0, box.y0, box.x1, box.y1)
    const w = Math.max(1, Math.round((crop.width * REC_HEIGHT) / crop.height))
    return resizeRgba(crop, w, REC_HEIGHT)
  })
  const width = Math.max(...lines.map((l) => l.width))
  const per = 3 * REC_HEIGHT * width
  const data = new Float32Array(per * lines.length)
  lines.forEach((line, i) => data.set(toTensorData(line, width, REC_HEIGHT), i * per))
  const input = new models.Tensor("float32", data, [lines.length, 3, REC_HEIGHT, width])
  const out = (await models.rec.run({ [models.rec.inputNames[0]]: input }))[models.rec.outputNames[0]]
  const [n, steps, classes] = out.dims
  const all = out.data as Float32Array
  return Array.from({ length: n }, (_, i) =>
    ctcDecode(all.subarray(i * steps * classes, (i + 1) * steps * classes), steps, classes, models.dictionary)
  )
}

// ─── The read ───────────────────────────────────────────────────────────────

/**
 * One throwaway call through each model. A session's FIRST run pays for
 * allocating its buffers and (in the browser) compiling and starting its
 * threads, which on a phone is seconds; done while the camera is open, the
 * photo does not pay it.
 */
export async function primeModels(models: OcrModels): Promise<void> {
  const blank = (w: number, h: number) => new models.Tensor("float32", new Float32Array(3 * w * h), [1, 3, h, w])
  await models.det.run({ [models.det.inputNames[0]]: blank(128, 128) })
  await models.rec.run({ [models.rec.inputNames[0]]: blank(160, REC_HEIGHT) })
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

/**
 * Read every text line in `image`, top to bottom, stopping below the line
 * that matches `stopAt`. Lines come back one per detected box — NOT joined
 * into rows (the library joined them, which threw away where each word sat);
 * the extractors group rows themselves.
 */
export async function readText(
  image: RgbaImage,
  models: OcrModels,
  { detSide = DEFAULT_DET_SIDE, stopAt = MCDU_STOP, batch = DEFAULT_BATCH }: ReadOptions = {}
): Promise<{ lines: OcrLine[]; stats: ReadStats }> {
  const t0 = now()
  const boxes = await detect(image, models, detSide)
  const t1 = now()

  // Reading order. Within a row (centres closer than half a box height) left
  // to right, so a stop line's own row is finished before stopping.
  const order = boxes
    .map((b) => ({ b, cy: (b.y0 + b.y1) / 2, h: b.y1 - b.y0 }))
    .sort((a, b) => a.cy - b.cy || a.b.x0 - b.b.x0)

  const lines: OcrLine[] = []
  let stopBelow = Infinity
  let recognised = 0
  for (let i = 0; i < order.length && order[i].cy <= stopBelow; i += batch) {
    const chunk = order.slice(i, i + batch).filter((o) => o.cy <= stopBelow)
    const reads = await recogniseBatch(image, chunk.map((o) => o.b), models)
    recognised += chunk.length
    chunk.forEach(({ b, cy, h }, k) => {
      const text = reads[k].text.trim()
      const confidence = reads[k].confidence
      if (text && confidence >= MIN_CONFIDENCE) {
        lines.push({ text, confidence, box: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]] })
      }
      if (stopAt && stopBelow === Infinity && stopAt.test(text)) stopBelow = cy + h / 2
    })
  }
  // A batch can run past the stop line; nothing below it is the screen.
  const kept = lines.filter((l) => (l.box[0][1] + l.box[2][1]) / 2 <= stopBelow)

  return {
    lines: kept,
    stats: { detMs: Math.round(t1 - t0), recMs: Math.round(now() - t1), boxes: boxes.length, recognised },
  }
}
