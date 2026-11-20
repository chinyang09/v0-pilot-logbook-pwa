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
 * The card GROWS OUT OF the tile: one surface runs from the tile's box to the
 * card's, revealing a card laid out once at its final size (`WidgetSheet`).
 * A card scaled down onto the tile (the round before) read as a thumbnail
 * growing, not as the tile opening.
 */

import * as React from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { useDialogFocus } from "@/hooks/use-dialog-focus"
import { setMenuOpen } from "@/lib/utils/menu-lock"
import { runSharedMorph } from "./shared-morph"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type WidgetId =
  | "duty"
  | "flight"
  | "weather"
  | "destination"
  | "currency"
  | "limits"

export interface WidgetAnchor {
  left: number
  top: number
  width: number
  height: number
}

// No overshoot, either way (the owner: the travelling contents "wobble before
// settling"). A bounce on the surface carried everything on it past its
// place and back, and the shared copies, on a spring of their own, overshot
// again on top of it. One eased curve, the same for the surface and the
// copies, lands them together and still.
const EASE = [0.32, 0.72, 0, 1] as const
const OPEN = { type: "tween" as const, duration: 0.4, ease: EASE }
const CLOSE = { type: "tween" as const, duration: 0.32, ease: EASE }
const SCRIM = "bg-black/45 dark:bg-black/75"
const LIFT_SHADOW = "0px 25px 50px -12px rgba(0,0,0,0.45)"
const NO_SHADOW = "0px 0px 0px 0px rgba(0,0,0,0)"
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
      <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground" data-morph="label">
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
 * A widget lifted out of the page on a phone — it GROWS OUT OF its tile and
 * goes back into it (the owner, Nov 2026: the scaled card "doesn't look like
 * it expands from the widget").
 *
 * One SURFACE — the tile's own card, its border and corners — runs from the
 * tile's box to the card's box and back. What is on it is laid out ONCE at
 * its final size and anchored to the surface's top-left, so the growing
 * surface reveals it rather than stretching it:
 *
 * | the tile | its card | on the surface |
 * |---|---|---|
 * | full width, the card keeps its face | the same width | the card itself from the first frame: its header IS the tile's face, in the same place — the tile simply opens downward |
 * | narrower, or a card led by its label | the full width | the tile's face (at the tile's width) fades into the card as the surface widens |
 *
 * The tile is hidden for the card's whole life — the surface covers it
 * exactly at both ends — so there is never a second copy and never a step.
 * Anything inside that goes somewhere closes the card first and runs as the
 * close's follow-up, so the card never stays over the page it led to.
 */
