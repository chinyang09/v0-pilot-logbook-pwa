import { describe, expect, it } from "vitest"
import {
  GRID_COLUMNS,
  WIDE_GRID_COLUMNS,
  ROW_FLOOR_PX,
  arrangeTiles,
  clampPos,
  clampSize,
  faceSize,
  faceSizeOn,
  findFreePlace,
  gridKindFor,
  moveTile,
  nudgeTile,
  placeTile,
  placeTileOnScreen,
  pushTilesDown,
  resizeFrom,
  rowHeightFor,
  rowsOf,
  rowsUsed,
  type TilePos,
} from "../bento"
import {
  DEFAULT_ENABLED,
  DEFAULT_TALL_TILE_POSITIONS,
  DEFAULT_TILE_POSITIONS,
  DEFAULT_WIDE_TILE_POSITIONS,
  defaultPositions,
  normaliseTileOrder,
  normaliseTilePositions,
} from "@/hooks/use-dashboard-layout"

type Id = "flight" | "duty" | "airport" | "currency" | "limits"
const DEFAULT_ORDER: Id[] = ["flight", "duty", "airport", "currency", "limits"]
const ROWS = rowsOf("narrow")

const P = (col: number, row: number, cols: number, rows: number): TilePos => ({ col, row, cols, rows })
const at = (placed: Array<{ id: string } & TilePos>) => Object.fromEntries(placed.map((p) => [p.id, `${p.col},${p.row} ${p.cols}x${p.rows}`]))
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

describe("sizes and the grid", () => {
  it("clamps a size to the grid", () => {
    expect(clampSize({ cols: 9, rows: 9 })).toEqual({ cols: 6, rows: 5 })
  })

  it("reads a size as a face does, in thirds of the row", () => {
    expect(faceSize({ cols: 6, rows: 2 })).toEqual({ cols: 3, rows: 1 })
    expect(faceSize({ cols: 3, rows: 4 })).toEqual({ cols: 1.5, rows: 2 })
  })
})

describe("moveTile / nudgeTile", () => {
  it("moves a tile to where another is", () => {
    expect(moveTile(DEFAULT_ORDER, "limits", "flight")).toEqual(["limits", "flight", "duty", "airport", "currency"])
  })

  it("nudges by one, clamped to the ends", () => {
    expect(nudgeTile(DEFAULT_ORDER, "flight", -1)).toEqual(DEFAULT_ORDER)
    expect(nudgeTile(DEFAULT_ORDER, "flight", 1).slice(0, 2)).toEqual(["duty", "flight"])
  })
})

