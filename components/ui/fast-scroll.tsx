"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface FastScrollItem {
  key: string
  label: string
}

interface FastScrollProps {
  items: FastScrollItem[]
  activeKey?: string
  onSelect: (key: string) => void
  onScrollStart?: () => void
  onScrollEnd?: () => void
  className?: string
  indicatorPosition?: "left" | "right"
  showIndicator?: boolean
  disabled?: boolean
}

/**
 * FastScroll - A touch-optimized index rail for quick navigation through lists
 *
 * Similar to iOS Contacts A-Z sidebar or Android fast scroll functionality.
 * Supports both mouse and touch interactions with haptic feedback on mobile.
 */
export function FastScroll({
  items,
  activeKey,
  onSelect,
  onScrollStart,
  onScrollEnd,
  className,
  indicatorPosition = "right",
  showIndicator = true,
  disabled = false,
}: FastScrollProps) {
  const [isDragging, setIsDragging] = React.useState(false)
  const [hoveredKey, setHoveredKey] = React.useState<string | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const lastSelectedRef = React.useRef<string | null>(null)

  const currentKey = hoveredKey || activeKey

  // Trigger haptic feedback on mobile devices
  const triggerHaptic = React.useCallback(() => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(5)
    }
  }, [])

  const getItemFromPosition = React.useCallback(
    (clientY: number): FastScrollItem | null => {
      if (!containerRef.current || items.length === 0) return null

      const container = containerRef.current
      const rect = container.getBoundingClientRect()
      const relativeY = clientY - rect.top
      const percentage = Math.max(0, Math.min(1, relativeY / rect.height))
      const index = Math.min(
        Math.floor(percentage * items.length),
        items.length - 1
      )

      return items[index] || null
    },
    [items]
  )

  const handleInteraction = React.useCallback(
    (clientY: number) => {
      if (disabled) return

      const item = getItemFromPosition(clientY)
      if (item) {
        setHoveredKey(item.key)

        // Only trigger selection and haptic if the item changed
        if (item.key !== lastSelectedRef.current) {
          lastSelectedRef.current = item.key
          triggerHaptic()
          onSelect(item.key)
        }
      }
    },
    [disabled, getItemFromPosition, onSelect, triggerHaptic]
  )

  const handleStart = React.useCallback(
    (clientY: number) => {
      if (disabled) return

      setIsDragging(true)
      lastSelectedRef.current = null
      onScrollStart?.()
      handleInteraction(clientY)
    },
    [disabled, handleInteraction, onScrollStart]
  )

  const handleEnd = React.useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      setHoveredKey(null)
      lastSelectedRef.current = null
      onScrollEnd?.()
    }
  }, [isDragging, onScrollEnd])

  // Mouse event handlers
  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      handleStart(e.clientY)
    },
    [handleStart]
  )

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        handleInteraction(e.clientY)
      }
    },
    [isDragging, handleInteraction]
  )

  const handleMouseLeave = React.useCallback(() => {
    if (!isDragging) {
      setHoveredKey(null)
    }
  }, [isDragging])

  // Touch event handlers
  const handleTouchStart = React.useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        handleStart(e.touches[0].clientY)
      }
    },
    [handleStart]
  )

  const handleTouchMove = React.useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        // Prevent page scrolling while using fast scroll
        e.preventDefault()
        handleInteraction(e.touches[0].clientY)
      }
    },
    [handleInteraction]
  )

  const handleTouchEnd = React.useCallback(() => {
    handleEnd()
  }, [handleEnd])

  // Global mouse up listener for when mouse leaves the component while dragging
  React.useEffect(() => {
    const handleGlobalMouseUp = () => {
      handleEnd()
    }

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleInteraction(e.clientY)
      }
    }

    if (isDragging) {
      window.addEventListener("mouseup", handleGlobalMouseUp)
      window.addEventListener("mousemove", handleGlobalMouseMove)
    }

    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp)
      window.removeEventListener("mousemove", handleGlobalMouseMove)
    }
  }, [isDragging, handleEnd, handleInteraction])

  // Calculate indicator position
  const indicatorStyle = React.useMemo(() => {
    if (!currentKey || items.length === 0) return {}

    const index = items.findIndex((i) => i.key === currentKey)
    if (index === -1) return {}

    // Handle edge case when there's only one item
    const percentage = items.length === 1 ? 0.5 : index / (items.length - 1)

    return {
      top: `calc(${percentage * 100}% - 28px)`,
    }
  }, [currentKey, items])

  if (items.length === 0) return null

  return (
    <div
      className={cn(
        "relative flex items-center select-none",
        indicatorPosition === "left" ? "flex-row-reverse" : "flex-row",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
      role="navigation"
      aria-label="Quick navigation"
    >
      {/* Current selection indicator bubble */}
      {showIndicator && currentKey && isDragging && (
        <div
          className={cn(
            "absolute flex items-center justify-center w-14 h-14",
            "rounded-full bg-primary text-primary-foreground",
            "text-2xl font-bold shadow-lg",
            "animate-in fade-in zoom-in-50 duration-150",
            "z-50",
            indicatorPosition === "left" ? "right-10" : "left-10"
          )}
          style={indicatorStyle}
          role="status"
          aria-live="polite"
        >
          {items.find((i) => i.key === currentKey)?.label}
        </div>
      )}

      {/* Index rail */}
      <div
        ref={containerRef}
        className={cn(
          "relative flex flex-col items-center",
          "py-2 px-1.5 rounded-full",
          "transition-colors duration-150 cursor-pointer touch-none",
          isDragging
            ? "bg-muted/80 shadow-inner"
            : "hover:bg-muted/40"
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="listbox"
        aria-label="Quick navigation index"
        tabIndex={disabled ? -1 : 0}
      >
        {items.map((item) => (
          <div
            key={item.key}
            className={cn(
              "flex items-center justify-center",
              "w-5 h-5 text-xs font-medium",
              "transition-all duration-100",
              item.key === currentKey
                ? "text-primary scale-125 font-bold"
                : "text-muted-foreground/70 hover:text-foreground"
            )}
            role="option"
            aria-selected={item.key === currentKey}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// Preset generators for common use cases

/**
 * Alphabet items A-Z plus # for non-alphabetic entries
 */
export const alphabetItems: FastScrollItem[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#"
  .split("")
  .map((letter) => ({
    key: letter,
    label: letter,
  }))

/**
 * Generate number items for a range
 */
export const numberItems = (start: number, end: number): FastScrollItem[] =>
  Array.from({ length: end - start + 1 }, (_, i) => ({
    key: String(start + i),
    label: String(start + i),
  }))

/**
 * Month items for date navigation
 */
export const monthItems: FastScrollItem[] = [
  { key: "01", label: "Jan" },
  { key: "02", label: "Feb" },
  { key: "03", label: "Mar" },
  { key: "04", label: "Apr" },
  { key: "05", label: "May" },
  { key: "06", label: "Jun" },
  { key: "07", label: "Jul" },
  { key: "08", label: "Aug" },
  { key: "09", label: "Sep" },
  { key: "10", label: "Oct" },
  { key: "11", label: "Nov" },
  { key: "12", label: "Dec" },
]

/**
 * Generate year items for date navigation
 * Labels show 2-digit year format for space efficiency
 */
export const yearItems = (startYear: number, endYear: number): FastScrollItem[] =>
  Array.from({ length: endYear - startYear + 1 }, (_, i) => ({
    key: String(startYear + i),
    label: String(startYear + i).slice(-2),
  }))

/**
 * Generate items from a list of dates (grouped by month/year)
 * Useful for logbook/roster navigation
 */
export function generateDateItems(dates: string[]): FastScrollItem[] {
  if (dates.length === 0) return []

  const monthYears = new Set<string>()

  dates.forEach((date) => {
    const [year, month] = date.split("-")
    if (year && month) {
      monthYears.add(`${year}-${month}`)
    }
  })

  const sorted = Array.from(monthYears).sort((a, b) => b.localeCompare(a))

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  return sorted.map((monthYear) => {
    const [year, month] = monthYear.split("-")
    const monthIndex = parseInt(month, 10) - 1
    return {
      key: monthYear,
      label: `${monthNames[monthIndex]} '${year.slice(-2)}`,
    }
  })
}

/**
 * Generate items from a list of strings (first letter grouping)
 * Useful for alphabetical lists like airports, crew, etc.
 */
export function generateAlphabetItemsFromList(
  items: string[],
  getKey: (item: string) => string = (item) => item
): FastScrollItem[] {
  const letters = new Set<string>()

  items.forEach((item) => {
    const key = getKey(item)
    if (key && key.length > 0) {
      const firstChar = key[0].toUpperCase()
      if (/[A-Z]/.test(firstChar)) {
        letters.add(firstChar)
      } else {
        letters.add("#")
      }
    }
  })

  const sorted = Array.from(letters).sort((a, b) => {
    if (a === "#") return 1
    if (b === "#") return -1
    return a.localeCompare(b)
  })

  return sorted.map((letter) => ({
    key: letter,
    label: letter,
  }))
}