export function WidgetSheet({
  anchor,
  title,
  face,
  seamless,
  tone = null,
  render,
  onClose,
}: {
  anchor: WidgetAnchor
  title: string
  /** The tile's face, as the tile draws it — what the surface shows at the tile's size. */
  face: React.ReactNode
  /** The card's header is this face at this width: no crossfade, the tile just opens. */
  seamless: boolean
  tone?: "fail" | "caution" | "ok" | "unknown" | null
  /** The card's content, handed `dismiss(then?)` for anything that leaves it. */
  render: (dismiss: (then?: () => void) => void) => SheetContent
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
  // Closing because something in the card LEADS somewhere: the card fades
  // where it is while the next page appears under it, rather than shrinking
  // back onto a tile that is no longer on screen.
  const [leaving, setLeaving] = React.useState(false)
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
    window.setTimeout(finishClose, 650)
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

  // Shared elements fly between the tile's face and the card, on the open and
  // on a close back onto the tile (`runSharedMorph`).
  const faceRef = React.useRef<HTMLDivElement>(null)
  const flyRef = React.useRef<HTMLDivElement>(null)
  const measuredNow = height !== null
  React.useLayoutEffect(() => {
    if (!measuredNow || leaving) return
    const face = faceRef.current
    const card = cardRef.current
    const layer = flyRef.current
    if (!face || !card || !layer) return
    const run = runSharedMorph({
      face,
      card,
      layer,
      opening: !closing,
      move: closing ? CLOSE : OPEN,
      fade: closing ? { duration: 0.24, ease: EASE } : { duration: 0.26, ease: EASE },
    })
    return run.cancel
  }, [measuredNow, closing, leaving])

  const dismissCard = React.useCallback(
    (then?: () => void) => {
      if (then) setLeaving(true)
      requestClose(then)
    },
    [requestClose],
  )

  if (typeof document === "undefined") return null

  const content = render(dismissCard)
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
  // The content's height, plus the surface's two border pixels.
  const restH = Math.min((height ?? anchor.height) + 2, maxCard)
  const rest = {
    left: wide ? anchor.left : (vw - width) / 2,
    top: Math.max(MARGIN + 12, (vh - restH) / 2),
    width,
    height: restH,
  }
  const onTile = { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }
  const crossfade = !(seamless && wide)
  const t = closing ? CLOSE : OPEN
  const LEAVE = { duration: 0.2, ease: EASE }

  return createPortal(
    // Leaving, it takes no taps: the page it led to is already under it.
    <div className={cn("fixed inset-0 z-[210]", leaving && "pointer-events-none")}>
      <motion.div
        className={cn("absolute inset-0", SCRIM)}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: closing ? 0.24 : 0.26, ease: EASE }}
        onPointerDown={() => {
          scrimPressRef.current = true
        }}
        onClick={() => {
          if (scrimPressRef.current) requestClose()
          scrimPressRef.current = false
        }}
      />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className="pointer-events-none absolute inset-0">
        {/* The surface: the tile's card, growing to the card's box. */}
        <motion.div
          className={cn(
            "fixed overflow-hidden rounded-2xl border bg-card",
            leaving ? "pointer-events-none" : "pointer-events-auto",
            (tone === "fail" || tone === "caution") && !open ? TONE_BORDER[tone] : "border-border",
          )}
          initial={{ ...onTile, boxShadow: NO_SHADOW, scale: 1 }}
          animate={
            leaving
              ? { ...rest, boxShadow: LIFT_SHADOW, scale: 0.97 }
              : open
                ? { ...rest, boxShadow: LIFT_SHADOW, scale: 1 }
                : { ...onTile, boxShadow: NO_SHADOW, scale: 1 }
          }
          // Leaving fades on the compositor: the card goes where it is while
          // the next page comes up under it.
          style={leaving ? { opacity: 0, transition: "opacity 200ms cubic-bezier(0.32, 0.72, 0, 1)" } : undefined}
          transition={leaving ? LEAVE : t}
          onAnimationComplete={() => {
            if (closingRef.current) finishClose()
          }}
        >
          {/* The tile's face at the tile's size, fading into the card. */}
          {crossfade && (
            <motion.div
              ref={faceRef}
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 flex flex-col p-3"
              style={{ width: anchor.width - 2, height: anchor.height - 2 }}
              initial={{ opacity: 1 }}
              // Leaving: the card stays as it is and the surface fades whole.
              animate={{ opacity: open || leaving ? 0 : 1 }}
              transition={open ? { duration: 0.14, ease: EASE } : { duration: 0.18, delay: 0.08, ease: EASE }}
            >
              {face}
            </motion.div>
          )}
          {/* The card, laid out once at its final width; the surface reveals it. */}
          <motion.div
            ref={cardRef}
            className="absolute left-0 top-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide"
            style={{ width: width - 2, maxHeight: maxCard - 2 }}
            initial={{ opacity: crossfade ? 0 : 1 }}
            animate={{ opacity: crossfade ? (open || leaving ? 1 : 0) : 1 }}
            transition={open ? { duration: 0.2, delay: 0.06, ease: EASE } : { duration: 0.12, ease: EASE }}
          >
            <div className="relative p-3">{content.header}</div>
            {content.body && <div className="border-t border-border/70 px-3 pb-3 pt-2.5">{content.body}</div>}
            {/* A footer action that leads somewhere is already wrapped to close
                the card first (`render`'s dismiss) — closing it again here
                swallowed the navigation (the owner's report). */}
            <WidgetFooter actions={content.actions} run={(a) => a.run()} />
          </motion.div>
          {/* The shared elements' copies, in flight. */}
          <div ref={flyRef} aria-hidden className="pointer-events-none absolute inset-0" />
        </motion.div>
      </div>
    </div>,
    document.body,
  )
}
