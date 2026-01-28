"use client"

import React from "react"
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

// Constants for wheel sizing
// visibleCount must be a multiple of 4 - it controls how many items render in the 3D perspective
// The actual visible area is determined by the container height
const ITEM_HEIGHT = 44
const VISIBLE_COUNT = 20 // Render plenty of items for smooth scrolling
const WHEEL_HEIGHT = ITEM_HEIGHT * 7 // Show 7 items (3 above, center, 3 below) = 308px

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

  // Generate years array (current year - 5 to current year + 4)
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

  // Focus input when field is activated
  useEffect(() => {
    if (focusedField === "day" && dayInputRef.current) {
      dayInputRef.current.focus()
      dayInputRef.current.select()
    } else if (focusedField === "month" && monthInputRef.current) {
      monthInputRef.current.focus()
      monthInputRef.current.select()
    } else if (focusedField === "year" && yearInputRef.current) {
      yearInputRef.current.focus()
      yearInputRef.current.select()
    }
  }, [focusedField])

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

  // Handle input changes
  const handleDayInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2)
    setDayInput(value)
    if (value.length > 0) {
      const validated = validateDay(value, month, year)
      setDay(validated)
    }
  }, [validateDay, month, year])

  const handleMonthInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 2)
    setMonthInput(value)
    if (value.length > 0) {
      const validated = validateMonth(value)
      setMonth(validated)
      const maxDays = getDaysInMonth(year, validated)
      if (day > maxDays) setDay(maxDays)
    }
  }, [validateMonth, year, day])

  const handleYearInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 4)
    setYearInput(value)
    if (value.length === 4) {
      const validated = validateYear(value)
      setYear(validated)
      const maxDays = getDaysInMonth(validated, month)
      if (day > maxDays) setDay(maxDays)
    }
  }, [validateYear, month, day])

  // Handle tapping to edit
  const handleDayTap = useCallback(() => {
    setFocusedField("day")
    setDayInput(day.toString().padStart(2, "0"))
  }, [day])

  const handleMonthTap = useCallback(() => {
    setFocusedField("month")
    setMonthInput((month + 1).toString().padStart(2, "0"))
  }, [month])

  const handleYearTap = useCallback(() => {
    setFocusedField("year")
    setYearInput(year.toString())
  }, [year])

  // Handle input blur
  const handleDayBlur = useCallback(() => {
    if (dayInput) {
      setDay(validateDay(dayInput, month, year))
    }
    setDayInput("")
    setFocusedField(null)
  }, [dayInput, validateDay, month, year])

  const handleMonthBlur = useCallback(() => {
    if (monthInput) {
      const validated = validateMonth(monthInput)
      setMonth(validated)
      const maxDays = getDaysInMonth(year, validated)
      if (day > maxDays) setDay(maxDays)
    }
    setMonthInput("")
    setFocusedField(null)
  }, [monthInput, validateMonth, year, day])

  const handleYearBlur = useCallback(() => {
    if (yearInput && yearInput.length === 4) {
      const validated = validateYear(yearInput)
      setYear(validated)
      const maxDays = getDaysInMonth(validated, month)
      if (day > maxDays) setDay(maxDays)
    }
    setYearInput("")
    setFocusedField(null)
  }, [yearInput, validateYear, month, day])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: "day" | "month" | "year") => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      if (field === "day") {
        if (dayInput) setDay(validateDay(dayInput, month, year))
        setDayInput("")
        setFocusedField("month")
        setMonthInput((month + 1).toString().padStart(2, "0"))
      } else if (field === "month") {
        if (monthInput) {
          const validated = validateMonth(monthInput)
          setMonth(validated)
        }
        setMonthInput("")
        setFocusedField("year")
        setYearInput(year.toString())
      } else {
        handleYearBlur()
      }
    } else if (e.key === "Escape") {
      setDayInput("")
      setMonthInput("")
      setYearInput("")
      setFocusedField(null)
    }
  }, [dayInput, validateDay, month, year, monthInput, validateMonth, handleYearBlur])

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
    setFocusedField(null)
  }, [])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-card animate-in slide-in-from-bottom duration-300"
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

        {/* Wheel Picker */}
        <div className="relative px-4" style={{ height: WHEEL_HEIGHT }}>
          <WheelPickerWrapper className="h-full">
            {/* Day */}
            <WheelPicker
              options={dayOptions}
              value={day}
              onValueChange={(val) => {
                setDay(val as number)
                if (focusedField === "day") setFocusedField(null)
              }}
              onTap={handleDayTap}
              infinite
              optionItemHeight={ITEM_HEIGHT}
              visibleCount={VISIBLE_COUNT}
              classNames={{
                optionItem: "text-lg tabular-nums text-muted-foreground/50 font-medium",
                highlightWrapper: "rounded-xl bg-muted/40",
                highlightItem: "text-xl tabular-nums text-foreground font-semibold",
              }}
            />

            {/* Month */}
            <WheelPicker
              options={monthOptions}
              value={month}
              onValueChange={(val) => {
                setMonth(val as number)
                if (focusedField === "month") setFocusedField(null)
              }}
              onTap={handleMonthTap}
              infinite
              optionItemHeight={ITEM_HEIGHT}
              visibleCount={VISIBLE_COUNT}
              classNames={{
                optionItem: "text-lg text-muted-foreground/50 font-medium",
                highlightWrapper: "rounded-xl bg-muted/40",
                highlightItem: "text-xl text-foreground font-semibold",
              }}
            />

            {/* Year */}
            <WheelPicker
              options={yearOptions}
              value={year}
              onValueChange={(val) => {
                setYear(val as number)
                if (focusedField === "year") setFocusedField(null)
              }}
              onTap={handleYearTap}
              optionItemHeight={ITEM_HEIGHT}
              visibleCount={VISIBLE_COUNT}
              classNames={{
                optionItem: "text-lg tabular-nums text-muted-foreground/50 font-medium",
                highlightWrapper: "rounded-xl bg-muted/40",
                highlightItem: "text-xl tabular-nums text-foreground font-semibold",
              }}
            />
          </WheelPickerWrapper>

          {/* Input overlays - only shown when focused */}
          {focusedField === "day" && (
            <div
              className="absolute left-4 top-1/2 z-30 flex -translate-y-1/2 items-center justify-center"
              style={{ width: "33.33%", height: ITEM_HEIGHT }}
            >
              <input
                ref={dayInputRef}
                type="text"
                inputMode="numeric"
                value={dayInput}
                onChange={handleDayInputChange}
                onBlur={handleDayBlur}
                onKeyDown={(e) => handleKeyDown(e, "day")}
                className="w-14 rounded-lg bg-card text-center text-xl font-semibold tabular-nums text-foreground outline-none ring-2 ring-primary"
                style={{ height: ITEM_HEIGHT }}
                maxLength={2}
              />
            </div>
          )}

          {focusedField === "month" && (
            <div
              className="absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ width: "33.33%", height: ITEM_HEIGHT }}
            >
              <input
                ref={monthInputRef}
                type="text"
                inputMode="numeric"
                value={monthInput}
                onChange={handleMonthInputChange}
                onBlur={handleMonthBlur}
                onKeyDown={(e) => handleKeyDown(e, "month")}
                placeholder="MM"
                className="w-14 rounded-lg bg-card text-center text-xl font-semibold text-foreground outline-none ring-2 ring-primary"
                style={{ height: ITEM_HEIGHT }}
                maxLength={2}
              />
            </div>
          )}

          {focusedField === "year" && (
            <div
              className="absolute right-4 top-1/2 z-30 flex -translate-y-1/2 items-center justify-center"
              style={{ width: "33.33%", height: ITEM_HEIGHT }}
            >
              <input
                ref={yearInputRef}
                type="text"
                inputMode="numeric"
                value={yearInput}
                onChange={handleYearInputChange}
                onBlur={handleYearBlur}
                onKeyDown={(e) => handleKeyDown(e, "year")}
                className="w-20 rounded-lg bg-card text-center text-xl font-semibold tabular-nums text-foreground outline-none ring-2 ring-primary"
                style={{ height: ITEM_HEIGHT }}
                maxLength={4}
              />
            </div>
          )}
        </div>

        {/* TODAY button */}
        <div className="flex justify-center py-4">
          <button
            onClick={handleSetToday}
            className="rounded-full bg-primary/10 px-8 py-2 text-sm font-semibold text-primary active:bg-primary/20"
          >
            TODAY
          </button>
        </div>
      </div>
    </div>
  )
}
