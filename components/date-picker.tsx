"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { X } from "lucide-react"
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
  const [dayInput, setDayInput] = useState("")
  const [monthInput, setMonthInput] = useState("")
  const [yearInput, setYearInput] = useState("")
  const [focusedField, setFocusedField] = useState<"day" | "month" | "year" | null>(null)
  const dayInputRef = useRef<HTMLInputElement>(null)
  const monthInputRef = useRef<HTMLInputElement>(null)
  const yearInputRef = useRef<HTMLInputElement>(null)

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

  // Validate and clamp day value
  const validateDay = useCallback((value: string, currentMonth: number, currentYear: number): number => {
    const num = Number.parseInt(value, 10)
    if (Number.isNaN(num)) return day
    const maxDays = getDaysInMonth(currentYear, currentMonth)
    return Math.max(1, Math.min(maxDays, num))
  }, [day])

  // Validate and clamp month value (1-12 input, 0-11 stored)
  const validateMonth = useCallback((value: string): number => {
    const num = Number.parseInt(value, 10)
    if (Number.isNaN(num)) return month
    return Math.max(0, Math.min(11, num - 1)) // Convert 1-12 to 0-11
  }, [month])

  // Validate and clamp year value
  const validateYear = useCallback((value: string): number => {
    const num = Number.parseInt(value, 10)
    if (Number.isNaN(num)) return year
    const minYear = currentYear - 5
    const maxYear = currentYear + 4
    return Math.max(minYear, Math.min(maxYear, num))
  }, [year, currentYear])

  // Handle day input change
  const handleDayInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2)
    setDayInput(value)
    if (value.length > 0) {
      const validated = validateDay(value, month, year)
      setDay(validated)
    }
  }, [validateDay, month, year])

  // Handle month input change
  const handleMonthInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2)
    setMonthInput(value)
    if (value.length > 0) {
      const validated = validateMonth(value)
      setMonth(validated)
      // Also adjust day if needed
      const maxDays = getDaysInMonth(year, validated)
      if (day > maxDays) setDay(maxDays)
    }
  }, [validateMonth, year, day])

  // Handle year input change
  const handleYearInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 4)
    setYearInput(value)
    if (value.length === 4) {
      const validated = validateYear(value)
      setYear(validated)
      // Also adjust day if needed
      const maxDays = getDaysInMonth(validated, month)
      if (day > maxDays) setDay(maxDays)
    }
  }, [validateYear, month, day])

  // Handle input focus
  const handleDayFocus = useCallback(() => {
    setFocusedField("day")
    setDayInput(day.toString().padStart(2, "0"))
  }, [day])

  const handleMonthFocus = useCallback(() => {
    setFocusedField("month")
    setMonthInput((month + 1).toString().padStart(2, "0"))
  }, [month])

  const handleYearFocus = useCallback(() => {
    setFocusedField("year")
    setYearInput(year.toString())
  }, [year])

  // Handle input blur - validate final value
  const handleDayBlur = useCallback(() => {
    setFocusedField(null)
    if (dayInput) {
      setDay(validateDay(dayInput, month, year))
    }
    setDayInput("")
  }, [dayInput, validateDay, month, year])

  const handleMonthBlur = useCallback(() => {
    setFocusedField(null)
    if (monthInput) {
      const validated = validateMonth(monthInput)
      setMonth(validated)
      const maxDays = getDaysInMonth(year, validated)
      if (day > maxDays) setDay(maxDays)
    }
    setMonthInput("")
  }, [monthInput, validateMonth, year, day])

  const handleYearBlur = useCallback(() => {
    setFocusedField(null)
    if (yearInput && yearInput.length === 4) {
      const validated = validateYear(yearInput)
      setYear(validated)
      const maxDays = getDaysInMonth(validated, month)
      if (day > maxDays) setDay(maxDays)
    }
    setYearInput("")
  }, [yearInput, validateYear, month, day])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: "day" | "month" | "year") => {
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault()
      if (field === "day") {
        handleDayBlur()
        monthInputRef.current?.focus()
      } else if (field === "month") {
        handleMonthBlur()
        yearInputRef.current?.focus()
      } else {
        handleYearBlur()
      }
    }
  }, [handleDayBlur, handleMonthBlur, handleYearBlur])

  const handleConfirm = useCallback(() => {
    const formatted = `${year}-${(month + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
    onSelect?.(formatted)
    onClose()
  }, [day, month, year, onSelect, onClose])

  const handleSetToday = useCallback(() => {
    const today = new Date()
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setDay(today.getDate())
  }, [])

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
          <span className="text-sm font-medium text-foreground">{label || "Select Date"}</span>
          <button
            onClick={handleConfirm}
            className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            Done
          </button>
        </div>

        {/* Wheel Picker with Inline Inputs */}
        <div className="relative px-6 py-2">
          {/* iOS-style highlight bar */}
          <div className="pointer-events-none absolute left-6 right-6 top-1/2 z-0 h-11 -translate-y-1/2 rounded-xl bg-muted/40" />

          {/* Focusable inputs overlay */}
          <div className="pointer-events-none absolute inset-x-6 top-1/2 z-20 flex h-11 -translate-y-1/2 items-center justify-between px-2">
            {/* Day input */}
            <div className="flex flex-1 justify-center">
              <input
                ref={dayInputRef}
                type="text"
                inputMode="numeric"
                value={focusedField === "day" ? dayInput : day.toString().padStart(2, "0")}
                onChange={handleDayInputChange}
                onFocus={handleDayFocus}
                onBlur={handleDayBlur}
                onKeyDown={(e) => handleKeyDown(e, "day")}
                className="pointer-events-auto w-12 bg-transparent text-center text-xl font-semibold tabular-nums text-foreground outline-none focus:bg-primary/10 focus:rounded-lg"
                maxLength={2}
              />
            </div>

            {/* Month input (display as text) */}
            <div className="flex flex-1 justify-center">
              <input
                ref={monthInputRef}
                type="text"
                inputMode="numeric"
                value={focusedField === "month" ? monthInput : MONTHS[month]}
                onChange={handleMonthInputChange}
                onFocus={handleMonthFocus}
                onBlur={handleMonthBlur}
                onKeyDown={(e) => handleKeyDown(e, "month")}
                placeholder="MM"
                className="pointer-events-auto w-14 bg-transparent text-center text-xl font-semibold text-foreground outline-none focus:bg-primary/10 focus:rounded-lg"
                maxLength={2}
              />
            </div>

            {/* Year input */}
            <div className="flex flex-1 justify-center">
              <input
                ref={yearInputRef}
                type="text"
                inputMode="numeric"
                value={focusedField === "year" ? yearInput : year.toString()}
                onChange={handleYearInputChange}
                onFocus={handleYearFocus}
                onBlur={handleYearBlur}
                onKeyDown={(e) => handleKeyDown(e, "year")}
                className="pointer-events-auto w-16 bg-transparent text-center text-xl font-semibold tabular-nums text-foreground outline-none focus:bg-primary/10 focus:rounded-lg"
                maxLength={4}
              />
            </div>
          </div>

          <WheelPickerWrapper className="h-[180px]">
            {/* Day */}
            <WheelPicker
              options={dayOptions}
              value={day}
              onValueChange={(val) => setDay(val as number)}
              infinite
              optionItemHeight={44}
              classNames={{
                optionItem: "text-lg tabular-nums text-muted-foreground/40 font-medium",
                highlightItem: "text-lg tabular-nums text-transparent font-semibold",
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
                optionItem: "text-lg text-muted-foreground/40 font-medium",
                highlightItem: "text-lg text-transparent font-semibold",
              }}
            />

            {/* Year */}
            <WheelPicker
              options={yearOptions}
              value={year}
              onValueChange={(val) => setYear(val as number)}
              optionItemHeight={44}
              classNames={{
                optionItem: "text-lg tabular-nums text-muted-foreground/40 font-medium",
                highlightItem: "text-lg tabular-nums text-transparent font-semibold",
              }}
            />
          </WheelPickerWrapper>
        </div>

        {/* TODAY button */}
        <div className="flex justify-center pt-2 pb-1">
          <button
            onClick={handleSetToday}
            className="rounded-full border border-primary/50 px-6 py-1.5 text-sm font-medium text-primary active:bg-primary/10"
          >
            TODAY
          </button>
        </div>
      </div>
    </div>
  )
}
