"use client"

/**
 * The flight dashboard's tiles as a SORTABLE BENTO (the owner, Nov 2026).
 *
 * The tiles keep their look; their ORDER and SIZE are the pilot's (per
 * device, `use-dashboard-layout.ts`), placed on a grid three columns wide in
 * which a tile spans 1–3 columns and 1–2 rows, always filled edge to edge
 * (`packTiles`). Arrange — the header's grid button — lets a tile be picked up
 * and dropped where another is (arrow keys for a keyboard), and RESIZED by
 * dragging its corner handle across the grid's cells (Shift + arrows): the
 * other tiles move round it live, so what is seen is the outcome.
 *
 * - **The DOM never moves.** Every tile stays at its place in the tree and the
 *   grid places it by explicit row and column, so reordering remounts nothing
 *   (a tile's face, its lookups, its sheet) and a drag keeps its node.
 * - **Layout animates only while arranging.** A `layout` element is measured
 *   on every render; outside Arrange the tiles are plain grid items.
 * - **The tile that is picked up is a COPY** that follows the finger, over a
 *   faded slot; the others move round it. It swaps when the finger enters
 *   another tile, and not back until the finger has left that tile — or the
 *   two would trade places every frame.
 */

import * as React from "react"
import { createPortal } from "react-dom"
import { animate, motion, useMotionValue } from "framer-motion"
import { Move, MoveDiagonal2 } from "lucide-react"
import { GRID_COLUMNS, moveTile, nudgeTile, packTiles, sizeLabel, type TileSize } from "@/lib/utils/dashboard/bento"
import { DASHBOARD_TILES, setArranging, setTileOrder, setTileSize, type DashboardTile } from "@/hooks/use-dashboard-layout"
import { haptic } from "@/lib/utils/haptics"
import { cn } from "@/lib/utils"

/** Swaps wait this long after the last — a layout settling under the finger is not a new target. */
const SWAP_COOLDOWN_MS = 140

interface Drag {
  id: DashboardTile
  w: number
  h: number
  ox: number
  oy: number
  dropping: boolean
}

/** The grid's gap, px (`gap-2`). */
const GAP = 8

/** A tile's resize in progress: where it began, and the grid's pitch. */
interface Resize {
  id: DashboardTile
  x0: number
  y0: number
  start: TileSize
  colPitch: number
  rowPitch: number
}

