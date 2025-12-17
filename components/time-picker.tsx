"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X } from "lucide-react"

interface TimePickerProps {
  isOpen?: boolean
  initialTime?: string // HH:MM format (was: value)
  onSelect?: (value: string) => void // (was: onChange)
  onClose: () => void
  label?: string
  timezoneOffset?: number // (was: utcOffset)
}

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
  const hoursRef = useRef<HTMLDivElement>(null)
  const minutesRef = useRef<HTMLDivElement>(null)

  // Parse initial value
  useEffect(() => {
    if (initialTime) {
      const parts = initialTime.split(":")
      if (parts.length === 2) {
        setHours(Number.parseInt(parts[0], 10) || 0)
        setMinutes(Number.parseInt(parts[1], 10) || 0)
      }
    }
  }, [initialTime])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = ""
      }
    }
  }, [isOpen])

  // Scroll to selected values on mount
  useEffect(() => {
    if (hoursRef.current) {
      const hourItem = hoursRef.current.querySelector(`[data-hour="${hours}"]`)
      hourItem?.scrollIntoView({ block: "center", behavior: "instant" })
    }
    if (minutesRef.current) {
      const minItem = minutesRef.current.querySelector(`[data-minute="${minutes}"]`)
      minItem?.scrollIntoView({ block: "center", behavior: "instant" })
    }
  }, [hours, minutes])

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

  const localTime = getLocalTime()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-card pb-8" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <button onClick={onClose} className="text-muted-foreground">
            <X className="h-6 w-6" />
          </button>
          <span className="text-lg font-medium text-foreground">{label || "Select Time"}</span>
          <button onClick={handleConfirm} className="text-lg font-medium text-primary">
            Done
          </button>
        </div>

        {/* Time Display */}
        <div className="flex flex-col items-center gap-1 py-4">
          <div className="text-4xl font-light text-foreground tabular-nums">
            {hours.toString().padStart(2, "0")}:{minutes.toString().padStart(2, "0")}
          </div>
          <div className="text-sm text-muted-foreground">UTC</div>
          {timezoneOffset !== 0 && (
            <div className="text-sm text-muted-foreground">
              {localTime} (UTC{timezoneOffset >= 0 ? "+" : ""}
              {timezoneOffset})
            </div>
          )}
        </div>

        {/* NOW button */}
        <div className="flex justify-center pb-4">
          <button
            onClick={handleSetNow}
            className="rounded-full border border-primary px-4 py-1 text-sm font-medium text-primary"
          >
            NOW
          </button>
        </div>

        {/* Picker Wheels */}
        <div className="relative flex justify-center gap-1 px-4">
          {/* Hours wheel */}
          <div className="relative h-48 w-24 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-12 -translate-y-1/2 rounded-lg border border-border bg-muted/30" />
            <div
              ref={hoursRef}
              className="scrollbar-hide h-full snap-y snap-mandatory overflow-y-scroll py-[72px]"
              onScroll={(e) => {
                const target = e.target as HTMLDivElement
                const scrollTop = target.scrollTop
                const itemHeight = 48
                const selectedIndex = Math.round(scrollTop / itemHeight)
                if (selectedIndex >= 0 && selectedIndex <= 23) {
                  setHours(selectedIndex)
                }
              }}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <div
                  key={i}
                  data-hour={i}
                  className={`flex h-12 snap-center items-center justify-center text-2xl tabular-nums transition-all ${
                    hours === i ? "font-medium text-foreground" : "text-muted-foreground/50"
                  }`}
                >
                  {i.toString().padStart(2, "0")}
                </div>
              ))}
            </div>
          </div>

          {/* Separator */}
          <div className="flex h-48 items-center text-2xl font-medium text-foreground">:</div>

          {/* Minutes wheel */}
          <div className="relative h-48 w-24 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-12 -translate-y-1/2 rounded-lg border border-border bg-muted/30" />
            <div
              ref={minutesRef}
              className="scrollbar-hide h-full snap-y snap-mandatory overflow-y-scroll py-[72px]"
              onScroll={(e) => {
                const target = e.target as HTMLDivElement
                const scrollTop = target.scrollTop
                const itemHeight = 48
                const selectedIndex = Math.round(scrollTop / itemHeight)
                if (selectedIndex >= 0 && selectedIndex <= 59) {
                  setMinutes(selectedIndex)
                }
              }}
            >
              {Array.from({ length: 60 }, (_, i) => (
                <div
                  key={i}
                  data-minute={i}
                  className={`flex h-12 snap-center items-center justify-center text-2xl tabular-nums transition-all ${
                    minutes === i ? "font-medium text-foreground" : "text-muted-foreground/50"
                  }`}
                >
                  {i.toString().padStart(2, "0")}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
