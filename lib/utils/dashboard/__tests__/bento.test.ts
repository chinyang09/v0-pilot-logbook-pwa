import { describe, expect, it } from "vitest"
import { GRID_COLUMNS, clampSize, faceSize, moveTile, nudgeTile, packTiles, sizeLabel, type TileSize } from "../bento"
import { DEFAULT_TILE_SIZES, normaliseTileOrder, normaliseTileSizes, sizesFromV3 } from "@/hooks/use-dashboard-layout"

type Id = "duty" | "flight" | "airport" | "currency" | "limits"
const DEFAULT_ORDER: Id[] = ["duty", "flight", "airport", "currency", "limits"]
const DEFAULTS: Record<Id, TileSize> = DEFAULT_TILE_SIZES
const layout = (order: Id[], sizes: Record<Id, TileSize>) =>
  packTiles(order, sizes).map((p) => `${p.id}@${p.row},${p.col} ${p.cols}x${p.rows}`)

/** Every cell of every row up to the last is owned by exactly one tile (but for `allowedHoles`). */
function expectFilled(order: Id[], sizes: Record<Id, TileSize>, allowedHoles = 0) {
  const placed = packTiles(order, sizes)
  const last = Math.max(...placed.map((p) => p.row + p.rows - 1))
  const owner = new Map<string, Id>()
  for (const p of placed)
    for (let r = p.row; r < p.row + p.rows; r++)
      for (let c = p.col; c < p.col + p.cols; c++) {
        expect(owner.has(`${r},${c}`)).toBe(false)
        owner.set(`${r},${c}`, p.id)
      }
  let holes = 0
  for (let r = 0; r <= last; r++) for (let c = 0; c < GRID_COLUMNS; c++) if (!owner.has(`${r},${c}`)) holes++
  expect(holes).toBeLessThanOrEqual(allowedHoles)
}

describe("packTiles on the 6 × 6 grid", () => {
  it("places the default layout: two full bands, the airport station beside the currency over the limits", () => {
    expect(layout(DEFAULT_ORDER, DEFAULTS)).toEqual([
      "duty@0,0 6x2",
      "flight@2,0 6x2",
      "airport@4,0 3x4",
      "currency@4,3 3x2",
      "limits@6,3 3x2",
    ])
    expectFilled(DEFAULT_ORDER, DEFAULTS)
  })

  it("gives a tile alone on its rows the whole width", () => {
    const sizes = { ...DEFAULTS, currency: { cols: 4, rows: 2 } }
    const placed = packTiles(DEFAULT_ORDER, sizes)
    expect(placed.find((p) => p.id === "limits")).toMatchObject({ col: 0, cols: 6 })
    expectFilled(DEFAULT_ORDER, sizes)
  })

  it("keeps the pilot's order reading left to right, top to bottom", () => {
    const order: Id[] = ["limits", "currency", "duty", "airport", "flight"]
    const placed = packTiles(order, DEFAULTS)
    expect(placed.map((p) => p.id)).toEqual(order)
    for (let i = 1; i < placed.length; i++) {
      const [a, b] = [placed[i - 1], placed[i]]
      expect(b.row > a.row || (b.row === a.row && b.col > a.col)).toBe(true)
    }
  })

  it("fills every hole whole-step sizes leave (the 3 × 2 grid's, doubled)", () => {
    const even: TileSize[] = []
    for (const cols of [2, 4, 6]) for (const rows of [2, 4, 6]) even.push({ cols, rows })
    for (const w of even)
      for (const c of even) {
        const sizes = { ...DEFAULTS, airport: w, currency: c, limits: { cols: 2, rows: 2 } }
        expectFilled(DEFAULT_ORDER, sizes)
        expectFilled(["airport", "duty", "currency", "flight", "limits"], sizes)
      }
  })

  it("leaves at most one cell empty for any other choice of sizes", () => {
    const any: TileSize[] = []
    for (let cols = 1; cols <= 6; cols++) for (let rows = 1; rows <= 6; rows++) any.push({ cols, rows })
    for (const w of any)
      for (const c of any) {
        const sizes = { ...DEFAULTS, airport: w, currency: c }
        expectFilled(DEFAULT_ORDER, sizes, 1)
        expectFilled(["airport", "duty", "currency", "flight", "limits"], sizes, 1)
      }
  })

  it("clamps a size to the grid", () => {
    expect(clampSize({ cols: 9, rows: 9 })).toEqual({ cols: 6, rows: 6 })
    expect(clampSize({ cols: 1, rows: 0 }, 4)).toEqual({ cols: 4, rows: 1 })
    expect(sizeLabel({ cols: 2, rows: 1 })).toBe("2 × 1")
  })

  it("reads a size as a face does, in thirds of the row", () => {
    expect(faceSize({ cols: 6, rows: 2 })).toEqual({ cols: 3, rows: 1 })
    expect(faceSize({ cols: 3, rows: 4 })).toEqual({ cols: 1.5, rows: 2 })
  })

  it("carries a layout from the 3 × 2 grid across, doubled", () => {
    const v4 = normaliseTileSizes(sizesFromV3({ currency: { cols: 2, rows: 2 }, duty: { cols: 3, rows: 1 } }))
    expect(v4.currency).toEqual({ cols: 4, rows: 4 })
    expect(v4.duty).toEqual({ cols: 6, rows: 2 })
    expect(v4.limits).toEqual(DEFAULTS.limits)
  })
})

describe("moveTile / nudgeTile", () => {
  it("moves a tile to where another is", () => {
    expect(moveTile(DEFAULT_ORDER, "limits", "duty")).toEqual(["limits", "duty", "flight", "airport", "currency"])
  })

  it("nudges by one, clamped to the ends", () => {
    expect(nudgeTile(DEFAULT_ORDER, "duty", -1)).toEqual(DEFAULT_ORDER)
    expect(nudgeTile(DEFAULT_ORDER, "duty", 1).slice(0, 2)).toEqual(["flight", "duty"])
  })
})

describe("normaliseTileOrder", () => {
  it("puts the airport tile where the weather or destination tile was", () => {
    expect(normaliseTileOrder(["duty", "weather", "flight", "destination", "limits", "currency"])).toEqual(["duty", "airport", "flight", "limits", "currency"])
    expect(normaliseTileOrder(["destination", "duty"])).toEqual(["airport", "duty", "flight", "currency", "limits"])
  })
})
