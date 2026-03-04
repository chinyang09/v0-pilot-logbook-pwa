"use client"

import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import type React from "react"

/**
 * Options for the useSwipeGesture hook
 */
export interface UseSwipeGestureOptions {
  /** Threshold in pixels before swipe action triggers (default: 80) */
  threshold?: number
  /** Maximum swipe distance (default: openPosition + 20) */
  maxSwipe?: number
  /** Snap-open position in pixels (default: threshold * 2) */
  openPosition?: number
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
    ref: (node: HTMLElement | null) => void
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    style: { transform: string; touchAction: string }
  }
}

const DEFAULT_THRESHOLD = 80
const DIRECTION_DETECT_THRESHOLD = 10

/**
 * Hook for handling swipe gestures on touchable elements
 */
export function useSwipeGesture(
  options: UseSwipeGestureOptions = {}
): UseSwipeGestureReturn {
  const {
    threshold = DEFAULT_THRESHOLD,
    direction = "left",
    onSwipeComplete,
    disabled = false,
  } = options
  const openPos = options.openPosition ?? threshold * 2
  const maxSwipe = options.maxSwipe ?? openPos + 20

  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  const startX = useRef(0)
  const startY = useRef(0)
  const startSwipeX = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)
  const elementRef = useRef<HTMLElement | null>(null)

  const isOpen = Math.abs(swipeX) >= threshold

  const close = useCallback(() => {
    setSwipeX(0)
  }, [])

  const open = useCallback(() => {
    if (direction === "left" || direction === "both") {
      setSwipeX(-openPos)
    } else {
      setSwipeX(openPos)
    }
  }, [direction, openPos])

  const toggle = useCallback(() => {
    if (isOpen) {
      close()
    } else {
      open()
    }
  }, [isOpen, close, open])

  // Non-passive native touchmove to prevent scrolling during horizontal swipe
  const preventScrollHandler = useCallback((e: TouchEvent) => {
    if (isHorizontalSwipe.current) {
      e.preventDefault()
    }
  }, [])

  // Ref callback to attach/detach native non-passive listener
  const swipeRef = useCallback(
    (node: HTMLElement | null) => {
      if (elementRef.current) {
        elementRef.current.removeEventListener("touchmove", preventScrollHandler)
      }
      elementRef.current = node
      if (node) {
        node.addEventListener("touchmove", preventScrollHandler, { passive: false })
      }
    },
    [preventScrollHandler]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (elementRef.current) {
        elementRef.current.removeEventListener("touchmove", preventScrollHandler)
      }
    }
  }, [preventScrollHandler])

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return

      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      startSwipeX.current = swipeX
      isHorizontalSwipe.current = null
      setIsSwiping(true)
    },
    [disabled, swipeX]
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

      // New position = starting position + drag distance (no jump on re-swipe)
      const newX = startSwipeX.current + diffX

      // Clamp based on direction
      if (direction === "left") {
        setSwipeX(Math.max(-maxSwipe, Math.min(0, newX)))
      } else if (direction === "right") {
        setSwipeX(Math.min(maxSwipe, Math.max(0, newX)))
      } else {
        setSwipeX(Math.max(-maxSwipe, Math.min(maxSwipe, newX)))
      }
    },
    [isSwiping, disabled, direction, maxSwipe]
  )

  const handleTouchEnd = useCallback(() => {
    setIsSwiping(false)

    if (disabled) return

    // Snap to open or closed position
    if (Math.abs(swipeX) >= threshold) {
      // Snap to open position
      setSwipeX(swipeX < 0 ? -openPos : openPos)
      onSwipeComplete?.()
    } else {
      // Snap to closed
      setSwipeX(0)
    }
  }, [disabled, swipeX, threshold, openPos, onSwipeComplete])

  const swipeProps = useMemo(
    () => ({
      ref: swipeRef,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      style: {
        transform: swipeX !== 0 ? `translateX(${swipeX}px)` : 'none',
        touchAction: 'pan-y',
      },
    }),
    [swipeRef, handleTouchStart, handleTouchMove, handleTouchEnd, swipeX]
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
