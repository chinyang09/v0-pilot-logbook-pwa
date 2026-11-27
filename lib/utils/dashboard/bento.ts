/**
 * The flight dashboard's BENTO — a phone's HOME SCREEN (the owner, Nov 2026:
 * "6 column by 6 row on the Google Pixel 10 … behave like a mobile phone
 * where you can add widget and then change their size … it doesn't have to
 * fit to the bottom and there can be spaces between widgets … a fixed number
 * of grids and it's free and easy to be placed within the grids").
 *
 * The screen is a FIXED grid of cells (`columnsOf` × `rowsOf`: a phone six by
 * six), and every tile has a PLACE in it the pilot chose — its top-left cell
 * and its size (`TilePos`). Nothing is packed and nothing is grown to fill:
 * an empty cell stays empty. A tile dropped or resized over others BUMPS
 * them down a row at a time (`pushTilesDown`), else each to the nearest place
 * it fits (`placeTile`); a place that leaves no room is refused.
 *
 * Pure, so the placement is tested without the page.
 */

export const GRID_COLUMNS = 6
export const MAX_ROWS_SPAN = 5

/**
 * A WIDE grid has twelve columns (the owner, Nov 2026: on a desktop the
 * Flight Deck takes the whole width, "else widgets will end up very huge
 * wasting good space"). Six columns across a 1,100px page made every tile
 * twice a phone's width with a phone's content in it; on twelve, a tile is
 * placed at about a phone's width per six columns, and a face given more
 * than that lays out more (`faceSizeOn`).
 */
export const WIDE_GRID_COLUMNS = 12
/** The grid's width from which it is the wide grid, px. */
export const WIDE_GRID_MIN_PX = 760

/**
 * Which grid a screen has: `narrow` (a phone, a narrow panel — six columns),
 * `wide` (twelve, held LANDSCAPE) or `tall` (twelve, held PORTRAIT — an iPad
 * upright). Each keeps its own sizes: a layout for one is not the other's.
 */
export type GridKind = "narrow" | "wide" | "tall"

export function columnsOf(grid: GridKind): number {
  return grid === "narrow" ? GRID_COLUMNS : WIDE_GRID_COLUMNS
}

/**
 * The ROWS a screen gives its tiles (the owner, Nov 2026: "need a more
 * definitive way … on phone max of 4 rows, but on ipad portrait vs landscape
 * is different"). A row is a FIXED share of the height the Flight Deck has
 * — never as tall as its content — so a tile one row tall and one two rows
 * tall are always visibly different, and the default layout fills one screen.
 * The TIMELINE over the tiles takes one more row of the same height (the
 * owner, round 50: "including the timeline it will be total of 6 rows").
 */
export const GRID_ROWS: Record<GridKind, number> = { narrow: 5, wide: 5, tall: 7 }

/** Rows the timeline takes over the tiles. */
export const TIMELINE_ROWS = 1

export function rowsOf(grid: GridKind): number {
  return GRID_ROWS[grid]
}

/** The box the Flight Deck's tiles have, `heightPx` its height where known: twelve columns from 760px, `tall` when it is taller than wide. */
export function gridKindFor(widthPx: number, heightPx = 0): GridKind {
  if (widthPx < WIDE_GRID_MIN_PX) return "narrow"
  return heightPx > widthPx ? "tall" : "wide"
}

/** The least a row is, px: on a screen too short for its rows (a phone on its side) the tiles scroll rather than squash. */
export const ROW_FLOOR_PX = 84

/**
 * A row's height in a box `heightPx` tall — the WHOLE Flight Deck, the
 * timeline's row included: the box shared out among the tiles' rows, the
 * timeline's and their gaps.
 */
export function rowHeightFor(grid: GridKind, heightPx: number): number {
  const rows = rowsOf(grid) + TIMELINE_ROWS
  if (!(heightPx > 0)) return ROW_FLOOR_PX
  return Math.max(ROW_FLOOR_PX, Math.floor((heightPx - GRID_GAP_PX * (rows - 1)) / rows))
}

export interface TileSize {
  /** Columns of the 6 it spans. */
  cols: number
  /** Rows it spans: 1 to 6. */
  rows: number
}

