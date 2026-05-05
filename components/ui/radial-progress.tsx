"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface RadialProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  trackClassName?: string
  indicatorClassName?: string
  startAngle?: number
  rounded?: boolean
}

export function RadialProgress({
  value,
  max = 100,
  size = 96,
  strokeWidth = 8,
  trackClassName,
  indicatorClassName,
  startAngle = -90,
  rounded = true,
  className,
  children,
  style,
  ...props
}: RadialProgressProps) {
  const safeMax = max > 0 ? max : 1
  const ratio = Math.max(0, Math.min(1, value / safeMax))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - ratio)

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size, ...style }}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <svg
        className="absolute inset-0 -rotate-0"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: `rotate(${startAngle}deg)` }}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={cn("stroke-muted", trackClassName)}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap={rounded ? "round" : "butt"}
          className={cn(
            "stroke-primary transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none",
            indicatorClassName,
          )}
        />
      </svg>
      {children && (
        <div className="relative flex flex-col items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  )
}
