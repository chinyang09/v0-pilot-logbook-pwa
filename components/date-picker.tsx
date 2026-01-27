"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { X, Keyboard } from "lucide-react"
import { WheelPicker, WheelPickerWrapper } from "@ncdai/react-wheel-picker"
import "@ncdai/react-wheel-picker/style.css"

interface DatePickerProps {
  isOpen?: boolean
  initialDate?: string // YYYY-MM-DD format
  onSelect?: (value: string) => void
  onClose: () => void
  label?: string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// Generate month options
const monthOptions = MONTHS.map((m, i) => ({
  value: i,
  label: m,
  textValue: MONTHS_FULL[i],
}))

export function DatePicker({
  isOpen = true,
  initialDate = "",
  onSelect,
  onClose,
  label,
}: DatePickerProps) {
  const [day, setDay] = useState(1)
  const [month, setMonth] = useState(0)
  const [year, setYear] = useState(new Date().getFullYear())
  const [isKeyboardMode, setIsKeyboardMode] = useState(false)
  const [keyboardValue, setKeyboardValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // Generate years array (current year - 5 to current year + 2)
  const currentYear = new Date().getFullYear()
  const years = useMemo(
    () => Array.from({ length: 10 }, (_, i) => currentYear - 5 + i),
    [currentYear]
  )

  const yearOptions = useMemo(
    () => years.map((y) => ({ value: y, label: y.toString() })),
    [years]
  )

  // Generate day options based on current month/year
  const daysInMonth = getDaysInMonth(year, month)
  const dayOptions = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => ({
        value: i + 1,
        label: (i + 1).toString().padStart(2, "0"),
      })),
    [daysInMonth]
  )

  // Parse initial value
  useEffect(() => {
    if (initialDate) {
      const parts = initialDate.split("-")
      if (parts.length === 3) {
        const y = Number.parseInt(parts[0], 10)
        const m = Number.parseInt(parts[1], 10) - 1 // 0-indexed
        const d = Number.parseInt(parts[2], 10)
        if (!Number.isNaN(y)) setYear(y)
        if (!Number.isNaN(m) && m >= 0 && m <= 11) setMonth(m)
        if (!Number.isNaN(d) && d >= 1) setDay(d)
      }
    } else {
      // Default to today
      const today = new Date()
      setYear(today.getFullYear())
      setMonth(today.getMonth())
      setDay(today.getDate())
    }
  }, [initialDate])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = ""
      }
    }
  }, [isOpen])

  // Adjust day if it exceeds days in selected month
  useEffect(() => {
    const maxDays = getDaysInMonth(year, month)
    if (day > maxDays) {
      setDay(maxDays)
    }
  }, [year, month, day])

  // Focus input when entering keyboard mode
  useEffect(() => {
    if (isKeyboardMode && inputRef.current) {
      inputRef.current.focus()
      setKeyboardValue(
        `${day.toString().padStart(2, "0")}/${(month + 1).toString().padStart(2, "0")}/${year}`
      )
    }
  }, [isKeyboardMode, day, month, year])

  const handleConfirm = useCallback(() => {
    let finalDay = day
    let finalMonth = month
    let finalYear = year

    if (isKeyboardMode) {
      // Parse keyboard input (DD/MM/YYYY or DD-MM-YYYY)
      const cleanValue = keyboardValue.replace(/[^0-9/\-]/g, "")
      const parts = cleanValue.split(/[/\-]/)

      if (parts.length === 3) {
        const parsedD = Number.parseInt(parts[0], 10)
        const parsedM = Number.parseInt(parts[1], 10) - 1
        const parsedY = Number.parseInt(parts[2], 10)

        if (!Number.isNaN(parsedD) && parsedD >= 1 && parsedD <= 31) finalDay = parsedD
        if (!Number.isNaN(parsedM) && parsedM >= 0 && parsedM <= 11) finalMonth = parsedM
        if (!Number.isNaN(parsedY) && parsedY >= 1900 && parsedY <= 2100) finalYear = parsedY

        // Validate day against month
        const maxDays = getDaysInMonth(finalYear, finalMonth)
        if (finalDay > maxDays) finalDay = maxDays
      }
    }

    const formatted = `${finalYear}-${(finalMonth + 1).toString().padStart(2, "0")}-${finalDay.toString().padStart(2, "0")}`
    onSelect?.(formatted)
    onClose()
  }, [day, month, year, isKeyboardMode, keyboardValue, onSelect, onClose])

  const handleSetToday = useCallback(() => {
    const today = new Date()
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setDay(today.getDate())
    if (isKeyboardMode) {
      setKeyboardValue(
        `${today.getDate().toString().padStart(2, "0")}/${(today.getMonth() + 1).toString().padStart(2, "0")}/${today.getFullYear()}`
      )
    }
  }, [isKeyboardMode])

  const toggleKeyboardMode = useCallback(() => {
    setIsKeyboardMode((prev) => !prev)
  }, [])

  // Get weekday for display
  const selectedDate = new Date(year, month, day)
  const weekday = WEEKDAYS[selectedDate.getDay()]

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
          <span className="text-lg font-semibold text-foreground">{label || "Select Date"}</span>
          <button
            onClick={handleConfirm}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            Done
          </button>
        </div>

        {/* Date Display */}
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
              placeholder="DD/MM/YYYY"
              className="w-44 border-b-2 border-primary bg-transparent text-center text-3xl font-light tabular-nums text-foreground outline-none"
              maxLength={10}
            />
          ) : (
            <div className="text-4xl font-extralight text-foreground">
              {weekday} {day} {MONTHS[month]} {year}
            </div>
          )}
          <div className="text-sm text-muted-foreground">UTC</div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-center gap-3 py-3">
          <button
            onClick={handleSetToday}
            className="rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary active:bg-primary/10"
          >
            TODAY
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
              {/* Day */}
              <WheelPicker
                options={dayOptions}
                value={day}
                onValueChange={(val) => setDay(val as number)}
                infinite
                optionItemHeight={44}
                classNames={{
                  optionItem: "text-2xl tabular-nums text-muted-foreground/60 font-medium",
                  highlightItem: "text-2xl tabular-nums text-foreground font-semibold",
                }}
              />

              {/* Month */}
              <WheelPicker
                options={monthOptions}
                value={month}
                onValueChange={(val) => setMonth(val as number)}
                infinite
                optionItemHeight={44}
                classNames={{
                  optionItem: "text-xl text-muted-foreground/60 font-medium",
                  highlightItem: "text-xl text-foreground font-semibold",
                }}
              />

              {/* Year */}
              <WheelPicker
                options={yearOptions}
                value={year}
                onValueChange={(val) => setYear(val as number)}
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
