import { describe, expect, it } from "vitest"
import { GRID_COLUMNS, WIDE_GRID_COLUMNS, ROW_FLOOR_PX, arrangeTiles, clampPos, clampSize, faceSize, faceSizeOn, gridKindFor, moveTile, nudgeTile, packTiles, placeTile, placeTileOnScreen, positionsFromSizes, resizeFrom, rowHeightFor, rowsOf, rowsUsed, sizeLabel, type TilePos, type TileSize } from "../bento"
import { findFreePlace } from "../bento"
import {
  DEFAULT_TALL_TILE_POSITIONS,
  DEFAULT_TILE_POSITIONS,
  DEFAULT_WIDE_TILE_POSITIONS,
  normaliseTileOrder,
  normaliseTilePositions,
  positionsFromStoredSizes,
  sizesFromV4,
} from "@/hooks/use-dashboard-layout"

type Id = "flight" | "airport" | "currency" | "limits"
const DEFAULT_ORDER: Id[] = ["flight", "airport", "currency", "limits"]
/** The sizes a phone's layout was stored as before places (v5), which `packTiles` still reads to carry it across. */
const DEFAULTS: Record<Id, TileSize> = {
  flight: { cols: 6, rows: 1 },
  airport: { cols: 3, rows: 2 },
  currency: { cols: 3, rows: 2 },
  limits: { cols: 6, rows: 1 },
}
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

