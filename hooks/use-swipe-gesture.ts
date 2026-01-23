"use client"

import { useState, useRef, useCallback, useMemo } from "react"
import type React from "react"

/**
 * Options for the useSwipeGesture hook
 */
export interface UseSwipeGestureOptions {
  /** Threshold in pixels before swipe action triggers (default: 80) */
  threshold?: number
  /** Maximum swipe distance (default: threshold * 2 + 20) */
  maxSwipe?: number
  /** Direction of swipe: 'left' | 'right' | 'both' (default: 'left') */
  direction?: "left" | "right" | "both"
  /** Callback when swipe is completed (past threshold) */
  onSwipeComplete?: () => void
  /** Whether swipe is disabled */
  disabled?: boolean
}

/**
 * Return type for useSwipeGesture hook
 */
export interface UseSwipeGestureReturn {
  /** Current swipe X position */
  swipeX: number
  /** Whether user is currently swiping */
  isSwiping: boolean
  /** Whether swipe is past the threshold (actions revealed) */
  isOpen: boolean
  /** Touch start handler */
  handleTouchStart: (e: React.TouchEvent) => void
  /** Touch move handler */
  handleTouchMove: (e: React.TouchEvent) => void
  /** Touch end handler */
  handleTouchEnd: () => void
  /** Reset swipe position to closed */
  close: () => void
  /** Open swipe to reveal actions */
  open: () => void
  /** Toggle between open and closed */
  toggle: () => void
  /** Props object to spread on the swipeable element */
  swipeProps: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    style: { transform: string }
    className?: string
  }
}

const DEFAULT_THRESHOLD = 80
const DIRECTION_DETECT_THRESHOLD = 10

/**
 * Hook for handling swipe gestures on touchable elements
 *
 * @example
 * ```tsx
 * const { swipeX, isSwiping, swipeProps, close } = useSwipeGesture({
 *   threshold: 80,
 *   direction: 'left',
 * })
 *
 * return (
 *   <div className="relative overflow-hidden">
 *     <div className="absolute right-0">
 *       <Button onClick={() => { onDelete(); close(); }}>Delete</Button>
 *     </div>
 *     <Card
 *       {...swipeProps}
 *       className={cn(!isSwiping && "transition-transform duration-200")}
 *     >
 *       Content
 *     </Card>
 *   </div>
 * )
 * ```
 */
export function useSwipeGesture(
  options: UseSwipeGestureOptions = {}
): UseSwipeGestureReturn {
  const {
    threshold = DEFAULT_THRESHOLD,
    maxSwipe = threshold * 2 + 20,
    direction = "left",
    onSwipeComplete,
    disabled = false,
  } = options

  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const isOpen = Math.abs(swipeX) >= threshold

  const close = useCallback(() => {
    setSwipeX(0)
  }, [])

  const open = useCallback(() => {
    if (direction === "left" || direction === "both") {
      setSwipeX(-threshold * 2)
    } else {
      setSwipeX(threshold * 2)
    }
  }, [direction, threshold])

  const toggle = useCallback(() => {
    if (isOpen) {
      close()
    } else {
      open()
    }
  }, [isOpen, close, open])

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return

      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      isHorizontalSwipe.current = null
      setIsSwiping(true)
    },
    [disabled]
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping || disabled) return

      const currentX = e.touches[0].clientX
      const currentY = e.touches[0].clientY
      const diffX = currentX - startX.current
      const diffY = currentY - startY.current

      // Determine if this is a horizontal or vertical swipe
      if (
        isHorizontalSwipe.current === null &&
        (Math.abs(diffX) > DIRECTION_DETECT_THRESHOLD ||
          Math.abs(diffY) > DIRECTION_DETECT_THRESHOLD)
      ) {
        isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY)
      }

      // Only handle horizontal swipes
      if (!isHorizontalSwipe.current) return

      // Handle swipe based on direction option
      if (direction === "left") {
        // Left swipe only (diffX negative)
        if (diffX < 0) {
          setSwipeX(Math.max(diffX, -maxSwipe))
        } else if (swipeX < 0) {
          // Allow dragging back to closed
          setSwipeX(Math.min(0, swipeX + diffX))
        }
      } else if (direction === "right") {
        // Right swipe only (diffX positive)
        if (diffX > 0) {
          setSwipeX(Math.min(diffX, maxSwipe))
        } else if (swipeX > 0) {
          // Allow dragging back to closed
          setSwipeX(Math.max(0, swipeX + diffX))
        }
      } else {
        // Both directions
        setSwipeX(Math.max(-maxSwipe, Math.min(diffX, maxSwipe)))
      }
    },
    [isSwiping, disabled, direction, maxSwipe, swipeX]
  )

  const handleTouchEnd = useCallback(() => {
    setIsSwiping(false)

    if (disabled) return

    // Snap to open or closed position
    if (Math.abs(swipeX) >= threshold) {
      // Snap to open position
      setSwipeX(swipeX < 0 ? -threshold * 2 : threshold * 2)
      onSwipeComplete?.()
    } else {
      // Snap to closed
      setSwipeX(0)
    }
  }, [disabled, swipeX, threshold, onSwipeComplete])

  const swipeProps = useMemo(
    () => ({
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      style: { transform: `translateX(${swipeX}px)` },
    }),
    [handleTouchStart, handleTouchMove, handleTouchEnd, swipeX]
  )

  return {
    swipeX,
    isSwiping,
    isOpen,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    close,
    open,
    toggle,
    swipeProps,
  }
}

/**
 * Get transition class for swipeable element
 * Returns empty string when swiping to allow smooth tracking
 */
export function getSwipeTransitionClass(isSwiping: boolean): string {
  return isSwiping ? "" : "transition-transform duration-200"
}
