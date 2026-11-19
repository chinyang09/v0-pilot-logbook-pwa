/**
 * The flight dashboard's BENTO: its tiles in the pilot's own order, packed
 * into rows of a 12-column grid (the owner, Nov 2026: "a sortable bento box").
 *
 * Each tile has the fewest columns it reads at (`minCols`): the duty and the
 * flight take a whole row, a three-up tile four, a two-up tile six. Tiles are
 * taken in order and put on one row while their minimums fit; the row's spare
 * columns are then shared out, so every row is filled edge to edge whatever
 * order the pilot chose — a tile alone on its row takes the whole row. The
 * default order packs into exactly the layout the dashboard has always had:
 * duty / flight / weather·crew·last there / currency·limits.
 *
 * Pure, so the packing is tested without the page.
 */

export const GRID_COLUMNS = 12

export interface PackedTile<T extends string> {
  id: T
  /** Columns of the 12 it spans. */
  span: number
}

export function packTiles<T extends string>(order: readonly T[], minCols: Record<T, number>): PackedTile<T>[][] {
  const rows: PackedTile<T>[][] = []
  let row: T[] = []
  let used = 0
  const flush = () => {
    if (row.length === 0) return
    const spare = GRID_COLUMNS - used
    const each = Math.floor(spare / row.length)
    let rest = spare - each * row.length
    rows.push(
      row.map((id) => {
        const extra = each + (rest > 0 ? 1 : 0)
        if (rest > 0) rest -= 1
        return { id, span: clampCols(minCols[id]) + extra }
      }),
    )
    row = []
    used = 0
  }
  for (const id of order) {
    const min = clampCols(minCols[id])
    if (used + min > GRID_COLUMNS) flush()
    row.push(id)
    used += min
  }
  flush()
  return rows
}

const clampCols = (n: number | undefined) => Math.min(GRID_COLUMNS, Math.max(1, Math.round(n ?? GRID_COLUMNS)))

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
