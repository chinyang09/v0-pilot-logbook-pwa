/**
 * The app's own OCR pipeline (lib/ocr/engine/core.ts), with the two models
 * replaced by stand-ins — so what is pinned here is the PLUMBING: the boxes
 * found in a probability map, the CTC decode, and that reading stops at the
 * screen's last line so the MCDU keypad is never put through recognition.
 * What the real models read off real photos is mcdu-photos.test.ts.
 */

import { describe, it, expect } from "vitest"
import {
  boxesFromProbabilityMap,
  ctcDecode,
  readText,
  type OcrModels,
  type OrtTensor,
} from "../engine/core"

class FakeTensor implements OrtTensor {
  constructor(
    readonly type: "float32",
    readonly data: Float32Array,
    readonly dims: readonly number[]
  ) {}
}

describe("boxesFromProbabilityMap", () => {
  it("finds each region and grows it by the unclip distance", () => {
    const w = 64
    const h = 32
    const prob = new Float32Array(w * h)
    // A 20×6 region at (4,4) and a 10×6 one at (40,20).
    for (let y = 4; y < 10; y++) for (let x = 4; x < 24; x++) prob[y * w + x] = 0.9
    for (let y = 20; y < 26; y++) for (let x = 40; x < 50; x++) prob[y * w + x] = 0.9
    const boxes = boxesFromProbabilityMap(prob, w, h, w, h)
    expect(boxes).toHaveLength(2)
    const grow = (20 * 6 * 1.5) / (2 * 26)
    expect(boxes[0]).toEqual({ x0: 4 - grow, y0: 4 - grow, x1: 24 + grow, y1: 10 + grow })
  })

  it("ignores specks and the padding outside the image", () => {
    const w = 32
    const prob = new Float32Array(w * w)
    prob[5 * w + 5] = 0.9 // a 1px speck
    for (let y = 0; y < 8; y++) for (let x = 24; x < 32; x++) prob[y * w + x] = 0.9 // in the padding
    expect(boxesFromProbabilityMap(prob, w, w, 20, 20)).toEqual([])
  })
})

describe("ctcDecode", () => {
  it("drops blanks and collapses repeats, keeping a repeat split by a blank", () => {
    const dict = ["0", "9", "4", "2"]
    // 0 0 _ 9 4 4 _ 4 2  →  "09442"
    const seq = [1, 1, 0, 2, 3, 3, 0, 3, 4]
    const classes = dict.length + 1
    const logits = new Float32Array(seq.length * classes)
    seq.forEach((c, t) => (logits[t * classes + c] = 0.8))
    const read = ctcDecode(logits, seq.length, classes, dict)
    expect(read.text).toBe("09442")
    expect(read.confidence).toBeCloseTo(0.8)
  })
})

describe("readText", () => {
  // One text line per row, painted in its own grey so the stand-in
  // recogniser can tell which line it was handed.
  const ROWS = ["OUT", "0942", "<AOC MENU", "A", "B"]
  const SIZE = 256
  const rowY = (i: number) => 10 + i * 45
  const shade = (i: number) => 40 * (i + 1)

  const image = (() => {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4)
    ROWS.forEach((_, i) => {
      for (let y = rowY(i); y < rowY(i) + 12; y++)
        for (let x = 20; x < 120; x++) data.set([shade(i), shade(i), shade(i), 255], (y * SIZE + x) * 4)
    })
    return { data, width: SIZE, height: SIZE }
  })()

  function models() {
    const dictionary = [...new Set(ROWS.join(""))]
    const read: string[] = []
    const det = {
      inputNames: ["x"],
      outputNames: ["y"],
      async run(feeds: Record<string, OrtTensor>) {
        const [, , h, w] = feeds.x.dims
        const prob = new Float32Array(h * w)
        ROWS.forEach((_, i) => {
          for (let y = rowY(i) + 2; y < rowY(i) + 10; y++) for (let x = 24; x < 116; x++) prob[y * w + x] = 0.9
        })
        return { y: new FakeTensor("float32", prob, [1, 1, h, w]) }
      },
    }
    const rec = {
      inputNames: ["x"],
      outputNames: ["y"],
      async run(feeds: Record<string, OrtTensor>) {
        const [n, , h, w] = feeds.x.dims
        const data = feeds.x.data as Float32Array
        const texts = Array.from({ length: n }, (_, k) => {
          // The brightest pixel on the line's middle row says which row it is.
          let max = 0
          for (let x = 0; x < w; x++) max = Math.max(max, data[k * 3 * h * w + (h >> 1) * w + x])
          const row = Math.round((max * 255) / 40) - 1
          return ROWS[row]
        })
        read.push(...texts)
        const steps = Math.max(...texts.map((t) => t.length))
        const classes = dictionary.length + 1
        const logits = new Float32Array(n * steps * classes)
        texts.forEach((t, k) => {
          for (let s = 0; s < steps; s++) {
            const c = s < t.length ? dictionary.indexOf(t[s]) + 1 : 0
            logits[(k * steps + s) * classes + c] = 0.95
          }
        })
        return { y: new FakeTensor("float32", logits, [n, steps, classes]) }
      },
    }
    return { models: { Tensor: FakeTensor, det, rec, dictionary } as unknown as OcrModels, read }
  }

  it("never puts the keypad below the screen's last line through recognition", async () => {
    const { models: m, read } = models()
    const { lines, stats } = await readText(image, m, { batch: 1 })
    expect(lines.map((l) => l.text)).toEqual(["OUT", "0942", "<AOC MENU"])
    expect(read).toEqual(["OUT", "0942", "<AOC MENU"])
    expect(stats).toMatchObject({ boxes: 5, recognised: 3 })
  })

  it("drops what a batch read past the stop line", async () => {
    const { models: m } = models()
    const { lines } = await readText(image, m, { batch: 4 })
    expect(lines.map((l) => l.text)).toEqual(["OUT", "0942", "<AOC MENU"])
  })

  it("reads everything when there is no stop line", async () => {
    const { models: m } = models()
    const { lines } = await readText(image, m, { stopAt: null })
    expect(lines.map((l) => l.text)).toEqual(ROWS)
  })
})
