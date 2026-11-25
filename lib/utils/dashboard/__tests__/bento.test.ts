import { describe, expect, it } from "vitest"
import { GRID_COLUMNS, WIDE_GRID_COLUMNS, ROW_FLOOR_PX, clampSize, faceSize, faceSizeOn, gridKindFor, moveTile, nudgeTile, packTiles, rowHeightFor, rowsOf, sizeLabel, type TileSize } from "../bento"
import { DEFAULT_TALL_TILE_SIZES, DEFAULT_TILE_SIZES, DEFAULT_WIDE_TILE_SIZES, normaliseTileOrder, normaliseTileSizes, sizesFromV4 } from "@/hooks/use-dashboard-layout"

type Id = "flight" | "airport" | "currency" | "limits"
const DEFAULT_ORDER: Id[] = ["flight", "airport", "currency", "limits"]
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
  it("places the default layout: the flight & duty band, the airport station beside the currency over the limits", () => {
    expect(layout(DEFAULT_ORDER, DEFAULTS)).toEqual([
      "flight@0,0 6x1",
      "airport@1,0 3x2",
      "currency@1,3 3x2",
      "limits@3,0 6x1",
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
    const order: Id[] = ["limits", "currency", "airport", "flight"]
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
        expectFilled(["airport", "currency", "flight", "limits"], sizes)
      }
  })

  it("leaves at most one cell empty for any other choice of sizes (none of them a 1 × 1)", () => {
    const any: TileSize[] = []
    for (let cols = 1; cols <= 6; cols++) for (let rows = 1; rows <= 6; rows++) if (cols > 1 || rows > 1) any.push({ cols, rows })
    for (const w of any)
      for (const c of any) {
        const sizes = { ...DEFAULTS, airport: w, currency: c }
        expectFilled(DEFAULT_ORDER, sizes, 1)
        expectFilled(["airport", "currency", "flight", "limits"], sizes, 1)
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

  it("carries a layout from the content-high rows across, seven of those to four of these", () => {
    const v5 = normaliseTileSizes(sizesFromV4({ currency: { cols: 2, rows: 2 }, flight: { cols: 6, rows: 3 }, airport: { cols: 3, rows: 4 } }))
    expect(v5.currency).toEqual({ cols: 2, rows: 1 })
    expect(v5.flight).toEqual({ cols: 6, rows: 2 })
    expect(v5.airport).toEqual({ cols: 3, rows: 2 })
    expect(v5.limits).toEqual(DEFAULTS.limits)
  })

  it("starts the flight & duty tile at its default over a layout from before the duty tile joined it", () => {
    const old = normaliseTileSizes({ duty: { cols: 6, rows: 2 }, flight: { cols: 6, rows: 1 }, currency: { cols: 2, rows: 2 } })
    expect(old.flight).toEqual(DEFAULTS.flight)
    expect(old.currency).toEqual({ cols: 2, rows: 2 })
  })
})

describe("moveTile / nudgeTile", () => {
  it("moves a tile to where another is", () => {
    expect(moveTile(DEFAULT_ORDER, "limits", "flight")).toEqual(["limits", "flight", "airport", "currency"])
  })

  it("nudges by one, clamped to the ends", () => {
    expect(nudgeTile(DEFAULT_ORDER, "flight", -1)).toEqual(DEFAULT_ORDER)
    expect(nudgeTile(DEFAULT_ORDER, "flight", 1).slice(0, 2)).toEqual(["airport", "flight"])
  })
})

describe("normaliseTileOrder", () => {
  it("puts the airport tile where the weather or destination tile was", () => {
    expect(normaliseTileOrder(["flight", "weather", "destination", "limits", "currency"])).toEqual(["flight", "airport", "limits", "currency"])
    expect(normaliseTileOrder(["destination"])).toEqual(["airport", "flight", "currency", "limits"])
  })

  it("puts the flight & duty tile where the duty tile was", () => {
    expect(normaliseTileOrder(["limits", "duty", "flight", "airport", "currency"])).toEqual(["limits", "flight", "airport", "currency"])
  })
})

describe("the wide grid (a desktop's full width)", () => {
  it("is twelve columns from 760px", () => {
    expect(gridKindFor(759)).toBe("narrow")
    expect(gridKindFor(760)).toBe("wide")
    // An iPad upright is the TALL grid: more rows.
    expect(gridKindFor(820, 1050)).toBe("tall")
    expect(gridKindFor(1180, 700)).toBe("wide")
  })

  it("packs its defaults edge to edge on twelve columns, held either way", () => {
    const placed = packTiles(DEFAULT_ORDER, DEFAULT_WIDE_TILE_SIZES, WIDE_GRID_COLUMNS, rowsOf("wide"))
    expect(placed.map((p) => `${p.id}@${p.row},${p.col} ${p.cols}x${p.rows}`)).toEqual([
      "flight@0,0 12x2",
      "airport@2,0 6x2",
      "currency@2,6 6x1",
      "limits@3,6 6x1",
    ])
    const tall = packTiles(DEFAULT_ORDER, DEFAULT_TALL_TILE_SIZES, WIDE_GRID_COLUMNS, rowsOf("tall"))
    expect(Math.max(...tall.map((p) => p.row + p.rows))).toBe(rowsOf("tall"))
  })

  it("reads a narrow grid's face as before, and a wide one's off its real width", () => {
    expect(faceSizeOn({ cols: 3, rows: 4 }, "narrow", 366)).toEqual(faceSize({ cols: 3, rows: 4 }))
    // Half of a 760px grid is about a phone's row; half of 1,150px half again more.
    expect(faceSizeOn({ cols: 6, rows: 2 }, "wide", 760).cols).toBeCloseTo(3, 0)
    expect(faceSizeOn({ cols: 6, rows: 2 }, "wide", 1150).cols).toBeGreaterThanOrEqual(4.25)
    expect(faceSizeOn({ cols: 6, rows: 2 }, "wide", 1150).rows).toBe(1)
  })

  it("keeps a wide size apart from a narrow one, clamped to twelve columns", () => {
    expect(normaliseTileSizes({ flight: { cols: 10, rows: 2 } }, "wide").flight).toEqual({ cols: 10, rows: 2 })
    expect(normaliseTileSizes({ flight: { cols: 10, rows: 2 } }, "narrow").flight).toEqual({ cols: 6, rows: 2 })
    expect(normaliseTileSizes({ flight: { cols: 20, rows: 2 } }, "wide").flight.cols).toBe(12)
  })
})

describe("fixed rows (the owner: a definitive grid per device)", () => {
  it("divides a phone into four rows, an iPad on its side four and upright six", () => {
    expect(rowsOf("narrow")).toBe(4)
    expect(rowsOf("wide")).toBe(4)
    expect(rowsOf("tall")).toBe(6)
  })

  it("shares the box's height out among the rows, never below the floor", () => {
    expect(rowHeightFor("narrow", 640)).toBe(Math.floor((640 - 24) / 4))
    expect(rowHeightFor("narrow", 200)).toBe(ROW_FLOOR_PX)
  })

  it("gives a tile the rows the pilot chose: 6 × 1 and 6 × 2 differ", () => {
    const one = packTiles(DEFAULT_ORDER, { ...DEFAULTS, flight: { cols: 6, rows: 1 } }, GRID_COLUMNS, 4)
    const two = packTiles(DEFAULT_ORDER, { ...DEFAULTS, flight: { cols: 6, rows: 2 } }, GRID_COLUMNS, 4)
    expect(one.find((p) => p.id === "flight")!.rows).toBe(1)
    expect(two.find((p) => p.id === "flight")!.rows).toBe(2)
  })

  it("grows the bottom tiles into a last empty row, but never a 1 × 1", () => {
    const short = { ...DEFAULTS, currency: { cols: 3, rows: 1 }, limits: { cols: 3, rows: 1 } }
    const placed = packTiles(DEFAULT_ORDER, short, GRID_COLUMNS, 4)
    expect(Math.max(...placed.map((p) => p.row + p.rows))).toBe(4)
    expect(placed.find((p) => p.id === "flight")!.rows).toBe(1)
    const square = packTiles(DEFAULT_ORDER, { ...short, limits: { cols: 1, rows: 1 } }, GRID_COLUMNS, 4)
    expect(square.find((p) => p.id === "limits")).toMatchObject({ cols: 1, rows: 1 })
  })

  it("leaves a gap of more than a row as the pilot made it", () => {
    const small = { flight: { cols: 6, rows: 1 }, airport: { cols: 3, rows: 1 }, currency: { cols: 3, rows: 1 }, limits: { cols: 6, rows: 0 } } as Record<Id, TileSize>
    const placed = packTiles(["flight", "airport", "currency"], small, GRID_COLUMNS, 4)
    expect(Math.max(...placed.map((p) => p.row + p.rows))).toBe(2)
  })

  it("clamps a tile to the screen's rows", () => {
    const placed = packTiles(DEFAULT_ORDER, { ...DEFAULTS, airport: { cols: 3, rows: 6 } }, GRID_COLUMNS, 4)
    expect(placed.find((p) => p.id === "airport")!.rows).toBe(4)
  })

  it("reads a face's rows off its real height", () => {
    // A phone's row of ~150px is about one of the old faces' rows; two rows two.
    expect(faceSizeOn({ cols: 3, rows: 1 }, "narrow", 366, 150).rows).toBe(1)
    expect(faceSizeOn({ cols: 6, rows: 2 }, "narrow", 366, 150).rows).toBe(2)
  })
})