export function BentoGrid({
  order,
  sizes,
  arranging,
  label,
  tile,
  face,
}: {
  order: DashboardTile[]
  /** Each tile's chosen size on the three-column grid. */
  sizes: Record<DashboardTile, TileSize>
  arranging: boolean
  label: (id: DashboardTile) => string
  /** The tile as the page shows it, at the size it is placed at. */
  tile: (id: DashboardTile, size: TileSize) => React.ReactNode
  /** Its face alone, for the card that is dragged and the slots while arranging. */
  face: (id: DashboardTile, size: TileSize) => React.ReactNode
}) {
  const placed = React.useMemo(() => {
    const m = new Map<DashboardTile, { index: number; col: number; row: number; cols: number; rows: number }>()
    packTiles(order, sizes).forEach((t, index) => m.set(t.id, { index, col: t.col, row: t.row, cols: t.cols, rows: t.rows }))
    return m
  }, [order, sizes])
  const sizesRef = React.useRef(sizes)
  React.useEffect(() => {
    sizesRef.current = sizes
  }, [sizes])

  const [resize, setResize] = React.useState<Resize | null>(null)
  const resizeId = resize?.id ?? null
  React.useEffect(() => {
    if (!resize) return
    const onMove = (e: PointerEvent) => {
      const cols = Math.round(resize.start.cols + (e.clientX - resize.x0) / resize.colPitch)
      const rows = Math.round(resize.start.rows + (e.clientY - resize.y0) / resize.rowPitch)
      const cur = sizesRef.current[resize.id]
      setTileSize(resize.id, { cols, rows })
      const next = sizesRef.current[resize.id]
      if (cur.cols !== next.cols || cur.rows !== next.rows) haptic("tick")
    }
    const onUp = () => setResize(null)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [resize])

  // A grid's pitch: a column's width plus the gap, a row's height (as this
  // tile has it) plus the gap — one step of the handle is one cell.
  const startResize = (e: React.PointerEvent<HTMLElement>, id: DashboardTile) => {
    e.stopPropagation()
    e.preventDefault()
    const slot = e.currentTarget.closest<HTMLElement>("[data-tile-slot]")
    const grid = slot?.parentElement
    if (!slot || !grid) return
    const g = grid.getBoundingClientRect()
    const r = slot.getBoundingClientRect()
    const start = sizesRef.current[id]
    const p = placed.get(id)
    setResize({
      id,
      x0: e.clientX,
      y0: e.clientY,
      start,
      colPitch: (g.width - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS + GAP,
      rowPitch: Math.max(48, (r.height + GAP) / (p?.rows ?? 1)),
    })
    haptic("tick")
  }

  const orderRef = React.useRef(order)
  React.useEffect(() => {
    orderRef.current = order
  }, [order])

  const [drag, setDrag] = React.useState<Drag | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const swap = React.useRef<{ target: DashboardTile | null; at: number }>({ target: null, at: 0 })

  // Escape ends arranging, as Done does.
  React.useEffect(() => {
    if (!arranging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArranging(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [arranging])

  // The drag follows the pointer on the WINDOW: the slot it began on moves
  // under it as the others are reordered.
  const dragId = drag && !drag.dropping ? drag.id : null
  React.useEffect(() => {
    if (!dragId || !drag) return
    const { ox, oy } = drag
    const onMove = (e: PointerEvent) => {
      x.set(e.clientX - ox)
      y.set(e.clientY - oy)
      const hit = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((n): n is HTMLElement => n instanceof HTMLElement && !!n.dataset.tileSlot)
      const target = (hit?.dataset.tileSlot as DashboardTile | undefined) ?? null
      if (!target || target === dragId) {
        swap.current.target = null
        return
      }
      const now = performance.now()
      if (target === swap.current.target || now - swap.current.at < SWAP_COOLDOWN_MS) return
      swap.current = { target, at: now }
      setTileOrder(moveTile(orderRef.current, dragId, target))
      haptic("tick")
    }
    const onUp = () => {
      const slot = document.querySelector<HTMLElement>(`[data-tile-slot="${dragId}"]`)
      const r = slot?.getBoundingClientRect()
      setDrag((d) => (d ? { ...d, dropping: true } : d))
      const done = () => setDrag(null)
      if (!r) return done()
      void animate(x, r.left, { duration: 0.2, ease: [0.22, 1, 0.36, 1] })
      void animate(y, r.top, { duration: 0.2, ease: [0.22, 1, 0.36, 1] }).then(done)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener set per pick-up; ox/oy are fixed for it
  }, [dragId, x, y])

  const pickUp = (e: React.PointerEvent<HTMLElement>, id: DashboardTile) => {
    if (e.button !== 0 || drag) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    x.set(r.left)
    y.set(r.top)
    swap.current = { target: null, at: 0 }
    setDrag({ id, w: r.width, h: r.height, ox: e.clientX - r.left, oy: e.clientY - r.top, dropping: false })
    haptic("tick")
  }

  const onKey = (e: React.KeyboardEvent, id: DashboardTile) => {
    if (e.shiftKey) {
      const s0 = sizesRef.current[id]
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (!d) return
      e.preventDefault()
      setTileSize(id, { cols: s0.cols + d[0], rows: s0.rows + d[1] })
      return
    }
    const by = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0
    if (!by) return
    e.preventDefault()
    setTileOrder(nudgeTile(orderRef.current, id, by))
  }

  return (
    <>
      <div
        // While arranging, the grid gains a margin's room on every side (and
        // gives it back as negative margin, so nothing moves) for the move
        // badges that sit ON each tile's corner — inside it they covered the
        // tile's own corner (a weather hazard, the currency tally).
        className={cn(
          "grid min-h-0 content-start gap-2 overflow-y-auto overscroll-contain scrollbar-hide",
          arranging && "-m-2 p-2",
        )}
        // A row is as tall as its tallest tile, and a tile two rows tall spans
        // both; the floor keeps a two-row tile visibly two rows.
        style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: "minmax(5.5rem, auto)" }}
      >
        {/* The DOM order never changes: the grid places each tile by row and column. */}
        {DASHBOARD_TILES.map((id) => {
          const p = placed.get(id)!
          const size: TileSize = { cols: p.cols, rows: p.rows }
          const style = { gridColumn: `${p.col + 1} / span ${p.cols}`, gridRow: `${p.row + 1} / span ${p.rows}` }
          if (!arranging) {
            return (
              <div key={id} className="flex min-w-0" style={style}>
                {tile(id, size)}
              </div>
            )
          }
          const resizing = resizeId === id
          const lifted = drag?.id === id
          return (
            <motion.div
              key={id}
              layout="position"
              transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.8 }}
              data-tile-slot={id}
              role="button"
              tabIndex={0}
              aria-roledescription="Movable tile"
              aria-label={`Move ${label(id)}, ${p.index + 1} of ${DASHBOARD_TILES.length}, ${sizeLabel(sizes[id])}. Arrow keys move it, Shift and arrows resize it.`}
              onPointerDown={(e) => pickUp(e, id)}
              onKeyDown={(e) => onKey(e, id)}
              style={{ ...style, touchAction: "none" }}
              className="relative flex min-w-0 cursor-grab select-none rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div
                className={cn(
                  "pointer-events-none relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-dashed border-foreground/30 bg-card p-3",
                )}
              >
                {/* Dimmed while arranging: the tile is being placed, not read,
                    and its width chip sits over the middle of it. */}
                <div className={cn("transition-opacity", lifted ? "opacity-20" : "opacity-45")}>{face(id, size)}</div>
              </div>
              <span
                aria-hidden
                className="pointer-events-none absolute -right-1.5 -top-1.5 z-[1] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-[var(--control)] text-foreground"
              >
                <Move className="h-3.5 w-3.5" />
              </span>
              {/* Its size, said while it changes. */}
              {resizing && (
                <span className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex h-9 min-w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-[var(--control)] px-3 text-sm font-semibold tabular-nums text-foreground">
                  {sizeLabel(sizes[id])}
                </span>
              )}
              {/* The corner handle: drag it across the grid's cells to resize. */}
              <span
                aria-hidden
                onPointerDown={(e) => startResize(e, id)}
                className="absolute -bottom-1.5 -right-1.5 z-[1] flex h-7 w-7 cursor-nwse-resize items-center justify-center rounded-full border border-border bg-[var(--control)] text-foreground after:absolute after:-inset-2"
                style={{ touchAction: "none" }}
              >
                <MoveDiagonal2 className="h-3.5 w-3.5" />
              </span>
            </motion.div>
          )
        })}
      </div>

      {drag &&
        typeof document !== "undefined" &&
        createPortal(
          <motion.div
            aria-hidden
            className="pointer-events-none fixed left-0 top-0 z-[210] flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-3"
            style={{ x, y, width: drag.w, height: drag.h, boxShadow: "0 18px 40px -12px rgba(0,0,0,0.45)" }}
            initial={{ scale: 1 }}
            animate={{ scale: drag.dropping ? 1 : 1.04 }}
            transition={{ duration: 0.16 }}
          >
            {face(drag.id, sizes[drag.id])}
          </motion.div>,
          document.body,
        )}
    </>
  )
}
