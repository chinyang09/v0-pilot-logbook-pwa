"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "framer-motion"
import { cn } from "@/lib/utils"

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
/** Spring used for every snap/settle animation of the card */
const SPRING = { type: "spring" as const, stiffness: 520, damping: 42, mass: 0.9 }
/** Spring used for the per-button scale/pop-in */
const POP_SPRING = { stiffness: 700, damping: 24, mass: 0.6 }

export interface SwipeAction {
  label?: string
  /** Optional — actions may be label-only (e.g. "Clear") */
  icon?: React.ReactNode
  onClick: () => void
  variant?: "default" | "destructive" | "secondary"
  className?: string
  disabled?: boolean
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
 * nothing peeks at the card's edge.
 */
function SwipeActionButton({
  action,
  x,
  startX,
  endX,
  onClose,
}: {
  action: SwipeAction
  x: MotionValue<number>
  startX: number
  endX: number
  onClose: () => void
}) {
  // 0 (hidden) → 1 (fully revealed) across this button's stagger window.
  const reveal = useTransform(x, [endX, startX], [1, 0], { clamp: true })
  const scale = useSpring(useTransform(reveal, [0, 1], [0.4, 1]), POP_SPRING)
  const opacity = useSpring(reveal, POP_SPRING)

  return (
    <motion.button
      type="button"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation()
        if (action.disabled) return
        action.onClick()
        onClose()
      }}
      disabled={action.disabled}
      style={{ scale, opacity, width: BUTTON_WIDTH }}
      className={cn(
        "shrink-0 self-stretch flex flex-col items-center justify-center gap-0.5",
        "rounded-lg overflow-hidden disabled:opacity-50",
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
  disabled = false,
  id,
  variant = "card",
  separated = false,
}: SwipeableCardProps) {
  const cardId = useRef(id || Math.random().toString(36).slice(2))
  const containerRef = useRef<HTMLDivElement>(null)
  const isCard = variant === "card"

  const hasActions = actions.length > 0 && !disabled
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

  // Close this card when another card opens or is tapped.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.id !== cardId.current) {
        animate(x, 0, { ...SPRING, onComplete: () => setActive(false) })
      }
    }
    window.addEventListener(SWIPE_CLOSE_EVENT, handler)
    return () => window.removeEventListener(SWIPE_CLOSE_EVENT, handler)
  }, [x])

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
                key={action.label ?? index}
                action={action}
                x={x}
                startX={-startReveal}
                endX={-endReveal}
                onClose={close}
              />
            )
          })}
        </motion.div>
      )}

      {/* Swipeable content — morphs into a lifted card on swipe (row variant) */}
      <motion.div
        ref={contentRef}
        drag={hasActions ? "x" : false}
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
            "bg-card transition-[background-color,border-radius] duration-150",
            isCard && "rounded-lg",
            !isCard && active && "rounded-lg bg-secondary"
          )}
        >
          {children}
        </div>
      </motion.div>
    </div>
  )
}
