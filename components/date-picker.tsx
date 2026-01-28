"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
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
const ITEM_HEIGHT = 44
const VISIBLE_COUNT = 20

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
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card animate-in slide-in-from-bottom duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Cancel | TODAY | Save */}
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
              onClick={handleSetToday}
              className="text-sm font-medium text-primary active:opacity-70"
            >
              TODAY
            </button>
          </div>

          <button
            onClick={handleConfirm}
            className="text-sm font-semibold text-primary active:opacity-70"
          >
            Save
          </button>
        </div>

        {/* Wheel Picker */}
        <div className="relative px-4 py-4">
          {/* Highlight bar */}
          <div
            className="pointer-events-none absolute left-4 right-4 top-1/2 z-0 -translate-y-1/2 rounded-lg bg-muted/40"
            style={{ height: ITEM_HEIGHT }}
          />

          <WheelPickerWrapper>
            {/* Day */}
            <div className="flex-1">
              <WheelPicker
                options={dayOptions}
                value={day}
                onValueChange={(val) => setDay(val as number)}
                infinite
                optionItemHeight={ITEM_HEIGHT}
                visibleCount={VISIBLE_COUNT}
                classNames={{
                  optionItem: "text-lg tabular-nums text-muted-foreground/50 font-medium",
                  highlightItem: "text-xl tabular-nums text-foreground font-semibold",
                }}
              />
            </div>

            {/* Month */}
            <div className="flex-1">
              <WheelPicker
                options={monthOptions}
                value={month}
                onValueChange={(val) => setMonth(val as number)}
                infinite
                optionItemHeight={ITEM_HEIGHT}
                visibleCount={VISIBLE_COUNT}
                classNames={{
                  optionItem: "text-lg text-muted-foreground/50 font-medium",
                  highlightItem: "text-xl text-foreground font-semibold",
                }}
              />
            </div>

            {/* Year */}
            <div className="flex-1">
              <WheelPicker
                options={yearOptions}
                value={year}
                onValueChange={(val) => setYear(val as number)}
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
