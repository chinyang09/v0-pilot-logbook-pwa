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

  // Focus input when field is activated
  useEffect(() => {
    if (focusedField === "hour" && hourInputRef.current) {
      hourInputRef.current.focus()
      hourInputRef.current.select()
    } else if (focusedField === "minute" && minuteInputRef.current) {
      minuteInputRef.current.focus()
      minuteInputRef.current.select()
    }
  }, [focusedField])

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

  // Handle tapping on hour to edit
  const handleHourTap = useCallback(() => {
    setFocusedField("hour")
    setHourInput(hours.toString().padStart(2, "0"))
  }, [hours])

  // Handle tapping on minute to edit
  const handleMinuteTap = useCallback(() => {
    setFocusedField("minute")
    setMinuteInput(minutes.toString().padStart(2, "0"))
  }, [minutes])

  // Handle input blur - validate final value
  const handleHourBlur = useCallback(() => {
    if (hourInput) {
      setHours(validateHour(hourInput))
    }
    setHourInput("")
    setFocusedField(null)
  }, [hourInput, validateHour])

  const handleMinuteBlur = useCallback(() => {
    if (minuteInput) {
      setMinutes(validateMinute(minuteInput))
    }
    setMinuteInput("")
    setFocusedField(null)
  }, [minuteInput, validateMinute])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: "hour" | "minute") => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      if (field === "hour") {
        if (hourInput) setHours(validateHour(hourInput))
        setHourInput("")
        setFocusedField("minute")
        setMinuteInput(minutes.toString().padStart(2, "0"))
      } else {
        handleMinuteBlur()
      }
    } else if (e.key === "Escape") {
      setHourInput("")
      setMinuteInput("")
      setFocusedField(null)
    }
  }, [hourInput, validateHour, minutes, handleMinuteBlur])

  const handleConfirm = useCallback(() => {
    const formatted = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
    onSelect?.(formatted)
    onClose()
  }, [hours, minutes, onSelect, onClose])

  const handleSetNow = useCallback(() => {
    const now = new Date()
    setHours(now.getUTCHours())
    setMinutes(now.getUTCMinutes())
    setFocusedField(null)
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
        className="w-full max-w-md rounded-t-3xl bg-card pb-safe animate-in slide-in-from-bottom duration-300"
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

        {/* Wheel Picker */}
        <div className="relative px-8 pt-2 pb-4">
          {/* iOS-style highlight bar */}
          <div className="pointer-events-none absolute left-8 right-8 top-1/2 z-10 h-11 -translate-y-1/2 rounded-xl bg-muted/50" />

          {/* Tap areas for keyboard input */}
          <div className="absolute inset-x-8 top-1/2 z-30 flex h-11 -translate-y-1/2 items-center justify-center gap-1">
            {/* Hour tap area / input */}
            <div className="flex h-full flex-1 items-center justify-end pr-1">
              {focusedField === "hour" ? (
                <input
                  ref={hourInputRef}
                  type="text"
                  inputMode="numeric"
                  value={hourInput}
                  onChange={handleHourInputChange}
                  onBlur={handleHourBlur}
                  onKeyDown={(e) => handleKeyDown(e, "hour")}
                  className="w-14 rounded-lg bg-primary/20 text-center text-2xl font-semibold tabular-nums text-foreground outline-none"
                  maxLength={2}
                />
              ) : (
                <button
                  onClick={handleHourTap}
                  className="flex h-full w-14 items-center justify-center rounded-lg text-2xl font-semibold tabular-nums text-transparent active:bg-primary/10"
                >
                  {hours.toString().padStart(2, "0")}
                </button>
              )}
            </div>

            <span className="text-2xl font-semibold text-foreground">:</span>

            {/* Minute tap area / input */}
            <div className="flex h-full flex-1 items-center justify-start pl-1">
              {focusedField === "minute" ? (
                <input
                  ref={minuteInputRef}
                  type="text"
                  inputMode="numeric"
                  value={minuteInput}
                  onChange={handleMinuteInputChange}
                  onBlur={handleMinuteBlur}
                  onKeyDown={(e) => handleKeyDown(e, "minute")}
                  className="w-14 rounded-lg bg-primary/20 text-center text-2xl font-semibold tabular-nums text-foreground outline-none"
                  maxLength={2}
                />
              ) : (
                <button
                  onClick={handleMinuteTap}
                  className="flex h-full w-14 items-center justify-center rounded-lg text-2xl font-semibold tabular-nums text-transparent active:bg-primary/10"
                >
                  {minutes.toString().padStart(2, "0")}
                </button>
              )}
            </div>
          </div>

          <WheelPickerWrapper className="h-[200px]">
            <WheelPicker
              options={hourOptions}
              value={hours}
              onValueChange={(val) => {
                setHours(val as number)
                setFocusedField(null)
              }}
              infinite
              optionItemHeight={44}
              classNames={{
                optionItem: "text-xl tabular-nums text-muted-foreground/50 font-medium",
                highlightItem: "text-2xl tabular-nums text-foreground font-semibold",
              }}
            />

            {/* Spacer for colon alignment */}
            <div className="w-6 flex-none" />

            <WheelPicker
              options={minuteOptions}
              value={minutes}
              onValueChange={(val) => {
                setMinutes(val as number)
                setFocusedField(null)
              }}
              infinite
              optionItemHeight={44}
              classNames={{
                optionItem: "text-xl tabular-nums text-muted-foreground/50 font-medium",
                highlightItem: "text-2xl tabular-nums text-foreground font-semibold",
              }}
            />
          </WheelPickerWrapper>
        </div>

        {/* NOW button */}
        <div className="flex justify-center pb-6">
          <button
            onClick={handleSetNow}
            className="rounded-full bg-primary/10 px-8 py-2 text-sm font-semibold text-primary active:bg-primary/20"
          >
            NOW
          </button>
        </div>
      </div>
    </div>
  )
}
