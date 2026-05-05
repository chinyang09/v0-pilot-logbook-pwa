"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface MiniBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  trackClassName?: string
  indicatorClassName?: string
  height?: number
}

export function MiniBar({
  value,
  max = 100,
  trackClassName,
  indicatorClassName,
  height = 6,
  className,
  style,
  ...props
}: MiniBarProps) {
  const safeMax = max > 0 ? max : 1
  const ratio = Math.max(0, Math.min(1, value / safeMax))

  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-muted", trackClassName, className)}
      style={{ height, ...style }}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none",
          indicatorClassName,
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}
