"use client"

import type React from "react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "framer-motion"
import { cn } from "@/lib/utils"
import { SPRING, POP_SPRING } from "@/lib/motion"
import { CountdownConfirmButton } from "@/components/ui/countdown-confirm-button"
import {
  armPendingAction,
  cancelPendingAction,
  getPendingDeadline,
  subscribePendingActions,
} from "@/lib/utils/pending-actions"
import { HoldProgressBorder } from "@/components/ui/hold-progress-border"
import { useMenuOpen } from "@/lib/utils/menu-lock"

const SWIPE_CLOSE_EVENT = "swipe-card-close-others"

/** Width of each revealed action button (px) */
const BUTTON_WIDTH = 64
/** Gap between adjacent action buttons (px, matches gap-2) */
const GAP = 8
/** Gap between the card and the buttons, on the leading (left) side only —
 *  the trailing button sits flush with the card's right edge. */
const PANEL_PAD = 8
/** Elastic resistance once dragged past the natural open position */
const DRAG_ELASTIC = 0.14

export interface SwipeAction {
  label?: string
  /**
   * Accessible name for an icon-only action (no visible text). Delete/logout and
   * similar destructive actions are icon-only app-wide; this keeps them labelled
   * for screen readers.
   */
  ariaLabel?: string
  /** Optional — actions may be label-only (e.g. "Clear") */
  icon?: React.ReactNode
  onClick: () => void
  variant?: "default" | "destructive" | "secondary"
  className?: string
  disabled?: boolean
  /**
   * When true the action is not fired on a tap. Instead, tapping closes the
   * action panel and raises a confirm overlay over the row: the action is now
   * COUNTING DOWN, and the button cancels it. Left alone, it fires when the
   * countdown ends. Used for destructive actions in place of a dialog.
   *
   * (Previously a press-and-hold. Holding asked the person who wanted the
   * outcome to work for it and gave the person who mis-tapped nothing to grab.)
   */
  holdToConfirm?: boolean
  /** Countdown in ms before the action fires (default 10000). */
  holdDuration?: number
  /** Verb shown on the cancel button, e.g. "Cancel delete". */
  cancelLabel?: string
}

interface SwipeableCardProps {
  children: React.ReactNode
  actions?: SwipeAction[]
  onClick?: () => void
  /** Class applied to the moving content wrapper */
  className?: string
  /** Class applied to the outer container */
  containerClassName?: string
  disabled?: boolean
  id?: string
  /**
   * "card" (default) — standalone rounded card with its own background.
   * "row" — inline divider row inside a grouped section card. On swipe the row
   * morphs into a rounded, lifted card and (when {@link separated}) its divider
   * line fades out.
   */
  variant?: "card" | "row"
  /**
   * Row variant only — render a bottom divider that disappears as the row morphs
   * into a card on swipe. Use for grouped list/detail rows.
   */
  separated?: boolean
  /**
   * Pointer hooks on the OUTER container, for a consumer that wants a gesture
   * of its own on top of the swipe — the flight card's press-and-hold menu.
   * They are listeners, not handlers: the swipe still owns the drag, and the
   * consumer is expected to give up on any movement (see the flight list).
   */
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  onPointerCancel?: (e: React.PointerEvent) => void
}

function variantClasses(variant?: SwipeAction["variant"]): string {
  return cn(
    variant === "destructive" && "bg-destructive text-destructive-foreground",
    variant === "secondary" && "bg-secondary text-foreground",
    (!variant || variant === "default") && "bg-muted text-muted-foreground"
  )
}

/**
 * A single revealed action button that scales/pops in (with spring) as the card
 * is dragged open, staggered by its position. Rests at opacity 0 when closed so
 * nothing peeks at the card's edge. A tap fires the action (or, for a
 * hold-to-confirm action, asks the parent to show the confirm overlay).
 */
