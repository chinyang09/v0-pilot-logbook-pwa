"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type PanInfo,
} from "framer-motion"
import { cn } from "@/lib/utils"

const SWIPE_CLOSE_EVENT = "swipe-card-close-others"

/** Resting width revealed per action button (px) */
const ACTION_WIDTH = 76
/** Fraction of the row's width that arms the iOS-style full swipe */
const FULL_SWIPE_RATIO = 0.6
/** Elastic resistance once dragged past the natural open position */
const DRAG_ELASTIC = 0.14
/** Spring used for every snap/settle animation */
const SPRING = { type: "spring" as const, stiffness: 520, damping: 42, mass: 0.9 }

export interface SwipeAction {
  label?: string
  icon: React.ReactNode
  onClick: () => void
  variant?: "default" | "destructive" | "secondary"
  className?: string
  disabled?: boolean
}

interface SwipeableCardProps {
  children: React.ReactNode
  actions?: SwipeAction[]
  onClick?: () => void
  className?: string
  disabled?: boolean
  id?: string
  /**
   * Enable iOS-style full swipe: dragging the row past {@link FULL_SWIPE_RATIO}
   * of its width and releasing triggers the trailing (last) action. The trailing
   * action expands to fill the revealed area as it arms. Defaults to true.
   */
  fullSwipe?: boolean
}

function variantClasses(variant?: SwipeAction["variant"]): string {
  return cn(
    variant === "destructive" && "bg-destructive text-destructive-foreground",
    variant === "secondary" && "bg-secondary text-foreground",
    (!variant || variant === "default") && "bg-muted text-muted-foreground"
  )
}

/**
 * A reusable swipe-to-reveal row.
 *
 * The action buttons are anchored to the trailing edge and *grow* with the
 * swipe distance (Material 3 / iOS feel) rather than sitting as a static layer
 * underneath the card. Release settles with a spring. Vertical gestures are
 * ignored via direction locking so the list keeps scrolling cleanly.
 */
export function SwipeableCard({
  children,
  actions = [],
  onClick,
  className,
  disabled = false,
  id,
  fullSwipe = true,
}: SwipeableCardProps) {
  const cardId = useRef(id || Math.random().toString(36).slice(2))
  const containerRef = useRef<HTMLDivElement>(null)

  const hasActions = actions.length > 0 && !disabled
  const openWidth = actions.length * ACTION_WIDTH
  const trailingIndex = actions.length - 1

  // x drives the card translation; the action panel width derives from it so the
  // buttons appear to grow out of the trailing edge as you swipe.
  const x = useMotionValue(0)
  const panelWidth = useTransform(x, (v) => Math.max(0, -v))

  // Measured row width, used for drag bounds and the full-swipe threshold.
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.offsetWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // armed = dragged far enough that releasing fires the trailing action.
  const [armed, setArmed] = useState(false)
  useMotionValueEvent(x, "change", (v) => {
    if (!fullSwipe || trailingIndex < 0) return
    const w = containerRef.current?.offsetWidth ?? width
    setArmed(w > 0 && -v >= w * FULL_SWIPE_RATIO)
  })

  // Tracks whether the last pointer interaction actually moved (drag vs tap).
  const movedRef = useRef(false)

  const settle = useCallback(
    (target: number, velocity = 0) => {
      animate(x, target, { ...SPRING, velocity })
    },
    [x]
  )

  const close = useCallback(() => settle(0), [settle])

  // Close this card when another card opens or is tapped.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.id !== cardId.current) {
        animate(x, 0, SPRING)
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
    closeOthers()
  }, [closeOthers])

  const handleDrag = useCallback((_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 6) movedRef.current = true
  }, [])

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const w = containerRef.current?.offsetWidth ?? width
      const current = x.get()
      const velocity = info.velocity.x

      // iOS-style full swipe → fire the trailing action, then settle closed.
      if (fullSwipe && trailingIndex >= 0 && w > 0 && -current >= w * FULL_SWIPE_RATIO) {
        const action = actions[trailingIndex]
        settle(0)
        if (!action.disabled) action.onClick()
        return
      }

      // Otherwise snap open or closed based on position / fling velocity.
      const shouldOpen = -current > openWidth / 2 || velocity < -500
      settle(shouldOpen ? -openWidth : 0, velocity)
    },
    [actions, fullSwipe, openWidth, settle, trailingIndex, width, x]
  )

  const handleClick = useCallback(() => {
    // Swallow the click synthesised at the end of a drag.
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    // If open, a tap just closes the row.
    if (Math.abs(x.get()) > 2) {
      close()
      return
    }
    closeOthers()
    onClick?.()
  }, [close, closeOthers, onClick, x])

  const maxDrag = (fullSwipe ? width : openWidth) || openWidth

  return (
    <div
      ref={containerRef}
      id={id}
      className="relative overflow-hidden rounded-lg"
    >
      {/* Action panel — width tracks the swipe so buttons grow from the edge */}
      {hasActions && (
        <motion.div
          className="absolute inset-y-0 right-0 flex items-stretch overflow-hidden"
          style={{ width: panelWidth }}
          aria-hidden={panelWidth.get() === 0}
        >
          {actions.map((action, index) => {
            const isTrailing = index === trailingIndex
            // When armed, the trailing action expands to fill and the rest collapse.
            const collapsed = armed && !isTrailing
            return (
              <button
                key={action.label ?? index}
                type="button"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (action.disabled) return
                  action.onClick()
                  close()
                }}
                disabled={action.disabled}
                className={cn(
                  "h-full flex items-center justify-center overflow-hidden",
                  "transition-[flex-grow] duration-200 ease-out",
                  "disabled:opacity-50",
                  variantClasses(action.variant),
                  action.className
                )}
                style={{
                  flexGrow: collapsed ? 0 : 1,
                  flexBasis: 0,
                  minWidth: collapsed ? 0 : ACTION_WIDTH,
                }}
              >
                <span className="flex flex-col items-center justify-center gap-0.5">
                  {action.icon}
                  {action.label && (
                    <span className="text-xs font-medium leading-none">
                      {action.label}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </motion.div>
      )}

      {/* Swipeable content */}
      <motion.div
        drag={hasActions ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: -maxDrag, right: 0 }}
        dragElastic={DRAG_ELASTIC}
        dragMomentum={false}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        style={{ x, touchAction: "pan-y" }}
        className={cn("relative z-[1]", className)}
      >
        <div className="bg-card rounded-lg">{children}</div>
      </motion.div>
    </div>
  )
}
