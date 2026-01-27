"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { X } from "lucide-react"
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
  const [hourInput, setHourInput] = useState("")
  const [minuteInput, setMinuteInput] = useState("")
  const [focusedField, setFocusedField] = useState<"hour" | "minute" | null>(null)
  const hourInputRef = useRef<HTMLInputElement>(null)
  const minuteInputRef = useRef<HTMLInputElement>(null)

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

  // Validate and clamp hour value
  const validateHour = useCallback((value: string): number => {
    const num = Number.parseInt(value, 10)
    if (Number.isNaN(num)) return hours
    return Math.max(0, Math.min(23, num))
  }, [hours])

  // Validate and clamp minute value
  const validateMinute = useCallback((value: string): number => {
    const num = Number.parseInt(value, 10)
    if (Number.isNaN(num)) return minutes
    return Math.max(0, Math.min(59, num))
  }, [minutes])

  // Handle hour input change
  const handleHourInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2)
    setHourInput(value)
    if (value.length > 0) {
      const validated = validateHour(value)
      setHours(validated)
    }
  }, [validateHour])

  // Handle minute input change
  const handleMinuteInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2)
    setMinuteInput(value)
    if (value.length > 0) {
      const validated = validateMinute(value)
      setMinutes(validated)
    }
  }, [validateMinute])

  // Handle input focus
  const handleHourFocus = useCallback(() => {
    setFocusedField("hour")
    setHourInput(hours.toString().padStart(2, "0"))
  }, [hours])

  const handleMinuteFocus = useCallback(() => {
    setFocusedField("minute")
    setMinuteInput(minutes.toString().padStart(2, "0"))
  }, [minutes])

  // Handle input blur - validate final value
  const handleHourBlur = useCallback(() => {
    setFocusedField(null)
    if (hourInput) {
      setHours(validateHour(hourInput))
    }
    setHourInput("")
  }, [hourInput, validateHour])

  const handleMinuteBlur = useCallback(() => {
    setFocusedField(null)
    if (minuteInput) {
      setMinutes(validateMinute(minuteInput))
    }
    setMinuteInput("")
  }, [minuteInput, validateMinute])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: "hour" | "minute") => {
    if (e.key === "Enter") {
      if (field === "hour") {
        handleHourBlur()
        minuteInputRef.current?.focus()
      } else {
        handleMinuteBlur()
      }
    } else if (e.key === "Tab" && !e.shiftKey && field === "hour") {
      e.preventDefault()
      handleHourBlur()
      minuteInputRef.current?.focus()
    }
  }, [handleHourBlur, handleMinuteBlur])

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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-card pb-6 animate-in slide-in-from-bottom duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted/50"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-foreground">{label || "Select Time"}</span>
            {timezoneOffset !== 0 && (
              <span className="text-xs text-muted-foreground">
                Local: {getLocalTime()} (UTC{timezoneOffset >= 0 ? "+" : ""}{timezoneOffset})
              </span>
            )}
          </div>
          <button
            onClick={handleConfirm}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            Done
          </button>
        </div>

        {/* Wheel Picker with Inline Inputs */}
        <div className="relative px-8 py-2">
          {/* iOS-style highlight bar */}
          <div className="pointer-events-none absolute left-8 right-8 top-1/2 z-0 h-11 -translate-y-1/2 rounded-xl bg-muted/40" />

          {/* Focusable inputs overlay */}
          <div className="pointer-events-none absolute inset-x-8 top-1/2 z-20 flex h-11 -translate-y-1/2 items-center justify-center">
            <input
              ref={hourInputRef}
              type="text"
              inputMode="numeric"
              value={focusedField === "hour" ? hourInput : hours.toString().padStart(2, "0")}
              onChange={handleHourInputChange}
              onFocus={handleHourFocus}
              onBlur={handleHourBlur}
              onKeyDown={(e) => handleKeyDown(e, "hour")}
              className="pointer-events-auto w-14 bg-transparent text-center text-2xl font-semibold tabular-nums text-foreground outline-none focus:bg-primary/10 focus:rounded-lg"
              maxLength={2}
            />
            <span className="px-1 text-2xl font-semibold text-foreground">:</span>
            <input
              ref={minuteInputRef}
              type="text"
              inputMode="numeric"
              value={focusedField === "minute" ? minuteInput : minutes.toString().padStart(2, "0")}
              onChange={handleMinuteInputChange}
              onFocus={handleMinuteFocus}
              onBlur={handleMinuteBlur}
              onKeyDown={(e) => handleKeyDown(e, "minute")}
              className="pointer-events-auto w-14 bg-transparent text-center text-2xl font-semibold tabular-nums text-foreground outline-none focus:bg-primary/10 focus:rounded-lg"
              maxLength={2}
            />
          </div>

          <WheelPickerWrapper className="h-[180px]">
            <WheelPicker
              options={hourOptions}
              value={hours}
              onValueChange={(val) => setHours(val as number)}
              infinite
              optionItemHeight={44}
              classNames={{
                optionItem: "text-xl tabular-nums text-muted-foreground/40 font-medium",
                highlightItem: "text-xl tabular-nums text-transparent font-semibold",
              }}
            />

            {/* Spacer for colon alignment */}
            <div className="w-8 flex-none" />

            <WheelPicker
              options={minuteOptions}
              value={minutes}
              onValueChange={(val) => setMinutes(val as number)}
              infinite
              optionItemHeight={44}
              classNames={{
                optionItem: "text-xl tabular-nums text-muted-foreground/40 font-medium",
                highlightItem: "text-xl tabular-nums text-transparent font-semibold",
              }}
            />
          </WheelPickerWrapper>
        </div>

        {/* NOW button */}
        <div className="flex justify-center pt-2 pb-1">
          <button
            onClick={handleSetNow}
            className="rounded-full border border-primary/50 px-6 py-1.5 text-sm font-medium text-primary active:bg-primary/10"
          >
            NOW
          </button>
        </div>
      </div>
    </div>
  )
}
