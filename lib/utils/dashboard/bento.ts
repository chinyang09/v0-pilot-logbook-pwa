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
 * an empty cell stays empty. A tile dropped or resized over others PUSHES
 * them, each to the nearest place it fits (`placeTile`); where the grid has
 * none, below it, and the grid scrolls.
 *
 * `packTiles` — the order-and-size packing this replaced — stays, to carry a
 * layout stored before it across into places.
 *
 * Pure, so the placement is tested without the page.
 */

export const GRID_COLUMNS = 6
export const MAX_ROWS_SPAN = 6

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
 * The ROWS a screen is divided into (the owner, Nov 2026: "need a more
 * definitive way … on phone max of 4 rows, but on ipad portrait vs landscape
 * is different"). A row is a FIXED share of the height the Flight Deck has
 * — never as tall as its content — so a tile one row tall and one two rows
 * tall are always visibly different, and the default layout fills one screen.
 */
export const GRID_ROWS: Record<GridKind, number> = { narrow: 6, wide: 6, tall: 8 }

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

/** A row's height in a box `heightPx` tall: the box shared out among the grid's rows and their gaps. */
export function rowHeightFor(grid: GridKind, heightPx: number): number {
  const rows = rowsOf(grid)
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
 * Place the tiles. `rows` is the screen's (`rowsOf`): no tile is taller than
 * it, and a layout that ends ONE row short of it has its bottom tiles grown
 * into that row — the slight adjustment that keeps an empty band off the
 * bottom of the screen (the owner). A tile the pilot made 1 × 1 is never
 * grown, there or into a hole: it stays the square they chose.
 */
export function packTiles<T extends string>(
  order: readonly T[],
  sizes: Record<T, TileSize>,
  columns = GRID_COLUMNS,
  rows = MAX_ROWS_SPAN,
): PlacedTile<T>[] {
  const clamped = Object.fromEntries(order.map((id) => [id, clampSize(sizes[id], 1, columns, rows)])) as Record<T, TileSize>
  // The order as chosen first; where that leaves a hole no neighbour can
  // take (finer sizes on the six-column grid can), a pass that lets a tile
  // drop back into an earlier gap — whichever leaves fewer holes.
  const strict = pack(order, clamped, false, columns)
  const best = strict.holes === 0 ? strict : (() => {
    const dense = pack(order, clamped, true, columns)
    return dense.holes < strict.holes ? dense : strict
  })()
  return fillBottom(best.placed, clamped, rows)
}

const isSquare = (s: TileSize) => s.cols === 1 && s.rows === 1

function fillBottom<T extends string>(placed: PlacedTile<T>[], chosen: Record<T, TileSize>, rows: number): PlacedTile<T>[] {
  const used = placed.reduce((m, p) => Math.max(m, p.row + p.rows), 0)
  if (used === 0 || rows - used !== 1) return placed
  return placed.map((p) => (p.row + p.rows === used && !isSquare(chosen[p.id]) ? { ...p, rows: p.rows + 1 } : p))
}

function pack<T extends string>(
  order: readonly T[],
  sizes: Record<T, TileSize>,
  dense: boolean,
  columns: number,
): { placed: PlacedTile<T>[]; holes: number } {
  const cells: (number | undefined)[][] = []
  const free = (r: number, c: number) => cells[r]?.[c] === undefined
  const take = (r: number, c: number, i: number) => {
    cells[r] ??= []
    cells[r][c] = i
  }
  const fits = (r: number, c: number, cols: number, rows: number) => {
    if (c + cols > columns) return false
    for (let y = r; y < r + rows; y++) for (let x = c; x < c + cols; x++) if (!free(y, x)) return false
    return true
  }

  const placed: PlacedTile<T>[] = []
  // The cursor: a tile is placed at or after where the last one went.
  let cr = 0
  let cc = 0
  order.forEach((id, i) => {
    const { cols, rows } = clampSize(sizes[id], 1, columns)
    let r = dense ? 0 : cr
    let c = dense ? 0 : cc
    while (!fits(r, c, cols, rows)) {
      c += 1
      if (c >= columns) {
        c = 0
        r += 1
      }
    }
    for (let y = r; y < r + rows; y++) for (let x = c; x < c + cols; x++) take(y, x, i)
    placed.push({ id, col: c, row: r, cols, rows })
    cr = r
    cc = c + cols
  })

  // Give every hole to a neighbour, until none can take one.
  const lastRow = placed.reduce((m, p) => Math.max(m, p.row + p.rows - 1), -1)
  const at = (r: number, c: number) => {
    const i = cells[r]?.[c]
    return i === undefined ? undefined : placed[i]
  }
  const column = (p: PlacedTile<T>, c: number) => {
    for (let y = p.row; y < p.row + p.rows; y++) if (!free(y, c)) return false
    return true
  }
  const claim = (p: PlacedTile<T>, i: number) => {
    for (let y = p.row; y < p.row + p.rows; y++) for (let x = p.col; x < p.col + p.cols; x++) take(y, x, i)
  }
  // A tile the pilot made 1 × 1 takes no hole: it stays their square.
  const fixed = (p: PlacedTile<T>) => isSquare(sizes[p.id])
  let changed = true
  while (changed) {
    changed = false
    for (let r = 0; r <= lastRow; r++) {
      for (let c = 0; c < columns; c++) {
        if (!free(r, c)) continue
        const left = c > 0 ? at(r, c - 1) : undefined
        if (left && !fixed(left) && left.col + left.cols === c && column(left, c)) {
          left.cols += 1
          claim(left, placed.indexOf(left))
          changed = true
          continue
        }
        const right = c < columns - 1 ? at(r, c + 1) : undefined
        if (right && !fixed(right) && right.col === c + 1 && column(right, c)) {
          right.col -= 1
          right.cols += 1
          claim(right, placed.indexOf(right))
          changed = true
          continue
        }
        const above = r > 0 ? at(r - 1, c) : undefined
        if (above && !fixed(above) && above.row + above.rows === r) {
          let fitsBelow = true
          for (let x = above.col; x < above.col + above.cols; x++) if (!free(r, x)) fitsBelow = false
          if (fitsBelow) {
            above.rows += 1
            claim(above, placed.indexOf(above))
            changed = true
            continue
          }
        }
        // The tile below grows up into it, where its whole width is free here.
        const below = at(r + 1, c)
        if (below && !fixed(below) && below.row === r + 1) {
          let fitsAbove = true
          for (let x = below.col; x < below.col + below.cols; x++) if (!free(r, x)) fitsAbove = false
          if (fitsAbove) {
            below.row -= 1
            below.rows += 1
            claim(below, placed.indexOf(below))
            changed = true
          }
        }
      }
    }
  }
  let holes = 0
  for (let r = 0; r <= lastRow; r++) for (let c = 0; c < columns; c++) if (free(r, c)) holes++
  return { placed, holes }
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
 * The layout with `id` at `want` (moved, or resized from any edge): it takes
 * that place, and the tiles it lands on are pushed (`arrangeTiles`). Every
 * tile in `ids` comes back with its place.
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

/**
 * A layout stored as an ORDER and SIZES (before places) on the home screen:
 * packed as it was drawn on its `fromRows` rows, then every row EDGE moved to
 * the same share of `toRows` (four rows to a phone became six), so the tiles
 * open where the pilot left them, in the same proportions, none overlapping.
 */
export function positionsFromSizes<T extends string>(
  order: readonly T[],
  sizes: Record<T, TileSize>,
  columns: number,
  fromRows: number,
  toRows: number,
): Record<T, TilePos> {
  const edge = (r: number) => Math.round((r * toRows) / fromRows)
  const out = {} as Record<T, TilePos>
  for (const p of packTiles(order, sizes, columns, fromRows)) {
    const row = edge(p.row)
    out[p.id] = { col: p.col, cols: p.cols, row, rows: Math.max(1, edge(p.row + p.rows) - row) }
  }
  return out
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
