"use client"

/**
 * The flight dashboard's tiles on a HOME SCREEN (the owner, Nov 2026: "behave
 * like a mobile phone … a fixed number of grids and it's free and easy to be
 * placed within the grids").
 *
 * The screen is a fixed grid of cells — a phone six by six — and each tile
 * has a PLACE in it (per device, `use-dashboard-layout.ts`). Arrange — a long
 * press on any tile, which picks it up in the same gesture; Done in the header
 * or Escape ends it — shows the cells, and a tile is DROPPED on the cell under
 * it (arrow keys move it a cell), or RESIZED by dragging any edge of the tile
 * in hand (Shift + arrows). Tiles it lands on are pushed to the nearest place
 * they fit (`placeTile`), worked out from where they were when the gesture
 * began, so a tile carried past and away goes back; a place that would push a
 * tile off the screen is refused (`placeTileOnScreen`). Empty cells stay empty.
 *
 * - **The DOM never moves.** Every tile stays at its place in the tree and the
 *   grid places it by explicit row and column, so moving remounts nothing (a
 *   tile's face, its lookups, its sheet) and a drag keeps its node.
 * - **Layout animates only while arranging.** A `layout` element is measured
 *   on every render; outside Arrange the tiles are plain grid items.
 * - **The tile that is picked up is a COPY** that follows the finger; its own
 *   slot, faded, shows where it will land.
 */

import * as React from "react"
import { createPortal } from "react-dom"
import { animate, motion, useMotionValue } from "framer-motion"
import { Move } from "lucide-react"
import { GRID_GAP_PX, ROW_FLOOR_PX, arrangeTiles, clampPos, columnsOf, placeTileOnScreen, resizeFrom, rowsOf, rowsUsed, sizeLabel, type GridKind, type TilePos, type TileSize } from "@/lib/utils/dashboard/bento"
import { DASHBOARD_TILES, minColsOf, setArranging, setTilePositions, type DashboardTile } from "@/hooks/use-dashboard-layout"
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

/** Which edge a resize pulls: left / right change the columns, top / bottom the rows. */
type Edge = "l" | "r" | "t" | "b"

/** A tile's resize in progress: where it began, the edge pulled, the layout it began on, and the grid's pitch. */
interface Resize {
  id: DashboardTile
  edge: Edge
  x0: number
  y0: number
  start: TilePos
  base: Record<DashboardTile, TilePos>
  colPitch: number
  rowPitch: number
  grid: GridKind
}

/** A move in progress: the layout it began on, the grid's box and pitch, and the cell last aimed at. */
interface MoveBase {
  base: Record<DashboardTile, TilePos>
  left: number
  top: number
  colPitch: number
  rowPitch: number
  at: string
}