export interface PlacedTile<T extends string> {
  id: T
  /** 0-based column and row of its top-left cell. */
  col: number
  row: number
  cols: number
  rows: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

export function clampSize(size: Partial<TileSize> | undefined, minCols = 1, columns = GRID_COLUMNS, maxRows = MAX_ROWS_SPAN): TileSize {
  return {
    cols: clamp(size?.cols ?? columns, minCols, columns),
    rows: clamp(size?.rows ?? 1, 1, maxRows),
  }
}

/**
 * A size as a FACE reads it: in thirds of the row and in the rows of the
 * grid before (two of these rows each). Faces were written for a three-column
 * grid — "a third of the row looks 90 days ahead", "a tile two rows tall
 * stacks" — and the grid's finer steps fall between them (3 of 6 columns is
 * a face 1.5 wide).
 */
export function faceSize(size: TileSize): TileSize {
  return { cols: size.cols / 2, rows: size.rows / 2 }
}

/** The grid's gap, px (`gap-2`). */
export const GRID_GAP_PX = 8
/**
 * A third of a phone's row, px, gap included: a 366px grid (a 390 phone less
 * its gutters) is three of these. A face reads its width in these units.
 */
const PHONE_THIRD_PX = (366 + GRID_GAP_PX) / 3

/**
 * A size as a face reads it on either grid. The narrow (phone) grid is
 * `faceSize` exactly, so a phone lays out as it always has. On the WIDE grid
 * the columns are read off the tile's real width — in thirds of a phone's
 * row — so a tile a phone's width is a face 3 wide, and one half again as
 * wide is a face 4.5 wide, which lays out more (every leg side by side,
 * several airports, the limits in pairs). Rows are the grid's, as before.
 */
export function faceSizeOn(size: TileSize, grid: GridKind, gridPx: number, rowPx = 0): TileSize {
  // Rows as a face reads them: its real height in the old grid's rows.
  const rows = rowPx > 0 ? Math.max(0.5, Math.round(((size.rows * rowPx + size.rows * GRID_GAP_PX) / FACE_ROW_PX) * 2) / 2) : size.rows / 2
  if (grid === "narrow" || !(gridPx > 0)) return { cols: size.cols / 2, rows }
  const columns = WIDE_GRID_COLUMNS
  const col = (gridPx - GRID_GAP_PX * (columns - 1)) / columns
  const px = size.cols * col + (size.cols - 1) * GRID_GAP_PX
  return { cols: Math.round(((px + GRID_GAP_PX) / PHONE_THIRD_PX) * 4) / 4, rows }
}

/**
 * The height of one of the old grid's rows, px, gap included — what a face
 * means by "a row": two of the six-row grid's ~78px rows and their gap.
 */
const FACE_ROW_PX = 164

/** A face this wide (in thirds of a phone's row) has room for more than a phone shows. */
export const FACE_WIDE_COLS = 4.25

/* ── Places: the home screen ─────────────────────────────────────────────── */

/** A tile's PLACE: its top-left cell (0-based) and the cells it spans. */
export interface TilePos {
  col: number
  row: number
  cols: number
  rows: number
}

/**
 * A place put inside the grid: at least `minCols` wide, no wider or taller
 * than the grid, wholly on it — or, `below`, allowed under its foot, where a
 * push with no room on the screen sends a tile (a stored layout keeps it there).
 */
export function clampPos(pos: Partial<TilePos> | undefined, minCols = 1, columns = GRID_COLUMNS, rows = MAX_ROWS_SPAN, below = false): TilePos {
  const cols = clamp(pos?.cols ?? columns, Math.min(minCols, columns), columns)
  const height = clamp(pos?.rows ?? 1, 1, rows)
  return {
    cols,
    rows: height,
    col: clamp(pos?.col ?? 0, 0, columns - cols),
    row: below ? Math.max(0, Math.round(pos?.row ?? 0)) : clamp(pos?.row ?? 0, 0, rows - height),
  }
}

/**
 * The first free place on the screen (top to bottom, left to right) that
 * holds a tile of `size` without touching any of `placed` — else the same at
 * a smaller size: fewer rows first, then fewer columns down to `minCols`.
 * Null when nothing fits: an added tile is refused rather than pushing
 * another off the screen.
 */
export function findFreePlace(
  placed: readonly TilePos[],
  size: TileSize,
  minCols: number,
  columns = GRID_COLUMNS,
  rows = MAX_ROWS_SPAN,
): TilePos | null {
  const busy = (c: number, r: number) => placed.some((p) => c >= p.col && c < p.col + p.cols && r >= p.row && r < p.row + p.rows)
  const fits = (col: number, row: number, cols: number, h: number) => {
    if (col + cols > columns || row + h > rows) return false
    for (let r = row; r < row + h; r++) for (let c = col; c < col + cols; c++) if (busy(c, r)) return false
    return true
  }
  for (let cols = Math.min(size.cols, columns); cols >= Math.min(minCols, columns); cols--) {
    for (let h = Math.min(size.rows, rows); h >= 1; h--) {
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < columns; col++) if (fits(col, row, cols, h)) return { col, row, cols, rows: h }
    }
  }
  return null
}