describe("packTiles (the layout of sizes a stored layout is carried from)", () => {
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

  it("carries a v4 layout's content-high rows across, seven of those to four", () => {
    expect(sizesFromV4({ currency: { cols: 2, rows: 2 }, flight: { cols: 6, rows: 3 }, airport: { cols: 3, rows: 4 } })).toEqual({
      currency: { cols: 2, rows: 1 },
      flight: { cols: 6, rows: 2 },
      airport: { cols: 3, rows: 2 },
    })
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
    expect(normaliseTileOrder(["flight", "weather", "destination", "limits", "currency"]).slice(0, 4)).toEqual(["flight", "airport", "limits", "currency"])
    expect(normaliseTileOrder(["destination"]).slice(0, 4)).toEqual(["airport", "flight", "currency", "limits"])
  })

  it("puts the flight & duty tile where the duty tile was", () => {
    expect(normaliseTileOrder(["limits", "duty", "flight", "airport", "currency"]).slice(0, 4)).toEqual(["limits", "flight", "airport", "currency"])
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

  it("reads a narrow grid's face as before, and a wide one's off its real width", () => {
    expect(faceSizeOn({ cols: 3, rows: 4 }, "narrow", 366)).toEqual(faceSize({ cols: 3, rows: 4 }))
    // Half of a 760px grid is about a phone's row; half of 1,150px half again more.
    expect(faceSizeOn({ cols: 6, rows: 2 }, "wide", 760).cols).toBeCloseTo(3, 0)
    expect(faceSizeOn({ cols: 6, rows: 2 }, "wide", 1150).cols).toBeGreaterThanOrEqual(4.25)
    expect(faceSizeOn({ cols: 6, rows: 2 }, "wide", 1150).rows).toBe(1)
  })

  it("keeps a wide place apart from a narrow one, clamped to twelve columns", () => {
    expect(normaliseTilePositions({ flight: { col: 0, row: 0, cols: 10, rows: 2 } }, "wide").flight).toEqual({ col: 0, row: 0, cols: 10, rows: 2 })
    expect(normaliseTilePositions({ flight: { col: 0, row: 0, cols: 10, rows: 2 } }, "narrow").flight).toEqual({ col: 0, row: 0, cols: 6, rows: 2 })
    expect(normaliseTilePositions({ flight: { col: 0, row: 0, cols: 20, rows: 2 } }, "wide").flight.cols).toBe(12)
  })
})

describe("fixed rows (the owner: a definitive grid per device)", () => {
  it("divides a phone into six rows, an iPad on its side six and upright eight", () => {
    expect(rowsOf("narrow")).toBe(6)
    expect(rowsOf("wide")).toBe(6)
    expect(rowsOf("tall")).toBe(8)
  })

  it("shares the box's height out among the rows, never below the floor", () => {
    expect(rowHeightFor("narrow", 740)).toBe(Math.floor((740 - 40) / 6))
    expect(rowHeightFor("narrow", 200)).toBe(ROW_FLOOR_PX)
  })

  it("reads a face's rows off its real height", () => {
    // A phone's row of ~150px is about one of the old faces' rows; two rows two.
    expect(faceSizeOn({ cols: 3, rows: 1 }, "narrow", 366, 150).rows).toBe(1)
    expect(faceSizeOn({ cols: 6, rows: 2 }, "narrow", 366, 150).rows).toBe(2)
  })
})

const P = (col: number, row: number, cols: number, rows: number): TilePos => ({ col, row, cols, rows })
const at = (placed: Array<{ id: Id } & TilePos>) => Object.fromEntries(placed.map((p) => [p.id, `${p.col},${p.row} ${p.cols}x${p.rows}`]))
/** No cell is held by two tiles. */
function expectApart(placed: TilePos[]) {
  const seen = new Set<string>()
  for (const p of placed)
    for (let r = p.row; r < p.row + p.rows; r++)
      for (let c = p.col; c < p.col + p.cols; c++) {
        expect(seen.has(`${r},${c}`)).toBe(false)
        seen.add(`${r},${c}`)
      }
}

describe("the home screen (the owner: a fixed grid, tiles placed freely in it)", () => {
  it("lays the phone's defaults on six columns by six rows", () => {
    const placed = arrangeTiles(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, GRID_COLUMNS, 6)
    expect(at(placed)).toEqual({ flight: "0,0 6x2", airport: "0,2 3x4", currency: "3,2 3x2", limits: "3,4 3x2" })
    expectApart(placed)
    for (const [grid, d] of [["wide", DEFAULT_WIDE_TILE_POSITIONS], ["tall", DEFAULT_TALL_TILE_POSITIONS]] as const) {
      const p = arrangeTiles(DEFAULT_ORDER, d, WIDE_GRID_COLUMNS, rowsOf(grid))
      expectApart(p)
      expect(rowsUsed(p, rowsOf(grid))).toBe(rowsOf(grid))
    }
  })

  it("leaves empty cells empty — nothing grows to fill them", () => {
    const sparse = { flight: P(0, 0, 4, 1), airport: P(0, 3, 2, 2), currency: P(4, 5, 2, 1), limits: P(3, 1, 3, 1) }
    expect(at(arrangeTiles(DEFAULT_ORDER, sparse, GRID_COLUMNS, 6))).toEqual({
      flight: "0,0 4x1",
      airport: "0,3 2x2",
      currency: "4,5 2x1",
      limits: "3,1 3x1",
    })
  })

  it("drops a tile on the cell asked for and pushes the one it lands on to the nearest free place", () => {
    const next = placeTile(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, "limits", P(0, 2, 3, 2), GRID_COLUMNS, 6)
    expect(next.limits).toEqual(P(0, 2, 3, 2))
    const placed = arrangeTiles(DEFAULT_ORDER, next, GRID_COLUMNS, 6)
    expectApart(placed)
    // Only the airport was in the way: the flights and the currency stay.
    expect(placed.find((p) => p.id === "flight")).toMatchObject(DEFAULT_TILE_POSITIONS.flight)
    expect(placed.find((p) => p.id === "currency")).toMatchObject(DEFAULT_TILE_POSITIONS.currency)
    expect(placed.find((p) => p.id === "airport")).not.toMatchObject({ col: 0, row: 2 })
  })

  it("refuses a drop that would push a tile off the screen, as a home screen does", () => {
    // The airport, three by four, has no room left on the screen once the limits take its top.
    expect(placeTileOnScreen(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, "limits", P(0, 2, 3, 2), GRID_COLUMNS, 6)).toBeNull()
    // Swapping two tiles of one size is room enough.
    const moved = placeTileOnScreen(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, "limits", P(3, 2, 3, 2), GRID_COLUMNS, 6)
    expect(moved?.limits).toEqual(P(3, 2, 3, 2))
    expect(moved?.currency).toEqual(P(3, 4, 3, 2))
  })

  it("keeps every other tile where it was when it is not in the way", () => {
    const next = placeTile(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, "limits", P(3, 4, 3, 1), GRID_COLUMNS, 6)
    expect(next.flight).toEqual(DEFAULT_TILE_POSITIONS.flight)
    expect(next.airport).toEqual(DEFAULT_TILE_POSITIONS.airport)
    expect(next.currency).toEqual(DEFAULT_TILE_POSITIONS.currency)
  })

  it("pushes past the screen's foot only when the screen has no room, and the grid then scrolls", () => {
    const full = { flight: P(0, 0, 6, 2), airport: P(0, 2, 6, 2), currency: P(0, 4, 6, 2), limits: P(0, 0, 6, 2) }
    const placed = arrangeTiles(DEFAULT_ORDER, full, GRID_COLUMNS, 6)
    expectApart(placed)
    // Flight first at 0,0 (two at one place: the earlier in order keeps it);
    // the screen is then full, so limits goes below it.
    expect(placed.find((p) => p.id === "limits")!.row).toBe(6)
    expect(rowsUsed(placed, 6)).toBe(8)
  })

  it("resizes from any edge, the far edge fixed when the near one moves", () => {
    const start = P(2, 2, 2, 2)
    expect(resizeFrom(start, "r", 1, 2, 6, 6)).toEqual(P(2, 2, 3, 2))
    expect(resizeFrom(start, "l", 2, 2, 6, 6)).toEqual(P(0, 2, 4, 2))
    expect(resizeFrom(start, "l", -1, 2, 6, 6)).toEqual(P(2, 2, 2, 2))
    expect(resizeFrom(start, "t", 1, 2, 6, 6)).toEqual(P(2, 1, 2, 3))
    expect(resizeFrom(start, "b", 9, 2, 6, 6)).toEqual(P(2, 2, 2, 4))
  })

  it("keeps a place on the grid", () => {
    expect(clampPos(P(5, 5, 3, 3), 1, 6, 6)).toEqual(P(3, 3, 3, 3))
    expect(clampPos(P(-2, -1, 1, 1), 4, 6, 6)).toEqual(P(0, 0, 4, 1))
  })

  it("pushes overlapping stored places apart on load", () => {
    const n = normaliseTilePositions({ flight: P(0, 0, 6, 2), airport: P(0, 0, 3, 2) })
    expectApart(arrangeTiles(DEFAULT_ORDER, n, GRID_COLUMNS, 6))
    expect(n.flight).toEqual(P(0, 0, 6, 2))
  })

  it("carries a layout of sizes across to places, its rows scaled to the grid's", () => {
    const placed = positionsFromSizes(DEFAULT_ORDER, DEFAULTS, GRID_COLUMNS, 4, 6)
    // Row edges 0, 1, 3, 4 of four become 0, 2, 5, 6 of six.
    expect(placed.flight).toEqual(P(0, 0, 6, 2))
    expect(placed.airport).toEqual(P(0, 2, 3, 3))
    expect(placed.limits).toEqual(P(0, 5, 6, 1))
    const stored = positionsFromStoredSizes({ flight: { cols: 6, rows: 1 }, airport: { cols: 3, rows: 2 }, currency: { cols: 3, rows: 2 }, limits: { cols: 6, rows: 1 } }, DEFAULT_ORDER, "narrow", 4)
    expectApart(arrangeTiles(DEFAULT_ORDER, stored, GRID_COLUMNS, 6))
    expect(rowsUsed(arrangeTiles(DEFAULT_ORDER, stored, GRID_COLUMNS, 6), 6)).toBe(6)
  })

  it("starts the flight & duty tile at its default over a layout from before the duty tile joined it", () => {
    const old = normaliseTilePositions({ duty: P(0, 0, 6, 2), flight: P(0, 3, 6, 1) })
    expect(old.flight).toEqual(DEFAULT_TILE_POSITIONS.flight)
  })
})

describe("findFreePlace — where an added tile goes", () => {
  const placed = [
    { col: 0, row: 0, cols: 6, rows: 2 },
    { col: 0, row: 2, cols: 3, rows: 4 },
    { col: 3, row: 2, cols: 3, rows: 2 },
  ]
  it("takes the first free place that holds it at its size", () => {
    expect(findFreePlace(placed, { cols: 3, rows: 2 }, 2, 6, 6)).toEqual({ col: 3, row: 4, cols: 3, rows: 2 })
  })
  it("shrinks to fit — fewer rows, then fewer columns — rather than refuse", () => {
    const full = [...placed, { col: 3, row: 4, cols: 3, rows: 1 }]
    expect(findFreePlace(full, { cols: 3, rows: 2 }, 2, 6, 6)).toEqual({ col: 3, row: 5, cols: 3, rows: 1 })
  })
  it("refuses when no cell is free", () => {
    const full = [...placed, { col: 3, row: 4, cols: 3, rows: 2 }]
    expect(findFreePlace(full, { cols: 3, rows: 2 }, 2, 6, 6)).toBeNull()
  })
})