export function BentoGrid({
  grid,
  gridRef,
  rowPx,
  order,
  positions,
  arranging,
  label,
  tile,
  face,
}: {
  /** Six columns (a phone, a narrow panel) or twelve (`gridKindFor` — a desktop's full width). */
  grid: GridKind
  /** The box the tiles have — the page measures it to choose `grid` and the row height. */
  gridRef?: React.Ref<HTMLDivElement>
  /** A row's height, px (`rowHeightFor`): a fixed share of the box, never the content's. */
  rowPx: number
  /** The tiles on show (a standby's airport is not). */
  order: DashboardTile[]
  /** Each tile's place on `grid`. */
  positions: Record<DashboardTile, TilePos>
  arranging: boolean
  label: (id: DashboardTile) => string
  /** The tile as the page shows it, at the size it is placed at. */
  tile: (id: DashboardTile, size: TileSize) => React.ReactNode
  /** Its face alone, for the card that is dragged and the slots while arranging. */
  face: (id: DashboardTile, size: TileSize) => React.ReactNode
}) {
  const columns = columnsOf(grid)
  const gridRows = rowsOf(grid)
  const row = Math.max(ROW_FLOOR_PX, rowPx)
  const placedList = React.useMemo(() => arrangeTiles(order, positions, columns, gridRows), [order, positions, columns, gridRows])
  const placed = React.useMemo(() => {
    const reading = [...placedList].sort((a, b) => a.row - b.row || a.col - b.col)
    const m = new Map<DashboardTile, TilePos & { index: number }>()
    for (const t of placedList) m.set(t.id, { index: reading.indexOf(t), col: t.col, row: t.row, cols: t.cols, rows: t.rows })
    return m
  }, [placedList])
  const totalRows = rowsUsed(placedList, gridRows)
  /** The layout as it stands — what a move or a resize starts from. */
  const layoutNow = React.useCallback(() => {
    const out = { ...positions }
    for (const p of placedList) out[p.id] = { col: p.col, row: p.row, cols: p.cols, rows: p.rows }
    return out
  }, [positions, placedList])
  const layoutRef = React.useRef(layoutNow)
  const orderRef = React.useRef(order)
  React.useEffect(() => {
    layoutRef.current = layoutNow
    orderRef.current = order
  }, [layoutNow, order])

  /** The grid's box on screen and one cell's pitch (a column or a row, and the gap). */
  const pitchOf = (gridEl: HTMLElement) => {
    const g = gridEl.getBoundingClientRect()
    return { left: g.left, top: g.top, colPitch: (g.width - GAP * (columns - 1)) / columns + GAP, rowPitch: row + GAP }
  }

  const [resize, setResize] = React.useState<Resize | null>(null)
  const resizeId = resize?.id ?? null
  React.useEffect(() => {
    if (!resize) return
    let last = ""
    const onMove = (e: PointerEvent) => {
      // An edge pulled OUT grows the tile, pushed IN shrinks it, whichever
      // side it is; the tiles it reaches are pushed aside, from where they
      // were when the resize began.
      const horizontal = resize.edge === "l" || resize.edge === "r"
      const raw = horizontal ? (e.clientX - resize.x0) / resize.colPitch : (e.clientY - resize.y0) / resize.rowPitch
      const out = resize.edge === "l" || resize.edge === "t" ? -raw : raw
      const cols = columnsOf(resize.grid)
      const want = resizeFrom(resize.start, resize.edge, Math.round(out), minColsOf(resize.id, resize.grid), cols, rowsOf(resize.grid))
      const key = `${want.col},${want.row},${want.cols},${want.rows}`
      if (key === last) return
      last = key
      // No room for what it would push: the tile keeps the last size that had.
      const next = placeTileOnScreen(orderRef.current, resize.base, resize.id, want, cols, rowsOf(resize.grid), minColsOf(resize.id, resize.grid))
      if (!next) return
      setTilePositions(next, resize.grid)
      haptic("tick")
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

  const startResize = (e: React.PointerEvent<HTMLElement>, id: DashboardTile, edge: Edge) => {
    e.stopPropagation()
    e.preventDefault()
    const gridEl = e.currentTarget.closest<HTMLElement>("[data-tile-slot]")?.parentElement
    if (!gridEl) return
    const base = layoutRef.current()
    const { colPitch, rowPitch } = pitchOf(gridEl)
    setActive(id)
    setResize({ id, edge, x0: e.clientX, y0: e.clientY, start: base[id], base, colPitch, rowPitch, grid })
    haptic("tick")
  }

  const [drag, setDrag] = React.useState<Drag | null>(null)
  // The tile in hand: its frame and its four edge handles are drawn; the
  // others show only that they can be moved. A tap (or a pick-up) on another
  // takes the handles to it.
  const [activeState, setActive] = React.useState<DashboardTile | null>(null)
  const active = arranging ? activeState : null
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const move = React.useRef<MoveBase | null>(null)

  // Escape ends arranging, as Done does.
  React.useEffect(() => {
    if (!arranging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArranging(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [arranging])

  // The drag follows the pointer on the WINDOW, and the tile's place is the
  // cell its top-left corner is nearest — dropped there, the tiles it covers
  // pushed aside from where they were when it was picked up.
  const dragId = drag && !drag.dropping ? drag.id : null
  React.useEffect(() => {
    if (!dragId || !drag) return
    const { ox, oy } = drag
    const onMove = (e: PointerEvent) => {
      x.set(e.clientX - ox)
      y.set(e.clientY - oy)
      const m = move.current
      if (!m) return
      const start = m.base[dragId]
      const want = clampPos(
        { ...start, col: Math.round((e.clientX - ox - m.left) / m.colPitch), row: Math.round((e.clientY - oy - m.top) / m.rowPitch) },
        1,
        columns,
        gridRows,
      )
      const key = `${want.col},${want.row}`
      if (key === m.at) return
      m.at = key
      // No room on the screen for what it would push: its slot stays where it last could go.
      const next = placeTileOnScreen(orderRef.current, m.base, dragId, want, columns, gridRows, minColsOf(dragId, grid))
      if (!next) return
      setTilePositions(next, grid)
      haptic("tick")
    }
    const onUp = () => {
      move.current = null
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

  /** Where a move starts: the layout as it stands and the grid's box. */
  const beginMove = (slot: HTMLElement, id: DashboardTile) => {
    const gridEl = slot.parentElement
    if (!gridEl) return
    const base = layoutRef.current()
    const p = base[id]
    move.current = { base, ...pitchOf(gridEl), at: `${p.col},${p.row}` }
  }

  // The tile a long press entered Arrange with: picked up where the finger is.
  React.useLayoutEffect(() => {
    if (!arranging) return
    const p = takePending()
    if (!p) return
    const slot = document.querySelector<HTMLElement>(`[data-tile-slot="${p.id}"]`)
    const r = slot?.getBoundingClientRect()
    if (!slot || !r) return
    x.set(r.left)
    y.set(r.top)
    beginMove(slot, p.id)
    // A layout effect with nothing else to read from: the pick-up IS the
    // response to the hold, in the commit that entered Arrange.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrag({ id: p.id, w: r.width, h: r.height, ox: p.x - r.left, oy: p.y - r.top, dropping: false })
    setActive(p.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per entry into Arrange
  }, [arranging, x, y])

  const pickUp = (e: React.PointerEvent<HTMLElement>, id: DashboardTile) => {
    if (e.button !== 0 || drag) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    x.set(r.left)
    y.set(r.top)
    beginMove(e.currentTarget, id)
    setDrag({ id, w: r.width, h: r.height, ox: e.clientX - r.left, oy: e.clientY - r.top, dropping: false })
    setActive(id)
    haptic("tick")
  }

  const onKey = (e: React.KeyboardEvent, id: DashboardTile) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key]
    if (!d) return
    e.preventDefault()
    const base = layoutRef.current()
    const p = base[id]
    // Shift + arrows: the right and bottom edges; arrows alone: a cell.
    const want = e.shiftKey
      ? d[0]
        ? resizeFrom(p, "r", d[0], minColsOf(id, grid), columns, gridRows)
        : resizeFrom(p, "b", d[1], minColsOf(id, grid), columns, gridRows)
      : clampPos({ ...p, col: p.col + d[0], row: p.row + d[1] }, 1, columns, gridRows)
    const next = placeTileOnScreen(order, base, id, want, columns, gridRows, minColsOf(id, grid))
    if (next) setTilePositions(next, grid)
  }

  return (
    <>
      {/* The SCROLLER is a wrapper, not the grid, and it is the BOX the page
          measures: its height is shared out among the grid's rows
          (`rowHeightFor`), so every row is one fixed height and a tile's rows
          are what the pilot chose. Too short for its rows (a phone on its
          side), the rows keep their floor and only the wrapper scrolls. */}
      <div
        ref={gridRef}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide", arranging && "-m-4 p-4")}
        data-bento-scroll
      >
      <div
        // While arranging, the wrapper gains a margin's room on every side
        // (and gives it back as negative margin, so nothing moves) for the
        // move badges that sit ON each tile's corner — inside it they covered
        // the tile's own corner (a weather hazard, the currency tally).
        className="grid content-start gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${totalRows}, ${row}px)` }}
      >
        {/* The CELLS, while arranging — the home screen's grid, so a tile is
            seen to land on one and an empty one is seen to be free. */}
        {arranging &&
          Array.from({ length: totalRows * columns }, (_, i) => (
            <div
              key={`cell-${i}`}
              aria-hidden
              className="pointer-events-none rounded-xl bg-foreground/[0.05]"
              style={{ gridColumn: `${(i % columns) + 1}`, gridRow: `${Math.floor(i / columns) + 1}` }}
            />
          ))}
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
              aria-label={`Move ${label(id)}, ${p.index + 1} of ${order.length}, ${sizeLabel(size)} at column ${p.col + 1}, row ${p.row + 1}. Arrow keys move it, Shift and arrows resize it.`}
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
                  {sizeLabel(size)}
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
            {face(drag.id, placed.get(drag.id) ?? { cols: columns, rows: 1 })}
          </motion.div>,
          document.body,
        )}
    </>
  )
}