/**
 * Every tile in a cell of its own. `first` keep the place they ask for (the
 * tile being moved or resized); every other tile keeps its own where it is
 * still free (taken top to bottom), and the rest go, each, to the NEAREST free
 * place their size fits in the grid — below the grid only where it has none.
 * Returned in `ids` order.
 */
export function arrangeTiles<T extends string>(
  ids: readonly T[],
  positions: Record<T, TilePos>,
  columns = GRID_COLUMNS,
  rows = MAX_ROWS_SPAN,
  first: readonly T[] = [],
): PlacedTile<T>[] {
  const pos = (id: T) => clampPos(positions[id], 1, columns, rows, true)
  const rest = ids.filter((id) => !first.includes(id))
  rest.sort((a, b) => pos(a).row - pos(b).row || pos(a).col - pos(b).col || ids.indexOf(a) - ids.indexOf(b))
  const order = [...first.filter((id) => ids.includes(id)), ...rest]
  const taken: boolean[][] = []
  const fits = (p: TilePos) => {
    if (p.col < 0 || p.row < 0 || p.col + p.cols > columns) return false
    for (let y = p.row; y < p.row + p.rows; y++) for (let x = p.col; x < p.col + p.cols; x++) if (taken[y]?.[x]) return false
    return true
  }
  const take = (p: TilePos) => {
    for (let y = p.row; y < p.row + p.rows; y++) {
      taken[y] ??= []
      for (let x = p.col; x < p.col + p.cols; x++) taken[y][x] = true
    }
  }
  const nearest = (p: TilePos): TilePos => {
    let best: TilePos | null = null
    let bestD = Infinity
    for (let r = 0; r + p.rows <= rows; r++)
      for (let c = 0; c + p.cols <= columns; c++) {
        const q = { ...p, row: r, col: c }
        if (!fits(q)) continue
        const d = (r - p.row) ** 2 + (c - p.col) ** 2
        if (d < bestD) {
          best = q
          bestD = d
        }
      }
    if (best) return best
    // No room on the screen: the first place below it (the grid scrolls).
    for (let r = Math.max(0, rows - p.rows + 1); ; r++)
      for (let c = 0; c + p.cols <= columns; c++) if (fits({ ...p, row: r, col: c })) return { ...p, row: r, col: c }
  }
  // Every tile whose place is still free keeps it; only then are the ones
  // in the way moved, each to the nearest place left — so a drop disturbs
  // the tiles it lands on and no others.
  const at = new Map<T, TilePos>()
  for (const id of order) {
    const want = pos(id)
    if (!fits(want)) continue
    take(want)
    at.set(id, want)
  }
  for (const id of order) {
    if (at.has(id)) continue
    const p = nearest(pos(id))
    take(p)
    at.set(id, p)
  }
  return ids.map((id) => ({ id, ...at.get(id)! }))
}

/** The rows the placed tiles reach down to — the fixed rows, or more where a push sent a tile below them. */
export function rowsUsed(placed: readonly TilePos[], rows: number): number {
  return placed.reduce((m, p) => Math.max(m, p.row + p.rows), rows)
}

/**
 * The tiles BUMPED DOWN out of the way of `id` at its new place (the owner,
 * round 50: enlarging a tile sent the one under it "all the way down to the
 * bottom"; a home screen bumps each one down a row). Every other tile keeps
 * its column and moves down only as far as it must to clear what is already
 * placed above it — taken top to bottom, so a tile bumped down bumps the one
 * under it in turn. A tile nothing lands on stays where it was.
 */
export function pushTilesDown<T extends string>(
  ids: readonly T[],
  positions: Record<T, TilePos>,
  id: T,
  columns = GRID_COLUMNS,
  rows = MAX_ROWS_SPAN,
): Record<T, TilePos> {
  const pos = (k: T) => clampPos(positions[k], 1, columns, rows, true)
  const out = {} as Record<T, TilePos>
  const placed: TilePos[] = []
  const hits = (p: TilePos) =>
    placed.some((q) => p.col < q.col + q.cols && q.col < p.col + p.cols && p.row < q.row + q.rows && q.row < p.row + p.rows)
  if (ids.includes(id)) {
    out[id] = pos(id)
    placed.push(out[id])
  }
  const rest = ids.filter((k) => k !== id).sort((a, b) => pos(a).row - pos(b).row || pos(a).col - pos(b).col)
  for (const k of rest) {
    const p = { ...pos(k) }
    while (hits(p)) p.row += 1
    out[k] = p
    placed.push(p)
  }
  return out
}

