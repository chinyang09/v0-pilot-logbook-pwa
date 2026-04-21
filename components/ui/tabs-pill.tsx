"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface TabsPillOption<T extends string> {
  value: T
  label: React.ReactNode
}

interface TabsPillProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<TabsPillOption<T>>
  className?: string
  ariaLabel?: string
}

export function TabsPill<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: TabsPillProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-card/60 p-1 shadow-sm",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative px-3 py-1.5 text-xs font-medium rounded-full transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
