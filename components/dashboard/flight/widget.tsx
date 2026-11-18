"use client"

/**
 * The flight dashboard's WIDGET — a tile that reads at a glance and opens into
 * everything behind it.
 *
 * | Where | A tap |
 * |---|---|
 * | a phone (no panel beside the page) | the tile GROWS into a sheet over the page (`WidgetSheet`), the flight card's context-preview morph |
 * | a tablet / desktop | its detail opens in the DETAIL panel beside the page (`w:<id>`), the tile ringed |
 *
 * The sheet is the context preview's technique (`flight-context-preview.tsx`):
 * laid out ONCE at its resting size, it TRAVELS from the tile and is REVEALED
 * by a clip that starts as exactly the tile's box and corners — never scaled.
 * A copy of the tile's face sits in that box and fades as the detail rises,
 * so the first frame IS the tile, and the tile becomes the sheet.
 */

import * as React from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { useDialogFocus } from "@/hooks/use-dialog-focus"
import { setMenuOpen } from "@/lib/utils/menu-lock"
import { cn } from "@/lib/utils"

export type WidgetId =
  | "status"
  | "duty"
  | "flight"
  | "weather"
  | "crew"
  | "destination"
  | "currency"
  | "limits"

export interface WidgetAnchor {
  left: number
  top: number
  width: number
  height: number
}

/** The tile's own corner (`rounded-2xl`) — the sheet's clip keeps it on every frame. */
const TILE_RADIUS = 16
const OPEN = { type: "spring" as const, duration: 0.42, bounce: 0.1 }
const CLOSE = { type: "spring" as const, duration: 0.32, bounce: 0 }
const EASE = [0.32, 0.72, 0, 1] as const
const SCRIM = "bg-black/45 dark:bg-black/75"
const LIFT_SHADOW = "0px 25px 50px -12px rgba(0,0,0,0.45)"
/** The sheet's widest, so a tablet in a phone-sized window still reads as a card. */
const SHEET_MAX_PX = 480

