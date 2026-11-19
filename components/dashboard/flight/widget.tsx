"use client"

/**
 * The flight dashboard's WIDGET — a tile that reads at a glance and opens into
 * what is behind it.
 *
 * | Where | A tap |
 * |---|---|
 * | a phone (no panel beside the page) | the tile LIFTS into a card over the page (`WidgetSheet`) — the flight card's context preview, the same card and the same circles under it |
 * | a tablet / desktop | the same card opens in the DETAIL panel beside the page (`w:<id>`), the tile ringed |
 *
 * The expanded card IS the tile: its face stays at the top, as it was, and
 * what the tile had no room for is laid out under a hairline — figures in a
 * grid, short rows, chips — never a title bar, sections or a disclosure. What
 * can be DONE goes in the circles beneath (the preview's action row).
 *
 * The morph is the preview's: laid out ONCE at its resting size, the card
 * TRAVELS from the tile and is REVEALED by a clip that starts as exactly the
 * tile's box and corners — never scaled. A full-width tile keeps its width,
 * so its face is the card's first frame to the pixel; a narrow tile's face
 * sits in the tile's box and gives way to the full-width face as the clip
 * widens.
 */

import * as React from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { useDialogFocus } from "@/hooks/use-dialog-focus"
import { setMenuOpen } from "@/lib/utils/menu-lock"
import { POP_SPRING } from "@/lib/motion"
import { ACTION_LABEL_CLASS, ACTION_TILE_PX, actionTileClass } from "@/components/flight-quick-actions"
import { cn } from "@/lib/utils"

export type WidgetId =
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

/** What a widget can DO — a circle under the card, a capsule in the panel. */
export interface WidgetAction {
  id: string
  label: string
  icon: React.ReactNode
  /** Runs once the card has closed (its history entry gone). */
  run: () => void
  /** Keeps the card open (Refresh). */
  stay?: boolean
  busy?: boolean
}

/** The tile's own corner (`rounded-2xl`) — the card's clip keeps it on every frame. */
const TILE_RADIUS = 16
const OPEN = { type: "spring" as const, duration: 0.42, bounce: 0.1 }
const CLOSE = { type: "spring" as const, duration: 0.32, bounce: 0 }
const EASE = [0.32, 0.72, 0, 1] as const
const SCRIM = "bg-black/45 dark:bg-black/75"
const LIFT_SHADOW = "0px 25px 50px -12px rgba(0,0,0,0.45)"
const MARGIN = 12
const GAP = 14
/** The widest a lifted card goes — a tablet in a phone-sized window stays a card. */
const CARD_MAX_PX = 480

/** A flagged card's edge: its section's worst state, so the card says it at a glance. */
const TONE_BORDER = { fail: "border-destructive/60", caution: "border-chart-4/60" } as const

/**
 * The tile: the face, as a button. `open` rings it while its card is in the
 * panel beside. `controls` sit over its top-right corner, OUTSIDE the button
 * (a button inside a button is not one a keyboard or a screen reader can
 * use) — the flight tile's duty stepper.
 */
export function Widget({
  id,
  label,
  open = false,
  hidden = false,
  tone = null,
  controls,
  onOpen,
  className,
  children,
}: {
  id: WidgetId
  label: string
  open?: boolean
  /** Its card is up: the tile has become the card. */
  hidden?: boolean
  tone?: "fail" | "caution" | "ok" | "unknown" | null
  controls?: React.ReactNode
  onOpen: (id: WidgetId, anchor: WidgetAnchor) => void
  className?: string
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLButtonElement>(null)
  return (
    <div className={cn("relative flex min-w-0", hidden && "invisible", className)}>
      <button
        ref={ref}
        type="button"
        data-widget={id}
        aria-label={`${label}, more`}
        aria-current={open || undefined}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect()
          if (r) onOpen(id, { left: r.left, top: r.top, width: r.width, height: r.height })
        }}
        className={cn(
          "relative flex min-w-0 flex-1 flex-col justify-start overflow-hidden rounded-2xl border border-border bg-card p-3 text-left",
          "transition-[box-shadow,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          (tone === "fail" || tone === "caution") && TONE_BORDER[tone],
          open && "ring-2 ring-inset ring-foreground/25",
        )}
      >
        {children}
      </button>
      {controls && <div className="absolute right-1.5 top-1.5">{controls}</div>}
    </div>
  )
}

/** A tile's small heading, with what it says at a glance on the right. */
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
 * The card, as the panel beside a tablet's page shows it: the face, the body
 * under a hairline, the actions as capsules beneath.
 */
export function WidgetCard({ face, body }: { face: React.ReactNode | null; body: React.ReactNode | null }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {face && <div className="relative p-3 pb-2">{face}</div>}
      {body && <div className={cn("px-3 pb-3 pt-2.5", face && "border-t border-border/70")}>{body}</div>}
    </div>
  )
}

