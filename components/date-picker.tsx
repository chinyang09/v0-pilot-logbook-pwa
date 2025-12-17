"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X } from "lucide-react"

interface DatePickerProps {
  isOpen?: boolean
  initialDate?: string // YYYY-MM-DD format
  onSelect?: (value: string) => void
  onClose: () => void
  label?: string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function DatePicker({ isOpen = true, initialDate = "", onSelect, onClose, label }: DatePickerProps) {
  const [day, setDay] = useState(1)
  const [month, setMonth] = useState(0)
  const [year, setYear] = useState(new Date().getFullYear())
  const dayRef = useRef<HTMLDivElement>(null)
  const monthRef = useRef<HTMLDivElement>(null)
  const yearRef = useRef<HTMLDivElement>(null)

  // Generate years array (current year - 5 to current year + 2)
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i)

  // Parse initial value
  useEffect(() => {
    if (initialDate) {
      const parts = initialDate.split("-")
      if (parts.length === 3) {
        const y = Number.parseInt(parts[0], 10)
        const m = Number.parseInt(parts[1], 10) - 1 // 0-indexed
        const d = Number.parseInt(parts[2], 10)
        if (!Number.isNaN(y)) setYear(y)
        if (!Number.isNaN(m)) setMonth(m)
        if (!Number.isNaN(d)) setDay(d)
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

  // Scroll to selected values on mount
  useEffect(() => {
    if (dayRef.current) {
      const dayItem = dayRef.current.querySelector(`[data-day="${day}"]`)
      dayItem?.scrollIntoView({ block: "center", behavior: "instant" })
    }
    if (monthRef.current) {
      const monthItem = monthRef.current.querySelector(`[data-month="${month}"]`)
      monthItem?.scrollIntoView({ block: "center", behavior: "instant" })
    }
    if (yearRef.current) {
      const yearItem = yearRef.current.querySelector(`[data-year="${year}"]`)
      yearItem?.scrollIntoView({ block: "center", behavior: "instant" })
    }
  }, [day, month, year])

  // Adjust day if it exceeds days in selected month
  useEffect(() => {
    const maxDays = getDaysInMonth(year, month)
    if (day > maxDays) {
      setDay(maxDays)
    }
  }, [year, month, day])

  const daysInMonth = getDaysInMonth(year, month)

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

  // Get weekday for display
  const selectedDate = new Date(year, month, day)
  const weekday = WEEKDAYS[selectedDate.getDay()]

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-card pb-8" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <button onClick={onClose} className="text-muted-foreground">
            <X className="h-6 w-6" />
          </button>
          <span className="text-lg font-medium text-foreground">{label || "Select Date"}</span>
          <button onClick={handleConfirm} className="text-lg font-medium text-primary">
            Done
          </button>
        </div>

        {/* Date Display */}
        <div className="flex flex-col items-center gap-1 py-4">
          <div className="text-4xl font-light text-foreground">
            {weekday} {day} {MONTHS[month]} {year}
          </div>
          <div className="text-sm text-muted-foreground">UTC</div>
        </div>

        {/* TODAY button */}
        <div className="flex justify-center pb-4">
          <button
            onClick={handleSetToday}
            className="rounded-full border border-primary px-4 py-1 text-sm font-medium text-primary"
          >
            TODAY
          </button>
        </div>

        {/* Picker Wheels */}
        <div className="relative flex justify-center gap-1 px-4">
          {/* Day wheel */}
          <div className="relative h-48 w-16 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-12 -translate-y-1/2 rounded-lg border border-border bg-muted/30" />
            <div
              ref={dayRef}
              className="scrollbar-hide h-full snap-y snap-mandatory overflow-y-scroll py-[72px]"
              onScroll={(e) => {
                const target = e.target as HTMLDivElement
                const scrollTop = target.scrollTop
                const itemHeight = 48
                const selectedIndex = Math.round(scrollTop / itemHeight)
                if (selectedIndex >= 0 && selectedIndex < daysInMonth) {
                  setDay(selectedIndex + 1)
                }
              }}
            >
              {Array.from({ length: daysInMonth }, (_, i) => (
                <div
                  key={i + 1}
                  data-day={i + 1}
                  className={`flex h-12 snap-center items-center justify-center text-2xl tabular-nums transition-all ${
                    day === i + 1 ? "font-medium text-foreground" : "text-muted-foreground/50"
                  }`}
                >
                  {(i + 1).toString().padStart(2, "0")}
                </div>
              ))}
            </div>
          </div>

          {/* Month wheel */}
          <div className="relative h-48 w-20 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-12 -translate-y-1/2 rounded-lg border border-border bg-muted/30" />
            <div
              ref={monthRef}
              className="scrollbar-hide h-full snap-y snap-mandatory overflow-y-scroll py-[72px]"
              onScroll={(e) => {
                const target = e.target as HTMLDivElement
                const scrollTop = target.scrollTop
                const itemHeight = 48
                const selectedIndex = Math.round(scrollTop / itemHeight)
                if (selectedIndex >= 0 && selectedIndex <= 11) {
                  setMonth(selectedIndex)
                }
              }}
            >
              {MONTHS.map((m, i) => (
                <div
                  key={m}
                  data-month={i}
                  className={`flex h-12 snap-center items-center justify-center text-xl transition-all ${
                    month === i ? "font-medium text-foreground" : "text-muted-foreground/50"
                  }`}
                >
                  {m}
                </div>
              ))}
            </div>
          </div>

          {/* Year wheel */}
          <div className="relative h-48 w-20 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-card to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-12 -translate-y-1/2 rounded-lg border border-border bg-muted/30" />
            <div
              ref={yearRef}
              className="scrollbar-hide h-full snap-y snap-mandatory overflow-y-scroll py-[72px]"
              onScroll={(e) => {
                const target = e.target as HTMLDivElement
                const scrollTop = target.scrollTop
                const itemHeight = 48
                const selectedIndex = Math.round(scrollTop / itemHeight)
                if (selectedIndex >= 0 && selectedIndex < years.length) {
                  setYear(years[selectedIndex])
                }
              }}
            >
              {years.map((y) => (
                <div
                  key={y}
                  data-year={y}
                  className={`flex h-12 snap-center items-center justify-center text-2xl tabular-nums transition-all ${
                    year === y ? "font-medium text-foreground" : "text-muted-foreground/50"
                  }`}
                >
                  {y}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
