"use client"

/**
 * The flight dashboard's tiles as a SORTABLE BENTO (the owner, Nov 2026).
 *
 * The tiles keep their look; their ORDER and SIZE are the pilot's (per
 * device, `use-dashboard-layout.ts`), placed on a grid three columns wide in
 * which a tile spans 1–3 columns and 1–2 rows, always filled edge to edge
 * (`packTiles`). Arrange — a long press on any tile, which picks it up in
 * the same gesture; Done in the header ends it — lets a tile be picked up
 * and dropped where another is (arrow keys for a keyboard), and RESIZED by
 * dragging any edge of the tile in hand across the grid's cells (Shift +
 * arrows): the
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
import { Move } from "lucide-react"
import { GRID_GAP_PX, columnsOf, mergeShownOrder, moveTile, nudgeTile, packTiles, sizeLabel, type GridKind, type TileSize } from "@/lib/utils/dashboard/bento"
import { DASHBOARD_TILES, setArranging, setTileOrder, setTileSize, type DashboardTile } from "@/hooks/use-dashboard-layout"
import { haptic } from "@/lib/utils/haptics"
import { cn } from "@/lib/utils"

/**
 * A tile held on the page (`Widget`'s long press): the grid goes into
 * Arrange and picks THIS tile up under the finger still down, so the hold
 * and the drag are one gesture — the way a home screen does it.
 */
const pending: { current: { id: DashboardTile; x: number; y: number } | null } = { current: null }
/** The held tile, once: the grid takes it on entering Arrange. */
function takePending() {
  const p = pending.current
  pending.current = null
  return p
}
export function beginArrangeFrom(id: DashboardTile, x: number, y: number): void {
  pending.current = { id, x, y }
  haptic("tap")
  setArranging(true)
}

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
const GAP = GRID_GAP_PX
/** A row's floor, px (2.5rem): two rows and the gap are the 3 × 2 grid's 5.5rem. */
const ROW_MIN_PX = 40

/** Which edge a resize pulls: left / right change the columns, top / bottom the rows. */
type Edge = "l" | "r" | "t" | "b"

/** A tile's resize in progress: where it began, the edge pulled, and the grid's pitch. */
interface Resize {
  id: DashboardTile
  edge: Edge
  x0: number
  y0: number
  start: TileSize
  colPitch: number
  rowPitch: number
  grid: GridKind
}

