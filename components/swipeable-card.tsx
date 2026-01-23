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
}

export function SwipeableCard({
  children,
  actions = [],
  onClick,
  className,
  disabled = false,
}: SwipeableCardProps) {
  const { swipeX, isSwiping, close, swipeProps } = useSwipeGesture({
    threshold: 80,
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

  const actionWidth = 80
  const totalActionsWidth = actions.length * actionWidth

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Action buttons revealed on swipe */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center transition-opacity",
          swipeX < 0 ? "opacity-100" : "opacity-0"
        )}
        style={{ width: totalActionsWidth }}
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

      {/* Main swipeable content */}
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
