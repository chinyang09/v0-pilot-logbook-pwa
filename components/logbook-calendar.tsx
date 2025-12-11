"use client"

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useMemo } from "react"
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

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAYS = ["S", "M", "T", "W", "T", "F", "S"]

export const LogbookCalendar = forwardRef<CalendarHandle, LogbookCalendarProps>(function LogbookCalendar(
  { flights, selectedMonth, onMonthChange, onDateSelect, selectedDate },
  ref,
) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isScrolling = useRef(false)

  const calendarData = useMemo(() => {
    const now = new Date()
    const startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const endDate = new Date(now.getFullYear() + 1, now.getMonth() + 1, 0)

    const weeks: { days: { date: Date; isCurrentMonth: boolean }[]; monthStart?: { year: number; month: number } }[] =
      []
    const current = new Date(startDate)

    // Adjust to start on Sunday
    current.setDate(current.getDate() - current.getDay())

    let currentWeek: { date: Date; isCurrentMonth: boolean }[] = []
    const lastMonth = -1

    while (current <= endDate || currentWeek.length > 0) {
      const isCurrentMonth = current.getMonth() === selectedMonth.month && current.getFullYear() === selectedMonth.year

      currentWeek.push({
        date: new Date(current),
        isCurrentMonth: current >= startDate && current <= endDate,
      })

      if (currentWeek.length === 7) {
        // Check if this week starts a new month
        const firstDayOfWeek = currentWeek[0].date
        let monthStart: { year: number; month: number } | undefined

        for (const day of currentWeek) {
          if (day.date.getDate() === 1 && day.date >= startDate && day.date <= endDate) {
            monthStart = { year: day.date.getFullYear(), month: day.date.getMonth() }
            break
          }
        }

        weeks.push({ days: currentWeek, monthStart })
        currentWeek = []
      }

      current.setDate(current.getDate() + 1)

      if (current > endDate && currentWeek.length === 0) break
    }

    return weeks
  }, [selectedMonth])

  // Get all dates with flights
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

  const scrollToMonth = useCallback((year: number, month: number) => {
    const container = scrollContainerRef.current
    if (!container) return

    isScrolling.current = true

    // Find the week that contains the first day of the month
    const targetDate = `${year}-${String(month + 1).padStart(2, "0")}-01`
    const weekElement = container.querySelector(`[data-month-start="${year}-${month}"]`)

    if (weekElement) {
      weekElement.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    setTimeout(() => {
      isScrolling.current = false
    }, 500)
  }, [])

  useImperativeHandle(ref, () => ({ scrollToMonth }), [scrollToMonth])

  // Handle scroll to detect current visible month
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (isScrolling.current) return

      const containerRect = container.getBoundingClientRect()
      const centerY = containerRect.top + 100 // Check near top of visible area

      // Find which month is currently visible
      const monthMarkers = container.querySelectorAll("[data-month-start]")
      let closestMonth: { year: number; month: number } | null = null
      let closestDistance = Number.POSITIVE_INFINITY

      monthMarkers.forEach((marker) => {
        const rect = marker.getBoundingClientRect()
        const distance = Math.abs(rect.top - centerY)

        if (distance < closestDistance && rect.top <= centerY + 100) {
          closestDistance = distance
          const [year, month] = (marker as HTMLElement).dataset.monthStart!.split("-").map(Number)
          closestMonth = { year, month }
        }
      })

      if (closestMonth && (closestMonth.year !== selectedMonth.year || closestMonth.month !== selectedMonth.month)) {
        onMonthChange(closestMonth.year, closestMonth.month)
      }
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [selectedMonth, onMonthChange])

  // Scroll to current month on mount
  useEffect(() => {
    setTimeout(() => {
      const now = new Date()
      scrollToMonth(now.getFullYear(), now.getMonth())
    }, 100)
  }, [scrollToMonth])

  const handleDateClick = (dateStr: string, hasFlights: boolean) => {
    if (hasFlights) {
      onDateSelect?.(dateStr)
    }
  }

  const today = new Date().toISOString().split("T")[0]

  return (
    <div className="flex flex-col h-[300px]">
      <div className="grid grid-cols-7 gap-1 px-2 pb-2 border-b border-border">
        {DAYS.map((day, i) => (
          <div key={i} className="text-center text-xs text-muted-foreground font-medium py-1">
            {day}
          </div>
        ))}
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 pt-2 scrollbar-hide">
        {calendarData.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="grid grid-cols-7 gap-1 mb-1"
            {...(week.monthStart ? { "data-month-start": `${week.monthStart.year}-${week.monthStart.month}` } : {})}
          >
            {week.days.map((dayInfo, dayIndex) => {
              const dateStr = dayInfo.date.toISOString().split("T")[0]
              const flightInfo = flightDates.get(dateStr)
              const hasFlights = !!flightInfo
              const isToday = dateStr === today
              const isSelected = dateStr === selectedDate
              const isActiveMonth =
                dayInfo.date.getMonth() === selectedMonth.month && dayInfo.date.getFullYear() === selectedMonth.year

              return (
                <button
                  key={dayIndex}
                  type="button"
                  onClick={() => handleDateClick(dateStr, hasFlights)}
                  disabled={!hasFlights}
                  className={cn(
                    "aspect-square flex items-center justify-center text-xs rounded-md relative transition-colors",
                    isActiveMonth ? "text-foreground" : "text-muted-foreground/40",
                    hasFlights && isActiveMonth && "bg-primary/20 text-primary font-semibold",
                    hasFlights && !isActiveMonth && "bg-primary/10 text-primary/60 font-medium",
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
        ))}
      </div>
    </div>
  )
})
