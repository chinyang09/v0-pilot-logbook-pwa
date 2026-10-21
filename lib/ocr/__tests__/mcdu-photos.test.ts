/**
 * The Airbus MCDU "AOC VOYAGE RPT", from REAL photos taken in the cockpit —
 * seven of them, across screen tints, angles, glare and distance, two with
 * blank ("----") slots.
 *
 * Each fixture pins what the engine actually returned for that photo at
 * `OCR_MAX_SIDE`: `pipeline` is the app's own engine on the server (sharp's
 * resize of the committed jpg), `device` is the SAME engine in Chromium from
 * the ORIGINAL 12MP photo (the browser's own resize — which is what read photo
 * 3's blank IN dashes as "1000"), and `node` / `browser` are what the
 * @gutenye library it replaced returned on each runtime, which joined boxes
 * into rows and read the keypad too. Those are kept as harder inputs: the
 * extractor has to get every slot right from all three.
 *
 * Unlike the synthetic-box tests, these catch a change in what the engine
 * READS, not just in how the geometry is mapped. The photos themselves are
 * here too (`fixtures/mcdu/*.jpg`, already at `OCR_MAX_SIDE`); run
 * `OCR_ENGINE=1 pnpm test` to put them through the real server engine — do
 * that before changing engine, model or image size.
 */

import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { extractFlightData, type OcrResult } from "../oooi-extractor"

const DIR = path.join(__dirname, "fixtures", "mcdu")

type Slots = {
  outTime?: string
  offTime?: string
  onTime?: string
  inTime?: string
  blockTime?: string
  flightTime?: string
}

/** Read off the screens by eye. `undefined` is a "----" slot. */
const EXPECTED: Record<number, Slots> = {
  1: { outTime: "00:28", offTime: "00:45", onTime: "03:58", inTime: "04:02", blockTime: "03:33", flightTime: "03:13" },
  // OUT not yet stamped. Its blank used to let the right-hand TAXI label
  // share a line with the left-hand door time, which cost IN.
  2: { outTime: undefined, offTime: "09:42", onTime: "12:32", inTime: "12:37", blockTime: "03:05", flightTime: "02:50" },
  // OUT, IN and BLOCK all blank. FLIGHT sat alone on its row and was lost.
  3: { outTime: undefined, offTime: "10:01", onTime: "12:49", inTime: undefined, blockTime: undefined, flightTime: "02:48" },
  4: { outTime: "03:40", offTime: "03:54", onTime: "06:26", inTime: "06:30", blockTime: "02:50", flightTime: "02:32" },
  5: { outTime: "12:49", offTime: "12:59", onTime: "16:16", inTime: "16:20", blockTime: "03:31", flightTime: "03:17" },
  6: { outTime: "05:24", offTime: "05:47", onTime: "07:11", inTime: "07:18", blockTime: "01:53", flightTime: "01:24" },
  7: { outTime: "08:32", offTime: "08:59", onTime: "10:37", inTime: "10:43", blockTime: "02:10", flightTime: "01:38" },
}

const SLOTS = ["outTime", "offTime", "onTime", "inTime", "blockTime", "flightTime"] as const

function slotsOf(data: ReturnType<typeof extractFlightData>): Slots {
  return Object.fromEntries(SLOTS.map((k) => [k, data[k]])) as Slots
}

function fixture(n: number): Record<"pipeline" | "device" | "node" | "browser", OcrResult[]> {
  return JSON.parse(fs.readFileSync(path.join(DIR, `mcdu-${n}.ocr.json`), "utf8"))
}

describe("MCDU voyage report — real photos", () => {
  for (const [n, expected] of Object.entries(EXPECTED)) {
    for (const engine of ["pipeline", "device", "node", "browser"] as const) {
      it(`photo ${n}, ${engine} engine: every slot, and nothing invented for a blank`, () => {
        expect(slotsOf(extractFlightData(fixture(Number(n))[engine]))).toEqual(expected)
      })
    }
  }

  it("a fully stamped report reads as a consistent sequence", () => {
    const data = extractFlightData(fixture(4).node)
    expect(data.confidence).toBeGreaterThanOrEqual(0.9)
  })
})

// The real engine over the real photos. Opt-in: it loads ~15MB of models and
// takes a few seconds, and onnxruntime-node is a native module.
// `OCR_FIXTURE_WRITE=1` as well re-pins each fixture's `pipeline` read.
describe.runIf(process.env.OCR_ENGINE === "1")("MCDU photos through the server engine", () => {
  it("reads every slot of every photo, and never the keypad", async () => {
    const { readImageOnServer } = await import("../engine/node")
    for (const [n, expected] of Object.entries(EXPECTED)) {
      const { lines, stats } = await readImageOnServer(fs.readFileSync(path.join(DIR, `mcdu-${n}.jpg`)))
      expect({ photo: n, ...slotsOf(extractFlightData(lines)) }).toEqual({ photo: n, ...expected })
      // Detection finds the keys; recognition stops at the screen's last line.
      expect(stats.recognised).toBeLessThan(stats.boxes)
      if (process.env.OCR_FIXTURE_WRITE === "1") {
        const file = path.join(DIR, `mcdu-${n}.ocr.json`)
        const round = (l: OcrResult) => ({ ...l, confidence: Math.round(l.confidence * 1e4) / 1e4 })
        const current = JSON.parse(fs.readFileSync(file, "utf8"))
        fs.writeFileSync(file, JSON.stringify({ ...current, pipeline: lines.map(round) }))
      }
    }
  }, 120_000)
})