export function BentoGrid({
  grid,
  gridRef,
  order,
  fullOrder,
  sizes,
  arranging,
  label,
  tile,
  face,
}: {
  /** Six columns (a phone, a narrow panel) or twelve (`gridKindFor` — a desktop's full width). */
  grid: GridKind
  /** The grid element — the page measures it to choose `grid`. */
  gridRef?: React.Ref<HTMLDivElement>
  /** The tiles on show, in order. */
  order: DashboardTile[]
  /** Every tile in the pilot's order, those not applicable now included (a standby's flights). */
  fullOrder?: DashboardTile[]
  /** Each tile's chosen size on `grid`. */
  sizes: Record<DashboardTile, TileSize>
  arranging: boolean
  label: (id: DashboardTile) => string
  /** The tile as the page shows it, at the size it is placed at. */
  tile: (id: DashboardTile, size: TileSize) => React.ReactNode
  /** Its face alone, for the card that is dragged and the slots while arranging. */
  face: (id: DashboardTile, size: TileSize) => React.ReactNode
}) {
  const columns = columnsOf(grid)
  const placed = React.useMemo(() => {
    const m = new Map<DashboardTile, { index: number; col: number; row: number; cols: number; rows: number }>()
    packTiles(order, sizes, columns).forEach((t, index) => m.set(t.id, { index, col: t.col, row: t.row, cols: t.cols, rows: t.rows }))
    return m
  }, [order, sizes, columns])
  const sizesRef = React.useRef(sizes)
  React.useEffect(() => {
    sizesRef.current = sizes
  }, [sizes])

  const [resize, setResize] = React.useState<Resize | null>(null)
  const resizeId = resize?.id ?? null
  React.useEffect(() => {
    if (!resize) return
    const onMove = (e: PointerEvent) => {
      // An edge pulled OUT grows the tile, pushed IN shrinks it, whichever
      // side it is (the owner: "increase or decrease size from all
      // direction"). Where the tile sits stays the packing's.
      const dx = (e.clientX - resize.x0) / resize.colPitch
      const dy = (e.clientY - resize.y0) / resize.rowPitch
      const { edge, start } = resize
      const cols = Math.round(start.cols + (edge === "r" ? dx : edge === "l" ? -dx : 0))
      const rows = Math.round(start.rows + (edge === "b" ? dy : edge === "t" ? -dy : 0))
      const cur = sizesRef.current[resize.id]
      setTileSize(resize.id, { cols, rows }, resize.grid)
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
  const startResize = (e: React.PointerEvent<HTMLElement>, id: DashboardTile, edge: Edge) => {
    e.stopPropagation()
    e.preventDefault()
    const slot = e.currentTarget.closest<HTMLElement>("[data-tile-slot]")
    const gridEl = slot?.parentElement
    if (!slot || !gridEl) return
    const g = gridEl.getBoundingClientRect()
    const r = slot.getBoundingClientRect()
    const start = sizesRef.current[id]
    const p = placed.get(id)
    setActive(id)
    setResize({
      id,
      edge,
      x0: e.clientX,
      y0: e.clientY,
      start,
      colPitch: (g.width - GAP * (columns - 1)) / columns + GAP,
      rowPitch: Math.max(ROW_MIN_PX + GAP, (r.height + GAP) / (p?.rows ?? 1)),
      grid,
    })
    haptic("tick")
  }

  const orderRef = React.useRef(order)
  const fullRef = React.useRef(fullOrder ?? order)
  React.useEffect(() => {
    orderRef.current = order
    fullRef.current = fullOrder ?? order
  }, [order, fullOrder])
  // A reorder of the tiles on show keeps the hidden ones where they were.
  const reorder = (next: DashboardTile[]) => setTileOrder(mergeShownOrder(fullRef.current, next))

  const [drag, setDrag] = React.useState<Drag | null>(null)
  // The tile in hand: its frame and its four edge handles are drawn; the
  // others show only that they can be moved. A tap (or a pick-up) on another
  // takes the handles to it.
  const [activeState, setActive] = React.useState<DashboardTile | null>(null)
  const active = arranging ? activeState : null
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
      reorder(moveTile(orderRef.current, dragId, target))
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
    // A drag that began as a long press began on a tile that lets the page
    // pan: held, the finger's moves must carry the tile, not scroll the grid
    // (which would also cancel the pointer).
    const noScroll = (e: TouchEvent) => e.preventDefault()
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    window.addEventListener("touchmove", noScroll, { passive: false })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      window.removeEventListener("touchmove", noScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener set per pick-up; ox/oy are fixed for it
  }, [dragId, x, y])

  // The tile a long press entered Arrange with: picked up where the finger is.
  React.useLayoutEffect(() => {
    if (!arranging) return
    const p = takePending()
    if (!p) return
    const slot = document.querySelector<HTMLElement>(`[data-tile-slot="${p.id}"]`)
    const r = slot?.getBoundingClientRect()
    if (!r) return
    x.set(r.left)
    y.set(r.top)
    swap.current = { target: null, at: 0 }
    // A layout effect with nothing else to read from: the pick-up IS the
    // response to the hold, in the commit that entered Arrange.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrag({ id: p.id, w: r.width, h: r.height, ox: p.x - r.left, oy: p.y - r.top, dropping: false })
    setActive(p.id)
  }, [arranging, x, y])

  const pickUp = (e: React.PointerEvent<HTMLElement>, id: DashboardTile) => {
    if (e.button !== 0 || drag) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    x.set(r.left)
    y.set(r.top)
    swap.current = { target: null, at: 0 }
    setDrag({ id, w: r.width, h: r.height, ox: e.clientX - r.left, oy: e.clientY - r.top, dropping: false })
    setActive(id)
    haptic("tick")
  }

  const onKey = (e: React.KeyboardEvent, id: DashboardTile) => {
    if (e.shiftKey) {
      const s0 = sizesRef.current[id]
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (!d) return
      e.preventDefault()
      setTileSize(id, { cols: s0.cols + d[0], rows: s0.rows + d[1] }, grid)
      return
    }
    const by = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0
    if (!by) return
    e.preventDefault()
    reorder(nudgeTile(orderRef.current, id, by))
  }

  return (
    <>
      {/* The SCROLLER is a wrapper, not the grid: a grid with a height of its
          own shares that height out among its rows, and a tile (which clips,
          so it has no minimum height) was SQUEEZED to fit — a reordered grid
          taller than the phone cut the duty tile's captions off. Unbounded,
          every row is as tall as its tallest tile, and only the wrapper
          scrolls, as a last resort. */}
      {/* On the WIDE grid the rows also share the page's HEIGHT (a desktop has
          room under the tiles a phone has not): auto rows stretch to fill a
          grid taller than its content, and never shrink below it. */}
      <div
        className={cn("min-h-0 overflow-y-auto overscroll-contain scrollbar-hide", grid === "wide" && "flex-1", arranging && "-m-4 p-4")}
        data-bento-scroll
      >
      <div
        ref={gridRef}
        // While arranging, the wrapper gains a margin's room on every side
        // (and gives it back as negative margin, so nothing moves) for the
        // move badges that sit ON each tile's corner — inside it they covered
        // the tile's own corner (a weather hazard, the currency tally).
        className={cn("grid gap-2", grid === "wide" ? "min-h-full content-stretch" : "content-start")}
        // A row is as tall as its tallest tile, and a tile two rows tall spans
        // both; the floor keeps a two-row tile visibly two rows.
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: `minmax(${ROW_MIN_PX}px, auto)` }}
      >
        {/* The DOM order never changes: the grid places each tile by row and column. */}
        {DASHBOARD_TILES.map((id) => {
          // A tile not in the order is not applicable to this duty (a standby's flights).
          const p = placed.get(id)
          if (!p) return null
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
              aria-label={`Move ${label(id)}, ${p.index + 1} of ${order.length}, ${sizeLabel(sizes[id])}. Arrow keys move it, Shift and arrows resize it.`}
              onPointerDown={(e) => pickUp(e, id)}
              onKeyDown={(e) => onKey(e, id)}
              onFocus={() => setActive(id)}
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
                {/* A flex column like the tile's own button: a face that fills the tile
                    (the airport's station, its corners laid out absolutely)
                    otherwise collapsed to nothing — the owner's "blank" tile. */}
                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", lifted ? "opacity-20" : "opacity-45")}>{face(id, size)}</div>
              </div>
              {active !== id && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-1.5 -top-1.5 z-[1] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-[var(--control)] text-foreground"
                >
                  <Move className="h-3.5 w-3.5" />
                </span>
              )}
              {/* Its size, said while it changes. */}
              {resizing && (
                <span className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex h-9 min-w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-[var(--control)] px-3 text-sm font-semibold tabular-nums text-foreground">
                  {sizeLabel(sizes[id])}
                </span>
              )}
              {/* The tile in hand: a frame and a handle at the middle of each
                  edge (the owner's sketch, after a home-screen widget) — drag
                  an edge out to grow the tile that way, in to shrink it. */}
              {active === id && (
                <>
                  <span aria-hidden className="pointer-events-none absolute -inset-[3px] z-[1] rounded-[18px] border-2 border-foreground/85" />
                  {(["t", "r", "b", "l"] as const).map((edge) => (
                    <span
                      key={edge}
                      aria-hidden
                      data-edge={edge}
                      onPointerDown={(e) => startResize(e, id, edge)}
                      className={cn(
                        "absolute z-[2] h-5 w-5 rounded-full border-2 border-foreground/85 bg-[var(--control)] after:absolute after:-inset-3",
                        edge === "t" && "-top-[13px] left-1/2 -translate-x-1/2 cursor-ns-resize",
                        edge === "b" && "-bottom-[13px] left-1/2 -translate-x-1/2 cursor-ns-resize",
                        edge === "l" && "-left-[13px] top-1/2 -translate-y-1/2 cursor-ew-resize",
                        edge === "r" && "-right-[13px] top-1/2 -translate-y-1/2 cursor-ew-resize",
                      )}
                      style={{ touchAction: "none" }}
                    />
                  ))}
                </>
              )}
            </motion.div>
          )
        })}
      </div>
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