/**
 * The layout with `id` at `want` (moved, or resized from any edge): it takes
 * that place, and the tiles it lands on are BUMPED DOWN (`pushTilesDown`) —
 * or, where that would run past the screen's foot and room is left elsewhere,
 * each moved to the nearest place it fits (`arrangeTiles`). Every tile in
 * `ids` comes back with its place.
 */
export function placeTile<T extends string>(
  ids: readonly T[],
  positions: Record<T, TilePos>,
  id: T,
  want: TilePos,
  columns = GRID_COLUMNS,
  rows = MAX_ROWS_SPAN,
  minCols = 1,
): Record<T, TilePos> {
  const next = { ...positions, [id]: clampPos(want, minCols, columns, rows) } as Record<T, TilePos>
  const pushed = pushTilesDown(ids, next, id, columns, rows)
  if (rowsUsed(ids.map((k) => pushed[k]), rows) <= rows) return { ...positions, ...pushed }
  const out = { ...positions }
  for (const p of arrangeTiles(ids, next, columns, rows, [id])) out[p.id] = { col: p.col, row: p.row, cols: p.cols, rows: p.rows }
  return out
}

/**
 * The layout `placeTile` gives, or null where it would push a tile off the
 * foot of a screen that held them all — a home screen refuses a drop it has
 * no room for rather than sending a tile out of sight; the tile in hand stays
 * where it last could go.
 */
export function placeTileOnScreen<T extends string>(
  ids: readonly T[],
  positions: Record<T, TilePos>,
  id: T,
  want: TilePos,
  columns = GRID_COLUMNS,
  rows = MAX_ROWS_SPAN,
  minCols = 1,
): Record<T, TilePos> | null {
  const next = placeTile(ids, positions, id, want, columns, rows, minCols)
  const before = rowsUsed(arrangeTiles(ids, positions, columns, rows), rows)
  const after = rowsUsed(ids.map((k) => next[k]), rows)
  return after > rows && after > before ? null : next
}

/**
 * A resize from one EDGE: `dCols` / `dRows` cells out (positive) or in. The
 * right and bottom edges move the far side; the left and top move the near
 * side and keep the far one where it was.
 */
export function resizeFrom(start: TilePos, edge: "l" | "r" | "t" | "b", d: number, minCols: number, columns: number, rows: number): TilePos {
  const p = { ...start }
  if (edge === "r") p.cols = Math.min(columns - p.col, Math.max(minCols, start.cols + d))
  if (edge === "b") p.rows = Math.min(rows - p.row, Math.max(1, start.rows + d))
  if (edge === "l") {
    const right = start.col + start.cols
    p.col = Math.max(0, Math.min(right - minCols, start.col - d))
    p.cols = right - p.col
  }
  if (edge === "t") {
    const bottom = start.row + start.rows
    p.row = Math.max(0, Math.min(bottom - 1, start.row - d))
    p.rows = bottom - p.row
  }
  return p
}

/** "2 × 1" — a size as Arrange says it. */
export function sizeLabel(size: TileSize): string {
  return `${size.cols} × ${size.rows}`
}

/** `order` with `id` moved to where `target` is. */
export function moveTile<T extends string>(order: readonly T[], id: T, target: T): T[] {
  const from = order.indexOf(id)
  const to = order.indexOf(target)
  if (from < 0 || to < 0 || from === to) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** `order` with `id` moved `by` places (a keyboard's arrow), clamped to the ends. */
export function nudgeTile<T extends string>(order: readonly T[], id: T, by: number): T[] {
  const from = order.indexOf(id)
  if (from < 0) return [...order]
  const to = Math.min(order.length - 1, Math.max(0, from + by))
  return moveTile(order, id, order[to])
}

/**
 * A new order of the tiles ON SHOW put back into the full order: each slot a
 * shown tile held takes the next of `shown` in turn, and a tile not on show
 * (not applicable to this duty) keeps its place.
 */
export function mergeShownOrder<T extends string>(full: readonly T[], shown: readonly T[]): T[] {
  const on = new Set(shown)
  let k = 0
  return full.map((id) => (on.has(id) ? shown[k++] : id))
}
