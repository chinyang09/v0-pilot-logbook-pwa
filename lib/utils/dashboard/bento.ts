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

export function clampSize(size: Partial<TileSize> | undefined, minCols = 1): TileSize {
  return {
    cols: clamp(size?.cols ?? GRID_COLUMNS, minCols, GRID_COLUMNS),
    rows: clamp(size?.rows ?? 1, 1, MAX_ROWS_SPAN),
  }
}

export function packTiles<T extends string>(order: readonly T[], sizes: Record<T, TileSize>): PlacedTile<T>[] {
  // The order as chosen first; where that leaves a hole no neighbour can
  // take (finer sizes on the six-column grid can), a pass that lets a tile
  // drop back into an earlier gap — whichever leaves fewer holes.
  const strict = pack(order, sizes, false)
  if (strict.holes === 0) return strict.placed
  const dense = pack(order, sizes, true)
  return dense.holes < strict.holes ? dense.placed : strict.placed
}

function pack<T extends string>(order: readonly T[], sizes: Record<T, TileSize>, dense: boolean): { placed: PlacedTile<T>[]; holes: number } {
  const cells: (number | undefined)[][] = []
  const free = (r: number, c: number) => cells[r]?.[c] === undefined
  const take = (r: number, c: number, i: number) => {
    cells[r] ??= []
    cells[r][c] = i
  }
  const fits = (r: number, c: number, cols: number, rows: number) => {
    if (c + cols > GRID_COLUMNS) return false
    for (let y = r; y < r + rows; y++) for (let x = c; x < c + cols; x++) if (!free(y, x)) return false
    return true
  }

  const placed: PlacedTile<T>[] = []
  // The cursor: a tile is placed at or after where the last one went.
  let cr = 0
  let cc = 0
  order.forEach((id, i) => {
    const { cols, rows } = clampSize(sizes[id])
    let r = dense ? 0 : cr
    let c = dense ? 0 : cc
    while (!fits(r, c, cols, rows)) {
      c += 1
      if (c >= GRID_COLUMNS) {
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
      for (let c = 0; c < GRID_COLUMNS; c++) {
        if (!free(r, c)) continue
        const left = c > 0 ? at(r, c - 1) : undefined
        if (left && left.col + left.cols === c && column(left, c)) {
          left.cols += 1
          claim(left, placed.indexOf(left))
          changed = true
          continue
        }
        const right = c < GRID_COLUMNS - 1 ? at(r, c + 1) : undefined
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
  for (let r = 0; r <= lastRow; r++) for (let c = 0; c < GRID_COLUMNS; c++) if (free(r, c)) holes++
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
