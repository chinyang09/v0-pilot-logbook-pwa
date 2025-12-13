"use client"

import type React from "react"

import { useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState } from "react"
import type { FlightLog } from "@/lib/indexed-db"
import { cn } from "@/lib/utils"

interface LogbookCalendarProps {
  flights: FlightLog[]
  selectedMonth: { year: number; month: number }
  onMonthChange: (year: number, month: number) => void
  onDateSelect?: (date: string) => void
  selectedDate?: string | null
}

interface CalendarHandle {
  scrollToMonth: (year: number, month: number) => void
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAYS = ["S", "M", "T", "W", "T", "F", "S"]

export const LogbookCalendar = forwardRef<CalendarHandle, LogbookCalendarProps>(function LogbookCalendar(
  { flights, selectedMonth, onMonthChange, onDateSelect, selectedDate },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [swipeStartY, setSwipeStartY] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  const flightDates = useMemo(() => {
    const dates = new Map<string, { count: number; hasNight: boolean }>()
    flights.forEach((flight) => {
      const date = flight.date
      const existing = dates.get(date) || { count: 0, hasNight: false }
      existing.count++
      if (flight.nightTime && flight.nightTime !== "00:00") existing.hasNight = true
      dates.set(date, existing)
    })
    return dates
  }, [flights])

  const calendarDays = useMemo(() => {
    const firstDay = new Date(selectedMonth.year, selectedMonth.month, 1)
    const lastDay = new Date(selectedMonth.year, selectedMonth.month + 1, 0)
    const startDay = firstDay.getDay() // Day of week (0-6)
    const daysInMonth = lastDay.getDate()

    const days: { date: Date | null; dateStr: string | null }[] = []

    // Add previous month days
    for (let i = 0; i < startDay; i++) {
      const prevDate = new Date(selectedMonth.year, selectedMonth.month, -(startDay - i - 1))
      days.push({ date: prevDate, dateStr: prevDate.toISOString().split("T")[0] })
    }

    // Add current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(selectedMonth.year, selectedMonth.month, i)
      days.push({ date, dateStr: date.toISOString().split("T")[0] })
    }

    // Add next month days to fill grid
    const remainingDays = 7 - (days.length % 7)
    if (remainingDays < 7) {
      for (let i = 1; i <= remainingDays; i++) {
        const nextDate = new Date(selectedMonth.year, selectedMonth.month + 1, i)
        days.push({ date: nextDate, dateStr: nextDate.toISOString().split("T")[0] })
      }
    }

    return days
  }, [selectedMonth])

  const scrollToMonth = useCallback(
    (year: number, month: number) => {
      onMonthChange(year, month)
    },
    [onMonthChange],
  )

  useImperativeHandle(ref, () => ({ scrollToMonth }), [scrollToMonth])

  const handleTouchStart = (e: React.TouchEvent) => {
    setSwipeStartY(e.touches[0].clientY)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isSwiping) return
    setIsSwiping(false)

    const diffY = swipeStartY - e.changedTouches[0].clientY

    // Only change month if vertical swipe is significant
    if (Math.abs(diffY) > 50) {
      if (diffY > 0) {
        // Swipe up = next month
        const nextMonth = selectedMonth.month === 11 ? 0 : selectedMonth.month + 1
        const nextYear = selectedMonth.month === 11 ? selectedMonth.year + 1 : selectedMonth.year
        onMonthChange(nextYear, nextMonth)
      } else {
        // Swipe down = previous month
        const prevMonth = selectedMonth.month === 0 ? 11 : selectedMonth.month - 1
        const prevYear = selectedMonth.month === 0 ? selectedMonth.year - 1 : selectedMonth.year
        onMonthChange(prevYear, prevMonth)
      }
    }
  }

  const handleDateClick = (dateStr: string, hasFlights: boolean) => {
    if (hasFlights) {
      onDateSelect?.(dateStr)
    }
  }

  const today = new Date().toISOString().split("T")[0]

  return (
    <div className="flex flex-col min-h-[280px] h-[300px] sm:h-[320px] will-change-transform">
      <div className="grid grid-cols-7 gap-1 px-2 pb-2 border-b border-border">
        {DAYS.map((day, i) => (
          <div key={i} className="text-center text-xs text-muted-foreground font-medium py-1">
            {day}
          </div>
        ))}
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-2 pt-2 scrollbar-hide"
        style={{ contain: "layout" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {calendarDays.map((dayInfo, dayIndex) => {
            if (!dayInfo.date || !dayInfo.dateStr) {
              return <div key={dayIndex} />
            }

            const dateStr = dayInfo.dateStr
            const flightInfo = flightDates.get(dateStr)
            const hasFlights = !!flightInfo
            const isToday = dateStr === today
            const isSelected = dateStr === selectedDate
            const isInFocusMonth =
              dayInfo.date.getMonth() === selectedMonth.month && dayInfo.date.getFullYear() === selectedMonth.year

            return (
              <button
                key={dayIndex}
                type="button"
                onClick={() => handleDateClick(dateStr, hasFlights)}
                disabled={!hasFlights}
                className={cn(
                  "aspect-square flex items-center justify-center text-xs rounded-md relative transition-colors",
                  isInFocusMonth ? "text-foreground font-medium" : "text-muted-foreground/30",
                  hasFlights && isInFocusMonth && "bg-primary/20 text-primary font-semibold",
                  hasFlights && !isInFocusMonth && "bg-primary/5 text-primary/40",
                  flightInfo?.hasNight && "bg-indigo-500/20 text-indigo-400",
                  isToday && "ring-1 ring-primary",
                  isSelected && "ring-2 ring-primary bg-primary/30",
                )}
              >
                {dayInfo.date.getDate()}
                {flightInfo && flightInfo.count > 1 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
                    {flightInfo.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
})
