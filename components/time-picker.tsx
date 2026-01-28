"use client"

import { useState, useEffect, useCallback } from "react"
import { WheelPicker, WheelPickerWrapper } from "@ncdai/react-wheel-picker"
import "@ncdai/react-wheel-picker/style.css"

interface TimePickerProps {
  isOpen?: boolean
  initialTime?: string // HH:MM format
  onSelect?: (value: string) => void
  onClose: () => void
  label?: string
  timezoneOffset?: number // In hours for local time display
}

// Generate options for hours (0-23) and minutes (0-59)
const hourOptions = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, "0"),
}))

const minuteOptions = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, "0"),
}))

// Constants for wheel sizing
const ITEM_HEIGHT = 44
const VISIBLE_COUNT = 20

export function TimePicker({
  isOpen = true,
  initialTime = "",
  onSelect,
  onClose,
  label,
  timezoneOffset = 0,
}: TimePickerProps) {
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(0)

  // Parse initial value
  useEffect(() => {
    if (initialTime) {
      const parts = initialTime.split(":")
      if (parts.length === 2) {
        const h = Number.parseInt(parts[0], 10)
        const m = Number.parseInt(parts[1], 10)
        if (!Number.isNaN(h) && h >= 0 && h <= 23) setHours(h)
        if (!Number.isNaN(m) && m >= 0 && m <= 59) setMinutes(m)
      }
    }
  }, [initialTime])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = ""
      }
    }
  }, [isOpen])

  const handleConfirm = useCallback(() => {
    const formatted = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
    onSelect?.(formatted)
    onClose()
  }, [hours, minutes, onSelect, onClose])

  const handleSetNow = useCallback(() => {
    const now = new Date()
    setHours(now.getUTCHours())
    setMinutes(now.getUTCMinutes())
  }, [])

  // Calculate local time if offset provided
  const getLocalTime = useCallback(() => {
    let localHours = hours + timezoneOffset
    if (localHours < 0) localHours += 24
    if (localHours >= 24) localHours -= 24
    return `${localHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
  }, [hours, minutes, timezoneOffset])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card animate-in slide-in-from-bottom duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Cancel | NOW | Save */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <button
            onClick={onClose}
            className="text-sm font-medium text-primary active:opacity-70"
          >
            Cancel
          </button>

          <div className="flex flex-col items-center">
            {label && (
              <span className="text-xs text-muted-foreground mb-1">{label}</span>
            )}
            <button
              onClick={handleSetNow}
              className="text-sm font-medium text-primary active:opacity-70"
            >
              NOW
            </button>
            {timezoneOffset !== 0 && (
              <span className="text-xs text-muted-foreground mt-0.5">
                Local: {getLocalTime()}
              </span>
            )}
          </div>

          <button
            onClick={handleConfirm}
            className="text-sm font-semibold text-primary active:opacity-70"
          >
            Save
          </button>
        </div>

        {/* Wheel Picker */}
        <div className="relative px-8 py-4">
          {/* Highlight bar */}
          <div
            className="pointer-events-none absolute left-8 right-8 top-1/2 z-0 -translate-y-1/2 rounded-lg bg-muted/40"
            style={{ height: ITEM_HEIGHT }}
          />

          {/* Colon separator */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
            style={{ height: ITEM_HEIGHT }}
          >
            <span className="text-xl font-semibold text-foreground">:</span>
          </div>

          <WheelPickerWrapper>
            <div className="flex-1">
              <WheelPicker
                options={hourOptions}
                value={hours}
                onValueChange={(val) => setHours(val as number)}
                infinite
                optionItemHeight={ITEM_HEIGHT}
                visibleCount={VISIBLE_COUNT}
                classNames={{
                  optionItem: "text-lg tabular-nums text-muted-foreground/50 font-medium",
                  highlightItem: "text-xl tabular-nums text-foreground font-semibold",
                }}
              />
            </div>

            {/* Spacer for colon */}
            <div className="w-6 flex-none" />

            <div className="flex-1">
              <WheelPicker
                options={minuteOptions}
                value={minutes}
                onValueChange={(val) => setMinutes(val as number)}
                infinite
                optionItemHeight={ITEM_HEIGHT}
                visibleCount={VISIBLE_COUNT}
                classNames={{
                  optionItem: "text-lg tabular-nums text-muted-foreground/50 font-medium",
                  highlightItem: "text-xl tabular-nums text-foreground font-semibold",
                }}
              />
            </div>
          </WheelPickerWrapper>
        </div>
      </div>
    </div>
  )
}
