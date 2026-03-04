"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import { useSwipeGesture, getSwipeTransitionClass } from "@/hooks/use-swipe-gesture"
import { cn } from "@/lib/utils"

const SWIPE_CLOSE_EVENT = "swipe-card-close-others"

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
}

export function SwipeableCard({
  children,
  actions = [],
  onClick,
  className,
  disabled = false,
  id,
}: SwipeableCardProps) {
  const actionWidth = 80
  const totalActionsWidth = actions.length * actionWidth
  const OVERLAP = 8
  const cardId = useRef(id || Math.random().toString(36).slice(2))

  const { swipeX, isSwiping, close, swipeProps } = useSwipeGesture({
    threshold: Math.min(80, totalActionsWidth),
    openPosition: totalActionsWidth - OVERLAP,
    direction: "left",
    disabled,
    onSwipeComplete: () => {
      // Close all other swiped cards
      window.dispatchEvent(
        new CustomEvent(SWIPE_CLOSE_EVENT, { detail: { id: cardId.current } })
      )
    },
  })

  // Listen for other cards opening/clicking and close this one
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.id !== cardId.current) {
        close()
      }
    }
    window.addEventListener(SWIPE_CLOSE_EVENT, handler)
    return () => window.removeEventListener(SWIPE_CLOSE_EVENT, handler)
  }, [close])

  const handleClick = () => {
    if (swipeX < 0) {
      close()
    } else {
      // Close any other open cards when this card is tapped
      window.dispatchEvent(
        new CustomEvent(SWIPE_CLOSE_EVENT, { detail: { id: cardId.current } })
      )
    }
    // Always select/navigate on tap, whether closing or fresh tap
    onClick?.()
  }

  return (
    <div id={id} className="relative overflow-hidden rounded-lg">
      {/* Action buttons — fills entire container, clipped to rounded corners */}
      <div
        className={cn(
          "absolute inset-0 flex items-center transition-opacity",
          swipeX < 0 ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {actions.map((action, index) => {
          // First button (closest to card) fills remaining space
          const isFirst = index === 0

          return (
            <button
              key={index}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                action.onClick()
                close()
              }}
              disabled={action.disabled}
              className={cn(
                "h-full flex items-center",
                isFirst ? "flex-1 justify-end" : "justify-center",
                action.variant === "destructive" &&
                  "bg-destructive text-destructive-foreground",
                action.variant === "secondary" &&
                  "bg-secondary text-foreground",
                !action.variant &&
                  "bg-muted text-muted-foreground",
                action.className
              )}
              style={isFirst ? { minWidth: actionWidth } : { width: actionWidth }}
            >
              {isFirst ? (
                <div className="flex items-center justify-center" style={{ width: actionWidth }}>
                  {action.icon}
                </div>
              ) : (
                action.icon
              )}
            </button>
          )
        })}
      </div>

      {/* Main swipeable content */}
      <div
        {...swipeProps}
        onClick={handleClick}
        className={cn(
          getSwipeTransitionClass(isSwiping),
          className
        )}
      >
        <div className="bg-card rounded-lg">
          {children}
        </div>
      </div>
    </div>
  )
}