/**
 * A widget lifted out of the page on a phone. Closes on the scrim, Escape and
 * the back gesture — back INTO its tile, the same morph run backwards. An
 * action runs as the close's follow-up, so a navigation is not undone by the
 * card's own history entry.
 */
export function WidgetSheet({
  anchor,
  title,
  face,
  header,
  body,
  actions,
  onClose,
}: {
  anchor: WidgetAnchor
  title: string
  /** The tile's face: the card's first frame. */
  face: React.ReactNode
  /** The card's own header: the face again, or only the tile's label. */
  header: React.ReactNode
  body: React.ReactNode | null
  actions: WidgetAction[]
  onClose: () => void
}) {
  const closeRef = React.useRef(onClose)
  React.useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  const dialogRef = React.useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, true)
  const scrimPressRef = React.useRef(false)

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
    window.setTimeout(finishClose, 520)
  }, [finishClose])
  const requestClose = useBackDismiss(true, startClose)

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
  // A full-width tile keeps its width (its face is the first frame, to the
  // pixel); a narrow one opens to the width a full-width tile has.
  const fullWidth = Math.min(vw - MARGIN * 2, CARD_MAX_PX)
  const wide = anchor.width >= fullWidth - 24
  const width = wide ? anchor.width : fullWidth
  const actionsH = actions.length ? GAP + ACTION_TILE_PX : 0
  const maxCard = vh - MARGIN * 2 - 24 - actionsH
  const restH = Math.min(height ?? anchor.height, maxCard)
  const restLeft = wide ? anchor.left : (vw - width) / 2
  const restTop = Math.max(MARGIN + 12, (vh - (restH + actionsH)) / 2)
  // The card is PLACED on the tile and travels to its resting place. Placed at
  // rest and offset back by (tile − rest), its start moved with every change of
  // the rest — and the rest is known only once the card's height is: a tall
  // card's rest is near the top, so it was drawn from there ("appearing from
  // the top") instead of from its own tile.
  const toX = restLeft - anchor.left
  const toY = restTop - anchor.top
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
          style={{ left: anchor.left, top: anchor.top, width }}
          initial={{ x: 0, y: 0 }}
          animate={open ? { x: toX, y: toY } : { x: 0, y: 0 }}
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
            className="relative overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card"
            style={{ maxHeight: maxCard }}
            initial={{ clipPath: tileClip }}
            animate={{ clipPath: open ? fullClip : tileClip }}
            transition={t}
          >
            {/* The face — the tile's own, as the card's header. A narrow
                tile's re-flows to the card's width, so it arrives a beat
                after the copy of the tile below has covered the first frame. */}
            <motion.div
              className="relative p-3"
              initial={{ opacity: wide && header === face ? 1 : 0 }}
              animate={{ opacity: (wide && header === face) || open || closing ? 1 : 0 }}
              transition={{ duration: 0.18, delay: wide && header === face ? 0 : 0.06, ease: EASE }}
            >
              {header}
            </motion.div>
            {body && (
              <motion.div
                className="border-t border-border/70 px-3 pb-3 pt-2.5"
                initial={{ opacity: 0, y: -6 }}
                animate={open || closing ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.3, delay: 0.08, ease: EASE }}
              >
                {body}
              </motion.div>
            )}
            {(!wide || header !== face) && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 overflow-hidden bg-card p-3"
                style={{ width: anchor.width, height: anchor.height, borderRadius: TILE_RADIUS }}
                initial={{ opacity: 1 }}
                animate={{ opacity: open ? 0 : 1 }}
                transition={open ? { duration: 0.16, ease: EASE } : { duration: 0.12, ease: EASE }}
              >
                {face}
              </motion.div>
            )}
          </motion.div>
        </motion.div>

        {/* What can be done — the preview's circles, under the card's resting
            place. Each fades itself (a fading ancestor would be a backdrop root). */}
        {actions.length > 0 && (
          <div
            className="pointer-events-auto fixed inset-x-0 flex items-start justify-center gap-2"
            style={{ top: restTop + restH + GAP, visibility: height === null ? "hidden" : undefined }}
          >
            {actions.map((a, i) => (
              <motion.button
                key={a.id}
                type="button"
                onClick={() => (a.stay ? a.run() : requestClose(a.run))}
                aria-label={a.label}
                aria-busy={a.busy || undefined}
                tabIndex={open ? 0 : -1}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={open ? { scale: 1, opacity: 1 } : { scale: 0.85, opacity: 0 }}
                transition={open ? { ...POP_SPRING, delay: 0.12 + i * 0.03 } : { duration: 0.1, ease: "easeOut" }}
                style={{ width: ACTION_TILE_PX, height: ACTION_TILE_PX, touchAction: "manipulation" }}
                className={actionTileClass}
              >
                {a.icon}
                <span className={cn(ACTION_LABEL_CLASS, "max-w-[56px] truncate")}>{a.label}</span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