describe("normaliseTileOrder", () => {
  it("puts the airport tile where the weather or destination tile was", () => {
    expect(normaliseTileOrder(["flight", "weather", "destination", "limits", "currency"]).slice(0, 4)).toEqual(["flight", "airport", "limits", "currency"])
  })

  it("keeps the duty a tile of its own (round 50 split it from the flights again)", () => {
    expect(normaliseTileOrder(["limits", "duty", "flight"]).slice(0, 3)).toEqual(["limits", "duty", "flight"])
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

describe("fixed rows (the owner: a definitive grid per device; the timeline a row of its own)", () => {
  it("gives a phone's tiles five rows under the timeline, an iPad on its side five and upright seven", () => {
    expect(rowsOf("narrow")).toBe(5)
    expect(rowsOf("wide")).toBe(5)
    expect(rowsOf("tall")).toBe(7)
  })

  it("shares the whole deck's height out among the rows and the timeline's, never below the floor", () => {
    // Six rows on a phone — the timeline's and five of tiles — and five gaps.
    expect(rowHeightFor("narrow", 740)).toBe(Math.floor((740 - 40) / 6))
    expect(rowHeightFor("narrow", 200)).toBe(ROW_FLOOR_PX)
  })

  it("reads a face's rows off its real height", () => {
    // A phone's row of ~150px is about one of the old faces' rows; two rows two.
    expect(faceSizeOn({ cols: 3, rows: 1 }, "narrow", 366, 150).rows).toBe(1)
    expect(faceSizeOn({ cols: 6, rows: 2 }, "narrow", 366, 150).rows).toBe(2)
  })
})

describe("the home screen (the owner: a fixed grid, tiles placed freely in it)", () => {
  it("lays the defaults out apart and filling the screen, on every grid", () => {
    const placed = arrangeTiles(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, GRID_COLUMNS, ROWS)
    expect(at(placed)).toEqual({ flight: "0,0 6x2", duty: "0,2 3x1", currency: "3,2 3x1", airport: "0,3 3x2", limits: "3,3 3x2" })
    expectApart(placed)
    expect(rowsUsed(placed, ROWS)).toBe(ROWS)
    for (const [grid, d] of [["wide", DEFAULT_WIDE_TILE_POSITIONS], ["tall", DEFAULT_TALL_TILE_POSITIONS]] as const) {
      const p = arrangeTiles(DEFAULT_ORDER, d, WIDE_GRID_COLUMNS, rowsOf(grid))
      expectApart(p)
      expect(rowsUsed(p, rowsOf(grid))).toBe(rowsOf(grid))
    }
  })

  it("leaves empty cells empty — nothing grows to fill them", () => {
    const sparse = { flight: P(0, 0, 4, 1), duty: P(0, 4, 2, 1), airport: P(0, 2, 2, 2), currency: P(4, 3, 2, 1), limits: P(3, 1, 3, 1) }
    expect(at(arrangeTiles(DEFAULT_ORDER, sparse, GRID_COLUMNS, ROWS))).toEqual({
      flight: "0,0 4x1",
      duty: "0,4 2x1",
      airport: "0,2 2x2",
      currency: "4,3 2x1",
      limits: "3,1 3x1",
    })
  })

  it("bumps the tiles under an enlarged tile down a row each, not to the foot of the screen", () => {
    const ids = ["a", "b", "c", "d"] as const
    const start = { a: P(0, 0, 3, 1), b: P(0, 1, 3, 1), c: P(0, 2, 3, 1), d: P(3, 0, 3, 3) }
    const next = placeTile(ids, start, "a", P(0, 0, 3, 2), GRID_COLUMNS, ROWS)
    expect(next.a).toEqual(P(0, 0, 3, 2))
    expect(next.b).toEqual(P(0, 2, 3, 1))
    expect(next.c).toEqual(P(0, 3, 3, 1))
    // Beside it, untouched.
    expect(next.d).toEqual(P(3, 0, 3, 3))
    expect(pushTilesDown(ids, { ...start, a: P(0, 0, 6, 1) }, "a", GRID_COLUMNS, ROWS).d).toEqual(P(3, 1, 3, 3))
  })

  it("bumps the phone's duty and currency down a row when the flights grow", () => {
    const next = placeTileOnScreen(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, "duty", P(0, 2, 3, 2), GRID_COLUMNS, ROWS)
    // The airport under the duty would go off the foot: refused, as a home screen does.
    expect(next).toBeNull()
    const roomy = { ...DEFAULT_TILE_POSITIONS, airport: P(0, 3, 3, 1), limits: P(3, 3, 3, 1) }
    const grown = placeTileOnScreen(DEFAULT_ORDER, roomy, "duty", P(0, 2, 3, 2), GRID_COLUMNS, ROWS)!
    expect(grown.airport).toEqual(P(0, 4, 3, 1))
    expect(grown.currency).toEqual(DEFAULT_TILE_POSITIONS.currency)
  })

  it("falls back to the nearest place when bumping down would run off the screen", () => {
    const ids = ["a", "b"] as const
    const next = placeTile(ids, { a: P(0, 0, 3, 3), b: P(0, 3, 3, 2) }, "a", P(0, 0, 3, 4), GRID_COLUMNS, ROWS)
    expect(next.b).toEqual(P(3, 3, 3, 2))
  })

  it("swaps two tiles of one size", () => {
    const moved = placeTileOnScreen(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, "limits", P(0, 3, 3, 2), GRID_COLUMNS, ROWS)
    expect(moved?.limits).toEqual(P(0, 3, 3, 2))
    expectApart(DEFAULT_ORDER.map((id) => moved![id]))
  })

  it("keeps every other tile where it was when it is not in the way", () => {
    const next = placeTile(DEFAULT_ORDER, DEFAULT_TILE_POSITIONS, "limits", P(3, 3, 3, 1), GRID_COLUMNS, ROWS)
    for (const id of ["flight", "duty", "airport", "currency"] as const) expect(next[id]).toEqual(DEFAULT_TILE_POSITIONS[id])
  })

  it("pushes past the screen's foot only when the screen has no room, and the grid then scrolls", () => {
    const full = { flight: P(0, 0, 6, 2), duty: P(0, 2, 6, 1), airport: P(0, 3, 6, 2), currency: P(0, 0, 6, 1), limits: P(0, 0, 6, 1) }
    const placed = arrangeTiles(DEFAULT_ORDER, full, GRID_COLUMNS, ROWS)
    expectApart(placed)
    expect(rowsUsed(placed, ROWS)).toBe(7)
  })

  it("resizes from any edge, the far edge fixed when the near one moves", () => {
    const start = P(2, 2, 2, 2)
    expect(resizeFrom(start, "r", 1, 2, 6, 5)).toEqual(P(2, 2, 3, 2))
    expect(resizeFrom(start, "l", 2, 2, 6, 5)).toEqual(P(0, 2, 4, 2))
    expect(resizeFrom(start, "l", -1, 2, 6, 5)).toEqual(P(2, 2, 2, 2))
    expect(resizeFrom(start, "t", 1, 2, 6, 5)).toEqual(P(2, 1, 2, 3))
    expect(resizeFrom(start, "b", 9, 2, 6, 5)).toEqual(P(2, 2, 2, 3))
  })

  it("keeps a place on the grid", () => {
    expect(clampPos(P(5, 5, 3, 3), 1, 6, 5)).toEqual(P(3, 2, 3, 3))
    expect(clampPos(P(-2, -1, 1, 1), 4, 6, 5)).toEqual(P(0, 0, 4, 1))
  })

  it("pushes overlapping stored places apart on load", () => {
    const n = normaliseTilePositions({ flight: P(0, 0, 6, 2), airport: P(0, 0, 3, 2) })
    expectApart(DEFAULT_ENABLED.map((id) => n[id]))
    expect(n.flight).toEqual(P(0, 0, 6, 2))
  })

  it("places the tiles a pilot added after the defaults, in the first room they find", () => {
    const d = defaultPositions("narrow", [...DEFAULT_ENABLED, "sun"])
    // The defaults fill the screen: the added tile goes below it.
    expect(d.sun.row).toBeGreaterThanOrEqual(ROWS)
    expectApart([...DEFAULT_ENABLED, "sun"].map((id) => d[id as keyof typeof d]))
    const wide = defaultPositions("wide", ["flight", "duty", "sun"])
    expect(wide.sun.row).toBe(2)
  })
})

describe("findFreePlace — where an added tile goes", () => {
  const placed = [
    { col: 0, row: 0, cols: 6, rows: 2 },
    { col: 0, row: 2, cols: 3, rows: 3 },
    { col: 3, row: 2, cols: 3, rows: 1 },
  ]
  it("takes the first free place that holds it at its size", () => {
    expect(findFreePlace(placed, { cols: 3, rows: 2 }, 2, 6, 5)).toEqual({ col: 3, row: 3, cols: 3, rows: 2 })
  })
  it("shrinks to fit — fewer rows, then fewer columns — rather than refuse", () => {
    const full = [...placed, { col: 3, row: 3, cols: 3, rows: 1 }]
    expect(findFreePlace(full, { cols: 3, rows: 2 }, 2, 6, 5)).toEqual({ col: 3, row: 4, cols: 3, rows: 1 })
  })
  it("refuses when no cell is free", () => {
    const full = [...placed, { col: 3, row: 3, cols: 3, rows: 2 }]
    expect(findFreePlace(full, { cols: 3, rows: 2 }, 2, 6, 5)).toBeNull()
  })
})
