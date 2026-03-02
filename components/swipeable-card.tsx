"use client"

import type React from "react"
import { useSwipeGesture, getSwipeTransitionClass } from "@/hooks/use-swipe-gesture"
import { cn } from "@/lib/utils"

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

// Card overlaps action buttons by this many pixels (matches rounded-lg radius)
// so the card's rounded edge covers the action buttons' sharp left edge.
const OVERLAP = 8

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

  const { swipeX, isSwiping, close, swipeProps } = useSwipeGesture({
    threshold: Math.min(80, totalActionsWidth),
    openPosition: totalActionsWidth,
    direction: "left",
    disabled,
  })

  const handleClick = () => {
    if (swipeX < 0) {
      close()
    } else {
      onClick?.()
    }
  }

  return (
    <div id={id} className="relative overflow-hidden rounded-lg">
      {/* Action buttons — clip-path progressively reveals as card slides */}
      <div
        className="absolute inset-y-0 right-0 flex items-center"
        style={{
          width: totalActionsWidth,
          clipPath: `inset(0 0 0 ${Math.max(0, totalActionsWidth + swipeX + OVERLAP)}px)`,
        }}
      >
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              action.onClick()
              close()
            }}
            disabled={action.disabled}
            className={cn(
              "h-full flex items-center justify-center",
              action.variant === "destructive" &&
                "bg-destructive text-destructive-foreground",
              action.variant === "secondary" &&
                "bg-secondary text-foreground",
              !action.variant &&
                "bg-muted text-muted-foreground",
              action.className
            )}
            style={{ width: actionWidth }}
          >
            {action.icon}
          </button>
        ))}
      </div>

      {/* Main swipeable content — DOM order paints above actions, clipPath handles visibility */}
      <div
        {...swipeProps}
        onClick={handleClick}
        className={cn(
          getSwipeTransitionClass(isSwiping),
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
