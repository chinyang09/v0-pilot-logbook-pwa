/**
 * The largest circle a box can hold clear of the text in it — what the
 * Airport tile's runway diagram is sized by (the owner, Nov 2026: "allow ring
 * to occupy as much space as possible without any text covering it or it
 * covering any text"; "I need the airport runways and ring to scale
 * accordingly").
 *
 * The text sits in the box's corners as rectangles; the circle is kept off
 * each of them and inside the box. The centre is searched on a pixel grid —
 * a tile is a few hundred pixels a side, so it is exact enough and far under
 * a millisecond — across the middle of the box only (`spread` of its width
 * either side of centre), because a ring pushed against one side reads as
 * misplaced. Of equal circles the one nearest the centre wins.
 *
 * Pure, on plain numbers.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Circle {
  x: number
  y: number
  r: number
}

/** The distance from a point to a rectangle (0 inside it). */
function toRect(x: number, y: number, q: Rect): number {
  const dx = Math.max(q.left - x, 0, x - q.right)
  const dy = Math.max(q.top - y, 0, y - q.bottom)
  return Math.hypot(dx, dy)
}

export function largestCircle(width: number, height: number, avoid: readonly Rect[], spread = 0.15): Circle | null {
  if (!(width > 0 && height > 0)) return null
  const cx = width / 2
  const cy = height / 2
  const reach = width * spread
  let best: Circle | null = null
  let bestOff = Infinity
  for (let x = Math.ceil(cx - reach); x <= cx + reach; x++) {
    for (let y = 0; y <= height; y++) {
      let r = Math.min(x, width - x, y, height - y)
      for (const q of avoid) {
        if (r <= (best?.r ?? 0)) break
        r = Math.min(r, toRect(x, y, q))
      }
      const off = Math.hypot(x - cx, y - cy)
      if (!best || r > best.r + 0.01 || (Math.abs(r - best.r) <= 0.01 && off < bestOff)) {
        if (best && r < best.r - 0.01) continue
        best = { x, y, r }
        bestOff = off
      }
    }
  }
  return best && best.r > 0 ? best : null
}