/** The tile: the face, as a button. `open` rings it while its detail is in the panel beside. */
export function Widget({
  id,
  label,
  open = false,
  hidden = false,
  onOpen,
  className,
  children,
}: {
  id: WidgetId
  /** What the tile is, for a screen reader ("Weather, open details"). */
  label: string
  open?: boolean
  /** Its sheet is up: the tile has become the sheet. */
  hidden?: boolean
  onOpen: (id: WidgetId, anchor: WidgetAnchor) => void
  className?: string
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      data-widget={id}
      aria-label={`${label}, open details`}
      aria-current={open || undefined}
      onClick={() => {
        const r = ref.current?.getBoundingClientRect()
        if (r) onOpen(id, { left: r.left, top: r.top, width: r.width, height: r.height })
      }}
      className={cn(
        "relative flex min-w-0 flex-col justify-start overflow-hidden rounded-2xl border border-border bg-card p-3 text-left",
        "transition-[box-shadow,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open && "ring-2 ring-inset ring-foreground/25",
        hidden && "invisible",
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A tile's small heading — the same words a sheet and the panel title it with. */
export function WidgetLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {children}
      </span>
      {right}
    </div>
  )
}

/**
 * A widget's detail, grown out of its tile, over a phone's page. Closes on the
 * scrim, the close button, Escape and the back gesture — and goes back INTO
 * its tile, the same morph run backwards.
 */
export function WidgetSheet({
  anchor,
  title,
  face,
  onClose,
  children,
}: {
  anchor: WidgetAnchor
  title: string
  /** The tile's face, drawn in the tile's box on the first frame. */
  face: React.ReactNode
  onClose: () => void
  /** The body; `close(then)` closes the sheet and runs `then` once its history entry is gone. */
  children: (close: (then?: () => void) => void) => React.ReactNode
}) {
  const closeRef = React.useRef(onClose)
  React.useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  const dialogRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, true)
  const scrimPressRef = React.useRef(false)

  // The sheet's height, read by a ResizeObserver once laid out (never mid-commit).
  const cardRef = React.useRef<HTMLDivElement>(null)
  const [height, setHeight] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height
      setHeight((prev) => (prev !== null && Math.abs(prev - h) < 0.5 ? prev : h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [closing, setClosing] = React.useState(false)
  const closingRef = React.useRef(false)
  const finishClose = React.useCallback(() => {
    if (!closingRef.current) return
    closingRef.current = false
    closeRef.current()
  }, [])
  const startClose = React.useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    // A safety net: the sheet landing on its tile (onAnimationComplete) unmounts it.
    window.setTimeout(finishClose, 520)
  }, [finishClose])
  const requestClose = useBackDismiss(true, startClose)

  // Nothing behind the sheet is a hit-test target while it is up.
  React.useEffect(() => {
    setMenuOpen(true)
    return () => setMenuOpen(false)
  }, [])
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [requestClose])

  if (typeof document === "undefined") return null

  const open = height !== null && !closing
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 16
  const width = Math.min(vw - margin * 2, SHEET_MAX_PX)
  const maxH = vh - margin * 2 - 32
  const restH = Math.min(height ?? anchor.height, maxH)
  const restLeft = (vw - width) / 2
  const restTop = Math.max(margin + 16, (vh - restH) / 2)
  // Where the tile is, against the sheet's resting corner: the sheet starts
  // there, clipped to the tile's box, and travels home as the clip opens.
  const dx = anchor.left - restLeft
  const dy = anchor.top - restTop
  const tileClip = `inset(0px calc(100% - ${anchor.width}px) calc(100% - ${anchor.height}px) 0px round ${TILE_RADIUS}px)`
  const fullClip = `inset(0px calc(0% - 0px) calc(0% - 0px) 0px round ${TILE_RADIUS}px)`
  const t = closing ? CLOSE : OPEN

  return createPortal(
    <div className="fixed inset-0 z-[210]">
      <motion.div
        className={cn("absolute inset-0", SCRIM)}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: closing ? 0.24 : 0.3, ease: EASE }}
        onPointerDown={() => {
          scrimPressRef.current = true
        }}
        onClick={() => {
          if (scrimPressRef.current) requestClose()
          scrimPressRef.current = false
        }}
      />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className="pointer-events-none absolute inset-0">
        <motion.div
          className="pointer-events-auto fixed"
          style={{ left: restLeft, top: restTop, width }}
          initial={{ x: dx, y: dy }}
          animate={open ? { x: 0, y: 0 } : { x: dx, y: dy }}
          transition={t}
          onAnimationComplete={() => {
            if (closingRef.current) finishClose()
          }}
        >
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: LIFT_SHADOW, borderRadius: TILE_RADIUS, height: restH }}
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={open ? { duration: 0.2, delay: 0.16, ease: EASE } : { duration: 0.08 }}
          />
          <motion.div
            ref={cardRef}
            className="relative flex flex-col overflow-hidden border border-border bg-background"
            style={{ borderRadius: TILE_RADIUS, maxHeight: maxH }}
            initial={{ clipPath: tileClip }}
            animate={{ clipPath: open ? fullClip : tileClip }}
            transition={t}
          >
            <motion.div
              className="flex min-h-0 flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: open || closing ? 1 : 0 }}
              transition={{ duration: 0.22, delay: open ? 0.08 : 0, ease: EASE }}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-3">
                <h2 className="truncate text-[17px] font-semibold text-foreground">{title}</h2>
                <button
                  type="button"
                  onClick={() => requestClose()}
                  aria-label="Close"
                  className="control-surface relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full after:absolute after:-inset-1.5 after:content-['']"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3 pt-2">{children(requestClose)}</div>
            </motion.div>

            {/* The tile's face, in the tile's box: the first frame of the open
                and the last of the close. */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 overflow-hidden bg-card p-3"
              style={{ width: anchor.width, height: anchor.height, borderRadius: TILE_RADIUS }}
              initial={{ opacity: 1 }}
              animate={{ opacity: open ? 0 : 1 }}
              // Back over the box at once on the close: the clip is closing
              // onto it, and the detail must not show through a fading face.
              transition={open ? { duration: 0.16, ease: EASE } : { duration: 0.12, ease: EASE }}
            >
              {face}
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </div>,
    document.body,
  )
}