function SwipeActionButton({
  action,
  x,
  startX,
  endX,
  onClose,
  onRequestConfirm,
}: {
  action: SwipeAction
  x: MotionValue<number>
  startX: number
  endX: number
  onClose: () => void
  onRequestConfirm: (action: SwipeAction) => void
}) {
  // 0 (hidden) → 1 (fully revealed) across this button's stagger window.
  const reveal = useTransform(x, [endX, startX], [1, 0], { clamp: true })
  const scale = useSpring(useTransform(reveal, [0, 1], [0.4, 1]), POP_SPRING)
  const opacity = useSpring(reveal, POP_SPRING)

  return (
    <motion.button
      type="button"
      aria-label={action.ariaLabel ?? action.label}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation()
        if (action.disabled) return
        // Confirm actions don't fire on tap — they hand off to an overlay
        // where the action counts down and the button cancels it.
        if (action.holdToConfirm) {
          onRequestConfirm(action)
          return
        }
        action.onClick()
        onClose()
      }}
      disabled={action.disabled}
      style={{ scale, opacity, width: BUTTON_WIDTH, touchAction: "manipulation" }}
      className={cn(
        "shrink-0 self-stretch flex flex-col items-center justify-center gap-0.5",
        "rounded-lg overflow-hidden disabled:opacity-50 select-none",
        variantClasses(action.variant),
        action.className
      )}
    >
      {action.icon}
      {action.label && (
        <span className="text-xs font-medium leading-none">{action.label}</span>
      )}
    </motion.button>
  )
}

/**
 * A reusable swipe-to-reveal row.
 *
 * Actions are anchored to the trailing edge as separate, rounded buttons that
 * pop in with spring physics (Wear OS M2.5 / iOS feel) and fill the row height.
 * On swipe a "row" variant morphs into a rounded, lifted card and its divider
 * fades out. Release settles with a spring. Vertical gestures are ignored via
 * direction locking so the list keeps scrolling cleanly.
 */
