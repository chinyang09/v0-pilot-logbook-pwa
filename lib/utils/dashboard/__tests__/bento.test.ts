import { describe, expect, it } from "vitest"
import { GRID_COLUMNS, clampSize, moveTile, nudgeTile, packTiles, sizeLabel, type TileSize } from "../bento"

type Id = "duty" | "flight" | "weather" | "destination" | "currency" | "limits"
const DEFAULT_ORDER: Id[] = ["duty", "flight", "weather", "destination", "currency", "limits"]
const DEFAULTS: Record<Id, TileSize> = {
  duty: { cols: 3, rows: 1 },
  flight: { cols: 3, rows: 1 },
  weather: { cols: 1, rows: 2 },
  destination: { cols: 2, rows: 1 },
  currency: { cols: 1, rows: 1 },
  limits: { cols: 1, rows: 1 },
}
const layout = (order: Id[], sizes: Record<Id, TileSize>) =>
  packTiles(order, sizes).map((p) => `${p.id}@${p.row},${p.col} ${p.cols}x${p.rows}`)

/** Every cell of every row up to the last is owned by exactly one tile. */
function expectFilled(order: Id[], sizes: Record<Id, TileSize>) {
  const placed = packTiles(order, sizes)
  const last = Math.max(...placed.map((p) => p.row + p.rows - 1))
  const owner = new Map<string, Id>()
  for (const p of placed)
    for (let r = p.row; r < p.row + p.rows; r++)
      for (let c = p.col; c < p.col + p.cols; c++) {
        expect(owner.has(`${r},${c}`)).toBe(false)
        owner.set(`${r},${c}`, p.id)
      }
  for (let r = 0; r <= last; r++) for (let c = 0; c < GRID_COLUMNS; c++) expect(owner.has(`${r},${c}`)).toBe(true)
}

describe("packTiles", () => {
  it("places the default layout: two full rows, a tall weather tile beside the rest", () => {
    expect(layout(DEFAULT_ORDER, DEFAULTS)).toEqual([
      "duty@0,0 3x1",
      "flight@1,0 3x1",
      "weather@2,0 1x2",
      "destination@2,1 2x1",
      "currency@3,1 1x1",
      "limits@3,2 1x1",
    ])
    expectFilled(DEFAULT_ORDER, DEFAULTS)
  })

  it("gives a tile alone on its row the whole row", () => {
    const sizes = { ...DEFAULTS, limits: { cols: 1, rows: 1 }, currency: { cols: 2, rows: 1 } }
    const placed = packTiles(DEFAULT_ORDER, sizes)
    expect(placed.find((p) => p.id === "limits")).toMatchObject({ row: 4, col: 0, cols: 3 })
    expectFilled(DEFAULT_ORDER, sizes)
  })

  it("keeps the pilot's order reading left to right, top to bottom", () => {
    const order: Id[] = ["limits", "currency", "duty", "weather", "flight", "destination"]
    const placed = packTiles(order, DEFAULTS)
    expect(placed.map((p) => p.id)).toEqual(order)
    for (let i = 1; i < placed.length; i++) {
      const [a, b] = [placed[i - 1], placed[i]]
      expect(b.row > a.row || (b.row === a.row && b.col > a.col)).toBe(true)
    }
  })

  it("fills the holes any choice of sizes leaves", () => {
    const all: TileSize[] = []
    for (let cols = 1; cols <= 3; cols++) for (let rows = 1; rows <= 2; rows++) all.push({ cols, rows })
    // A sample across the sizes, every order of the last four tiles.
    for (const w of all)
      for (const c of all) {
        const sizes = { ...DEFAULTS, weather: w, currency: c }
        expectFilled(DEFAULT_ORDER, sizes)
        expectFilled(["weather", "duty", "currency", "flight", "limits", "destination"], sizes)
      }
  })

  it("clamps a size to the grid", () => {
    expect(clampSize({ cols: 9, rows: 4 })).toEqual({ cols: 3, rows: 2 })
    expect(clampSize({ cols: 1, rows: 1 }, 2)).toEqual({ cols: 2, rows: 1 })
    expect(sizeLabel({ cols: 2, rows: 1 })).toBe("2 × 1")
  })
})

describe("moveTile / nudgeTile", () => {
  it("moves a tile to where another is", () => {
    expect(moveTile(DEFAULT_ORDER, "limits", "duty")).toEqual(["limits", "duty", "flight", "weather", "destination", "currency"])
  })

  it("nudges by one, clamped to the ends", () => {
    expect(nudgeTile(DEFAULT_ORDER, "duty", -1)).toEqual(DEFAULT_ORDER)
    expect(nudgeTile(DEFAULT_ORDER, "duty", 1).slice(0, 2)).toEqual(["flight", "duty"])
  })
})
