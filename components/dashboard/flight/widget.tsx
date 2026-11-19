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
 * can be done is ONE quiet footer line (Refresh, the section it summarises) —
 * not circles under the card (the owner: "don't have to fully copy the flight
 * card").
 *
 * The morph is TRANSFORM and OPACITY only (the owner: "less janky"). The card
 * is laid out once at its resting size and measured while hidden; then it
 * starts ON the tile — moved there and scaled to the tile's width — and
 * travels to rest. Closing runs it back onto the tile, which is shown again
 * the moment the close begins, so the card fades into the tile rather than
 * vanishing and leaving a hole (the clip it replaced animated on the main
 * thread every frame, and a narrow tile closed in two steps: the clip, then
 * the tile's own height coming back).
 */

import * as React from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { useDialogFocus } from "@/hooks/use-dialog-focus"
import { setMenuOpen } from "@/lib/utils/menu-lock"
import { ChevronRight } from "lucide-react"
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

const OPEN = { type: "spring" as const, duration: 0.38, bounce: 0.08 }
const CLOSE = { type: "spring" as const, duration: 0.3, bounce: 0 }
const EASE = [0.32, 0.72, 0, 1] as const
const SCRIM = "bg-black/45 dark:bg-black/75"
const LIFT_SHADOW = "0px 25px 50px -12px rgba(0,0,0,0.45)"
const MARGIN = 12
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
  controlsClassName = "right-1.5 top-1.5",
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
  /** Where the controls sit over the tile. */
  controlsClassName?: string
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
      {controls && <div className={cn("absolute", controlsClassName)}>{controls}</div>}
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

/** What a widget can DO — one quiet line under the card. */
export interface WidgetAction {
  id: string
  label: string
  icon?: React.ReactNode
  /** Runs once the card has closed (its history entry gone). */
  run: () => void
  /** Keeps the card open (Refresh). */
  stay?: boolean
  busy?: boolean
}

/** The footer line: each action a text button, the section link last with a chevron. */
function WidgetFooter({ actions, run }: { actions: WidgetAction[]; run: (a: WidgetAction) => void }) {
  if (actions.length === 0) return null
  return (
    <div className="flex items-center justify-end gap-1 border-t border-border/70 px-1.5 py-1">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => run(a)}
          aria-busy={a.busy || undefined}
          className="flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-primary transition-colors active:bg-muted/60"
        >
          {a.icon}
          {a.label}
          {!a.stay && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        </button>
      ))}
    </div>
  )
}

/**
 * The card, as the panel beside a tablet's page shows it: the face, the body
 * under a hairline, the footer line beneath.
 */
export function WidgetCard({
  face,
  body,
  actions = [],
}: {
  face: React.ReactNode | null
  body: React.ReactNode | null
  actions?: WidgetAction[]
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {face && <div className="relative p-3 pb-2">{face}</div>}
      {body && <div className={cn("px-3 pb-3 pt-2.5", face && "border-t border-border/70")}>{body}</div>}
      <WidgetFooter actions={actions} run={(a) => a.run()} />
    </div>
  )
}

/** What the sheet draws, given the way to close it first (an action runs as the close's follow-up). */
export interface SheetContent {
  header: React.ReactNode
  body: React.ReactNode | null
  actions: WidgetAction[]
}

/**
 * A widget lifted out of the page on a phone. Closes on the scrim, Escape and
 * the back gesture — back ONTO its tile. Anything inside that goes somewhere
 * (a crew member, a currency, a flight, a footer link) closes the card first
 * and runs as the close's follow-up, so the card never stays over the page it
 * led to and a navigation is not undone by the card's own history entry.
 */
export function WidgetSheet({
  anchor,
  title,
  render,
  onOpened,
  onClosing,
  onClose,
}: {
  anchor: WidgetAnchor
  title: string
  /** The card's content, handed `dismiss(then?)` for anything that leaves it. */
  render: (dismiss: (then?: () => void) => void) => SheetContent
  /** The card has arrived: the tile can make way (it is under the card until then). */
  onOpened: () => void
  /** The close has begun: the tile shows again under the card. */
  onClosing: () => void
  onClose: () => void
}) {
  const closeRef = React.useRef(onClose)
  const closingCbRef = React.useRef(onClosing)
  const openedRef = React.useRef(onOpened)
  React.useEffect(() => {
    closeRef.current = onClose
    closingCbRef.current = onClosing
    openedRef.current = onOpened
  }, [onClose, onClosing, onOpened])

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
    closingCbRef.current()
    window.setTimeout(finishClose, 420)
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

  const content = render((then) => requestClose(then))
  const measured = height !== null
  const open = measured && !closing
  const vw = window.innerWidth
  const vh = window.innerHeight
  // A full-width tile keeps its width; a narrow one opens to the width a
  // full-width tile has.
  const fullWidth = Math.min(vw - MARGIN * 2, CARD_MAX_PX)
  const wide = anchor.width >= fullWidth - 24
  const width = wide ? anchor.width : fullWidth
  const maxCard = vh - MARGIN * 2 - 24
  const restH = Math.min(height ?? anchor.height, maxCard)
  const restLeft = wide ? anchor.left : (vw - width) / 2
  const restTop = Math.max(MARGIN + 12, (vh - restH) / 2)
  // ON the tile: moved to its corner and scaled to its width (top-left origin).
  const onTile = { x: anchor.left - restLeft, y: anchor.top - restTop, scale: anchor.width / width }
  const t = closing ? CLOSE : OPEN

  return createPortal(
    <div className="fixed inset-0 z-[210]">
      <motion.div
        className={cn("absolute inset-0", SCRIM)}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: closing ? 0.22 : 0.26, ease: EASE }}
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
          ref={cardRef}
          className="pointer-events-auto fixed origin-top-left overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-border bg-card scrollbar-hide"
          // Measured hidden first: the rest is known only once the height is.
          style={{
            left: restLeft,
            top: restTop,
            width,
            maxHeight: maxCard,
            visibility: measured ? undefined : "hidden",
            boxShadow: LIFT_SHADOW,
          }}
          initial={{ ...onTile, opacity: 0 }}
          animate={open ? { x: 0, y: 0, scale: 1, opacity: 1 } : { ...onTile, opacity: 0 }}
          transition={{
            ...t,
            opacity: closing
              ? { duration: 0.2, delay: 0.1, ease: EASE }
              : { duration: 0.12, ease: EASE },
          }}
          onAnimationComplete={() => {
            if (closingRef.current) finishClose()
            else if (measured) openedRef.current()
          }}
        >
          <div className="relative p-3">{content.header}</div>
          {content.body && <div className="border-t border-border/70 px-3 pb-3 pt-2.5">{content.body}</div>}
          <WidgetFooter actions={content.actions} run={(a) => (a.stay ? a.run() : requestClose(a.run))} />
        </motion.div>
      </div>
    </div>,
    document.body,
  )
}
