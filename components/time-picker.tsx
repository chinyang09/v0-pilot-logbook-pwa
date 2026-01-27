"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { X, Keyboard } from "lucide-react"
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
  const [isKeyboardMode, setIsKeyboardMode] = useState(false)
  const [keyboardValue, setKeyboardValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Focus input when entering keyboard mode
  useEffect(() => {
    if (isKeyboardMode && inputRef.current) {
      inputRef.current.focus()
      setKeyboardValue(`${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`)
    }
  }, [isKeyboardMode, hours, minutes])

  const handleConfirm = useCallback(() => {
    if (isKeyboardMode) {
      // Parse keyboard input
      const cleanValue = keyboardValue.replace(/[^0-9:]/g, "")
      let h = hours
      let m = minutes

      if (cleanValue.includes(":")) {
        const parts = cleanValue.split(":")
        const parsedH = Number.parseInt(parts[0], 10)
        const parsedM = Number.parseInt(parts[1], 10)
        if (!Number.isNaN(parsedH) && parsedH >= 0 && parsedH <= 23) h = parsedH
        if (!Number.isNaN(parsedM) && parsedM >= 0 && parsedM <= 59) m = parsedM
      } else if (cleanValue.length <= 2) {
        const parsedH = Number.parseInt(cleanValue, 10)
        if (!Number.isNaN(parsedH) && parsedH >= 0 && parsedH <= 23) h = parsedH
        m = 0
      } else if (cleanValue.length <= 4) {
        const parsedH = Number.parseInt(cleanValue.slice(0, 2), 10)
        const parsedM = Number.parseInt(cleanValue.slice(2), 10)
        if (!Number.isNaN(parsedH) && parsedH >= 0 && parsedH <= 23) h = parsedH
        if (!Number.isNaN(parsedM) && parsedM >= 0 && parsedM <= 59) m = parsedM
      }

      const formatted = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
      onSelect?.(formatted)
    } else {
      const formatted = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
      onSelect?.(formatted)
    }
    onClose()
  }, [hours, minutes, isKeyboardMode, keyboardValue, onSelect, onClose])

  const handleSetNow = useCallback(() => {
    const now = new Date()
    setHours(now.getUTCHours())
    setMinutes(now.getUTCMinutes())
    if (isKeyboardMode) {
      setKeyboardValue(`${now.getUTCHours().toString().padStart(2, "0")}:${now.getUTCMinutes().toString().padStart(2, "0")}`)
    }
  }, [isKeyboardMode])

  const toggleKeyboardMode = useCallback(() => {
    setIsKeyboardMode((prev) => !prev)
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
      <div
        className="w-full max-w-md rounded-t-3xl bg-card pb-8 animate-in slide-in-from-bottom duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4">
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted/50"
          >
            <X className="h-6 w-6" />
          </button>
          <span className="text-lg font-semibold text-foreground">{label || "Select Time"}</span>
          <button
            onClick={handleConfirm}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            Done
          </button>
        </div>

        {/* Time Display */}
        <div className="flex flex-col items-center gap-1 py-2">
          {isKeyboardMode ? (
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={keyboardValue}
              onChange={(e) => setKeyboardValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm()
              }}
              placeholder="HH:MM"
              className="w-32 border-b-2 border-primary bg-transparent text-center text-4xl font-light tabular-nums text-foreground outline-none"
              maxLength={5}
            />
          ) : (
            <div className="text-5xl font-extralight text-foreground tabular-nums">
              {hours.toString().padStart(2, "0")}:{minutes.toString().padStart(2, "0")}
            </div>
          )}
          <div className="text-sm text-muted-foreground">UTC</div>
          {timezoneOffset !== 0 && (
            <div className="text-sm text-muted-foreground">
              {localTime} (UTC{timezoneOffset >= 0 ? "+" : ""}{timezoneOffset})
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-center gap-3 py-3">
          <button
            onClick={handleSetNow}
            className="rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary active:bg-primary/10"
          >
            NOW
          </button>
          <button
            onClick={toggleKeyboardMode}
            className={`flex items-center gap-2 rounded-full border px-5 py-2 text-sm font-semibold active:opacity-80 ${
              isKeyboardMode
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/30 text-muted-foreground"
            }`}
          >
            <Keyboard className="h-4 w-4" />
            {isKeyboardMode ? "Wheel" : "Type"}
          </button>
        </div>

        {/* Wheel Picker */}
        {!isKeyboardMode && (
          <div className="relative px-6 py-4">
            {/* iOS-style highlight bar */}
            <div className="pointer-events-none absolute left-6 right-6 top-1/2 z-10 h-11 -translate-y-1/2 rounded-xl bg-muted/40" />

            <WheelPickerWrapper className="h-[200px]">
              <WheelPicker
                options={hourOptions}
                value={hours}
                onValueChange={(val) => setHours(val as number)}
                infinite
                optionItemHeight={44}
                classNames={{
                  optionItem: "text-2xl tabular-nums text-muted-foreground/60 font-medium",
                  highlightItem: "text-2xl tabular-nums text-foreground font-semibold",
                }}
              />

              {/* Separator */}
              <div className="flex items-center justify-center px-1">
                <span className="text-3xl font-semibold text-foreground">:</span>
              </div>

              <WheelPicker
                options={minuteOptions}
                value={minutes}
                onValueChange={(val) => setMinutes(val as number)}
                infinite
                optionItemHeight={44}
                classNames={{
                  optionItem: "text-2xl tabular-nums text-muted-foreground/60 font-medium",
                  highlightItem: "text-2xl tabular-nums text-foreground font-semibold",
                }}
              />
            </WheelPickerWrapper>
          </div>
        )}
      </div>
    </div>
  )
}
