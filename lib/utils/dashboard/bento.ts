/**
 * The flight dashboard's BENTO: its tiles in the pilot's own order, placed on
 * a grid SIX columns wide, a tile up to six rows tall (the owner, Nov 2026:
 * "make the bento grid 6x6 … more flexibility to widget size"; it was three
 * columns by two rows).
 *
 * Each tile has a SIZE the pilot chose in Arrange — 1 to 6 columns, 1 to 6
 * rows. Tiles are placed in order, left to right and top to bottom, each in
 * the first place it fits from where the last one went (never back above it,
 * so the order reads as chosen). What is left empty is then given to a
 * neighbour — the tile on its left widens, else the one on its right, else
 * the one above grows down — so the grid is always filled edge to edge, and
 * a tile alone on its row takes the whole row.
 *
 * Pure, so the packing is tested without the page.
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

export type GridKind = "narrow" | "wide"

export function columnsOf(grid: GridKind): number {
  return grid === "wide" ? WIDE_GRID_COLUMNS : GRID_COLUMNS
}

export function gridKindFor(widthPx: number): GridKind {
  return widthPx >= WIDE_GRID_MIN_PX ? "wide" : "narrow"
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

export function clampSize(size: Partial<TileSize> | undefined, minCols = 1, columns = GRID_COLUMNS): TileSize {
  return {
    cols: clamp(size?.cols ?? columns, minCols, columns),
    rows: clamp(size?.rows ?? 1, 1, MAX_ROWS_SPAN),
  }
}

export function packTiles<T extends string>(order: readonly T[], sizes: Record<T, TileSize>, columns = GRID_COLUMNS): PlacedTile<T>[] {
  // The order as chosen first; where that leaves a hole no neighbour can
  // take (finer sizes on the six-column grid can), a pass that lets a tile
  // drop back into an earlier gap — whichever leaves fewer holes.
  const strict = pack(order, sizes, false, columns)
  if (strict.holes === 0) return strict.placed
  const dense = pack(order, sizes, true, columns)
  return dense.holes < strict.holes ? dense.placed : strict.placed
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
  let changed = true
  while (changed) {
    changed = false
    for (let r = 0; r <= lastRow; r++) {
      for (let c = 0; c < columns; c++) {
        if (!free(r, c)) continue
        const left = c > 0 ? at(r, c - 1) : undefined
        if (left && left.col + left.cols === c && column(left, c)) {
          left.cols += 1
          claim(left, placed.indexOf(left))
          changed = true
          continue
        }
        const right = c < columns - 1 ? at(r, c + 1) : undefined
        if (right && right.col === c + 1 && column(right, c)) {
          right.col -= 1
          right.cols += 1
          claim(right, placed.indexOf(right))
          changed = true
          continue
        }
        const above = r > 0 ? at(r - 1, c) : undefined
        if (above && above.row + above.rows === r) {
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
        if (below && below.row === r + 1) {
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
export function faceSizeOn(size: TileSize, grid: GridKind, gridPx: number): TileSize {
  if (grid === "narrow" || !(gridPx > 0)) return faceSize(size)
  const columns = WIDE_GRID_COLUMNS
  const col = (gridPx - GRID_GAP_PX * (columns - 1)) / columns
  const px = size.cols * col + (size.cols - 1) * GRID_GAP_PX
  return { cols: Math.round(((px + GRID_GAP_PX) / PHONE_THIRD_PX) * 4) / 4, rows: size.rows / 2 }
}

/** A face this wide (in thirds of a phone's row) has room for more than a phone shows. */
export const FACE_WIDE_COLS = 4.25

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