export function SwipeableCard({
  children,
  actions = [],
  onClick,
  className,
  containerClassName,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  disabled = false,
  id,
  variant = "card",
  separated = false,
}: SwipeableCardProps) {
  // Identity for close-others coordination AND for the pending-action registry.
  //
  // Pass a `id` derived from the row's data wherever a row can be armed: the
  // fallback `useId()` changes when a virtualised list recycles the component,
  // which orphans the registry entry and loses the overlay mid-countdown.
  const autoId = useId()
  const cardId = useRef(id || autoId)
  const containerRef = useRef<HTMLDivElement>(null)
  const isCard = variant === "card"

  const hasActions = actions.length > 0 && !disabled
  const menuOpen = useMenuOpen()
  const count = actions.length
  const trailingIndex = count - 1
  const openWidth =
    count > 0 ? count * BUTTON_WIDTH + (count - 1) * GAP + PANEL_PAD : 0

  // x drives the card translation; the panel width derives from it so the
  // buttons are revealed out of the trailing edge as you swipe.
  const x = useMotionValue(0)
  const panelWidth = useTransform(x, (v) => Math.max(0, -v))
  // True while the row is swiped open or mid-gesture (drives the card morph).
  const [active, setActive] = useState(false)

  // When a hold-to-confirm action is tapped, the panel closes and this confirm
  // overlay covers the row: the content behind desaturates ("the past"), a red
  // tint fills in lock-step with the hold, and a centred pill must be held to
  // fire the action. `confirmProgress` mirrors the button's hold 0→1 so the tint
  // fills together with it.
  const [confirmingAction, setConfirmingAction] = useState<SwipeAction | null>(null)
  // Epoch ms the armed action fires at. Owned by the pending-actions registry
  // so it outlives this component.
  const [pendingDeadline, setPendingDeadline] = useState<number | undefined>(undefined)
  const confirmProgress = useMotionValue(0)

  // Tracks whether the last pointer interaction actually moved (drag vs tap).
  const movedRef = useRef(false)

  const settle = useCallback(
    (target: number, velocity = 0) => {
      if (target !== 0) setActive(true)
      animate(x, target, {
        ...SPRING,
        velocity,
        onComplete: () => {
          if (target === 0) setActive(false)
        },
      })
    },
    [x]
  )

  const close = useCallback(() => settle(0), [settle])

  // A hold that opens a menu is not a drag — but the finger always drifts a
  // few px over 480ms, and framer starts panning at ~3px, well under the 8px
  // that cancels the hold. So by the time the menu appears the card has
  // usually already moved a little, and the pointercancel that ends the
  // session springs it back: the "jiggle". This puts it back at rest with no
  // animation instead, in the same commit the menu opens.
  useEffect(() => {
    if (!menuOpen) return
    x.stop()
    x.set(0)
  }, [menuOpen, x])

  // Close this card's SWIPE PANEL when another card opens or is tapped.
  //
  // It must not touch a pending confirm: this event fires on any interaction
  // with any other row, so clearing `confirmingAction` here made it impossible
  // to arm a delete and carry on — the overlay vanished the moment you touched
  // the next row, leaving a countdown running with no way to cancel it.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.id !== cardId.current) {
        animate(x, 0, { ...SPRING, onComplete: () => setActive(false) })
      }
    }
    window.addEventListener(SWIPE_CLOSE_EVENT, handler)
    return () => window.removeEventListener(SWIPE_CLOSE_EVENT, handler)
  }, [x])

  // Tapping a confirm action ARMS it: the action is scheduled in the registry
  // (so it outlives this row), the panel closes and the overlay goes up.
  const requestConfirm = useCallback(
    (action: SwipeAction) => {
      confirmProgress.set(0)
      armPendingAction(
        cardId.current,
        action.holdDuration ?? 10_000,
        action.onClick
      )
      setConfirmingAction(action)
      settle(0)
    },
    [settle, confirmProgress]
  )

  // NOTE: tapping outside deliberately does NOT disarm. Once armed the action
  // is running, and the user is free to carry on with other rows while it does
  // — only the Cancel button stops it. (An outside-tap dismissal made it
  // impossible to arm one delete and move on, which is the whole point of a
  // countdown over a modal.)

  // Follow the armed action so the overlay survives this row unmounting and
  // remounting (a virtualised list recycles rows as it scrolls).
  useEffect(() => {
    const sync = () => {
      const deadline = getPendingDeadline(cardId.current)
      setPendingDeadline(deadline)
      if (deadline === undefined) {
        setConfirmingAction((prev) => (prev ? null : prev))
        confirmProgress.set(0)
      }
    }
    sync()
    return subscribePendingActions(sync)
  }, [confirmProgress])

  const closeOthers = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(SWIPE_CLOSE_EVENT, { detail: { id: cardId.current } })
    )
  }, [])

  const handleDragStart = useCallback(() => {
    movedRef.current = false
    setActive(true)
    // Swiping dismisses any focused field (e.g. a row's inline input).
    if (typeof document !== "undefined") {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    }
    closeOthers()
  }, [closeOthers])

  const handleDrag = useCallback((_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 6) movedRef.current = true
  }, [])

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const current = x.get()
      const velocity = info.velocity.x
      const shouldOpen = -current > openWidth / 2 || velocity < -500
      settle(shouldOpen ? -openWidth : 0, velocity)
    },
    [openWidth, settle, x]
  )

  // Capture-phase guard: swallow the click synthesised at the end of a drag, and
  // close (rather than navigate) when the row is open — before it reaches a child.
  const handleClickCapture = useCallback(
    (e: React.MouseEvent) => {
      const isOpen = Math.abs(x.get()) > 2
      if (movedRef.current || isOpen) {
        e.stopPropagation()
        e.preventDefault()
        if (isOpen) close()
        movedRef.current = false
      }
    },
    [close, x]
  )

  const contentRef = useRef<HTMLDivElement>(null)
  const handleClick = useCallback(() => {
    closeOthers()
    if (onClick) {
      onClick()
      return
    }
    // No explicit handler: focus a blended inline input/textarea inside the row
    // (its pointer events are disabled so the swipe can start over it).
    contentRef.current
      ?.querySelector<HTMLElement>("input, textarea")
      ?.focus()
  }, [closeOthers, onClick])

  // Per-button stagger windows (in x space). The trailing button reveals first.
  const unit = count > 0 ? openWidth / count : 0

  return (
    <div
      ref={containerRef}
      id={id}
      data-swipe-row={separated ? "" : undefined}
      data-swipe-active={separated && active ? "true" : undefined}
      className={cn(
        "relative overflow-hidden",
        isCard && "rounded-lg",
        // Inset divider that fades out (along with the one above) as the row
        // morphs — see .row-divider / [data-swipe-active] rules in globals.css.
        separated && "row-divider",
        containerClassName
      )}
      // THE answer to "a menu is open, so this row is not operable".
      //
      // Blocking events at the capture phase says the same thing, but only for
      // the events you thought to block, in the order the engine happens to
      // deliver them — which is why this took three passes and still moved a
      // little on iOS. `pointer-events: none` is not an interception: the row
      // simply stops being a hit-test target, so nothing can drag it, focus
      // it, activate it or even give it `:active`, whatever any engine sends.
      //
      // And it costs nothing that matters, because a touch that misses the row
      // lands on the SCROLLER behind it — which still scrolls, natively, on
      // the compositor. Untouchable and still scrollable is exactly the state
      // the menu wants everything behind it to be in.
      style={menuOpen ? { pointerEvents: "none" } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Separated, rounded action buttons that pop in and fill the row height */}
      {hasActions && (
        <motion.div
          className="absolute inset-y-0 right-0 flex items-stretch justify-end gap-2 overflow-hidden"
          style={{ width: panelWidth }}
        >
          {actions.map((action, index) => {
            const revFromRight = trailingIndex - index
            const startReveal = revFromRight * unit * 0.5
            const endReveal = startReveal + unit
            return (
              <SwipeActionButton
                key={action.label ?? action.ariaLabel ?? index}
                action={action}
                x={x}
                startX={-startReveal}
                endX={-endReveal}
                onClose={close}
                onRequestConfirm={requestConfirm}
              />
            )
          })}
        </motion.div>
      )}

      {/* Swipeable content — morphs into a lifted card on swipe (row variant).
          Dragging is disabled while a confirm overlay is up so the row can't be
          inadvertently swiped while holding. */}
      <motion.div
        ref={contentRef}
        // `menuOpen` is the load-bearing one: while a press-and-hold menu is
        // up, drag is torn down entirely rather than merely starved of events
        // (see lib/utils/menu-lock).
        drag={hasActions && !confirmingAction && !menuOpen ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: -openWidth, right: 0 }}
        dragElastic={DRAG_ELASTIC}
        dragMomentum={false}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onClickCapture={handleClickCapture}
        onClick={handleClick}
        style={{ x, touchAction: "pan-y" }}
        className={cn("relative z-[1]", className)}
      >
        <div
          className={cn(
            "relative overflow-hidden bg-card transition-[background-color,border-radius] duration-150",
            isCard && "rounded-lg",
            !isCard && active && "rounded-lg bg-secondary"
          )}
        >
          {/* Content is muted while confirming — desaturated, slightly blurred
              and darkened — so it clearly reads as "backgrounded" (and is
              distinguishable from an already-white completed card). */}
          <div
            className={cn(
              "transition-[filter] duration-300",
              confirmingAction && "grayscale blur-[1.5px]"
            )}
          >
            {children}
          </div>
          {/* Confirm overlay: a black mute, the progress border traced around
              the CARD as the countdown runs, and a centred pill that cancels
              it. Above the content (and the .row-divider z-2). */}
          <AnimatePresence>
            {confirmingAction && (
              <motion.div
                className="absolute inset-0 z-[3] flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Constant black mute (no red wash — the gradient border + the
                    pill fill carry the destructive cue). */}
                <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/45" />
                {/* Progress border traced around the card */}
                <HoldProgressBorder progress={confirmProgress} radius={isCard || active ? 8 : 0} />
                <CountdownConfirmButton
                  className="h-10 rounded-full px-6 text-[15px] shadow-md"
                  radius={999}
                  showBorder={false}
                  progress={confirmProgress}
                  /* No ariaLabel override: the button CANCELS, so it must not
                     inherit the delete action's label. The countdown component
                     announces itself with the seconds remaining. */
                  icon={confirmingAction.icon}
                  label={confirmingAction.cancelLabel ?? "Cancel"}
                  duration={confirmingAction.holdDuration ?? 10_000}
                  deadline={pendingDeadline}
                  onCancel={() => {
                    cancelPendingAction(cardId.current)
                    confirmProgress.set(0)
                    setConfirmingAction(null)
                  }}
                  /* The registry fires the action; this only clears the UI. */
                  onConfirm={() => {
                    confirmProgress.set(0)
                    setConfirmingAction(null)
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
