"use client"

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useMemo } from "react"
import type { FlightLog } from "@/lib/indexed-db"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface LogbookCalendarProps {
  flights: FlightLog[]
  selectedMonth: { year: number; month: number }
  onMonthChange: (year: number, month: number) => void
}

interface CalendarHandle {
  scrollToMonth: (year: number, month: number) => void
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const LogbookCalendar = forwardRef<CalendarHandle, LogbookCalendarProps>(function LogbookCalendar(
  { flights, selectedMonth, onMonthChange },
  ref,
) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const isScrolling = useRef(false)

  // Get date range from flights
  const dateRange = useMemo(() => {
    if (flights.length === 0) {
      const now = new Date()
      return {
        start: { year: now.getFullYear(), month: 0 },
        end: { year: now.getFullYear(), month: 11 },
      }
    }

    const dates = flights.map((f) => new Date(f.date))
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())))

    // Extend range by 1 month on each end
    const startMonth = minDate.getMonth() === 0 ? 11 : minDate.getMonth() - 1
    const startYear = minDate.getMonth() === 0 ? minDate.getFullYear() - 1 : minDate.getFullYear()
    const endMonth = maxDate.getMonth() === 11 ? 0 : maxDate.getMonth() + 1
    const endYear = maxDate.getMonth() === 11 ? maxDate.getFullYear() + 1 : maxDate.getFullYear()

    return {
      start: { year: startYear, month: startMonth },
      end: { year: endYear, month: endMonth },
    }
  }, [flights])

  // Generate months to display
  const months = useMemo(() => {
    const result: { year: number; month: number }[] = []
    let current = { ...dateRange.start }

    while (
      current.year < dateRange.end.year ||
      (current.year === dateRange.end.year && current.month <= dateRange.end.month)
    ) {
      result.push({ ...current })
      if (current.month === 11) {
        current = { year: current.year + 1, month: 0 }
      } else {
        current = { year: current.year, month: current.month + 1 }
      }
    }

    return result
  }, [dateRange])

  // Group flights by date for quick lookup
  const flightsByDate = useMemo(() => {
    const map: Record<string, FlightLog[]> = {}
    flights.forEach((flight) => {
      const date = flight.date
      if (!map[date]) map[date] = []
      map[date].push(flight)
    })
    return map
  }, [flights])

  // Check if a flight spans overnight (crosses midnight)
  const getFlightDates = useCallback((flight: FlightLog): string[] => {
    const dates = [flight.date]

    // Check if flight is overnight by comparing OUT and IN times
    if (flight.outTime && flight.inTime) {
      const [outHour] = flight.outTime.split(":").map(Number)
      const [inHour] = flight.inTime.split(":").map(Number)

      // If IN time is less than OUT time, flight crosses midnight
      if (inHour < outHour) {
        const nextDay = new Date(flight.date)
        nextDay.setDate(nextDay.getDate() + 1)
        dates.push(nextDay.toISOString().split("T")[0])
      }
    }

    return dates
  }, [])

  // Get all dates with flights (including overnight spans)
  const allFlightDates = useMemo(() => {
    const dates = new Set<string>()
    flights.forEach((flight) => {
      getFlightDates(flight).forEach((date) => dates.add(date))
    })
    return dates
  }, [flights, getFlightDates])

  // Scroll to specific month
  const scrollToMonth = useCallback((year: number, month: number) => {
    const key = `${year}-${month}`
    const element = monthRefs.current.get(key)
    if (element && scrollContainerRef.current) {
      isScrolling.current = true
      element.scrollIntoView({ behavior: "smooth", inline: "start" })
      setTimeout(() => {
        isScrolling.current = false
      }, 500)
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToMonth,
    }),
    [scrollToMonth],
  )

  // Handle scroll to detect current month
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (isScrolling.current) return

      const containerRect = container.getBoundingClientRect()
      const centerX = containerRect.left + containerRect.width / 2

      let closestMonth: { year: number; month: number } | null = null
      let closestDistance = Number.POSITIVE_INFINITY

      monthRefs.current.forEach((element, key) => {
        const rect = element.getBoundingClientRect()
        const elementCenterX = rect.left + rect.width / 2
        const distance = Math.abs(elementCenterX - centerX)

        if (distance < closestDistance) {
          closestDistance = distance
          const [year, month] = key.split("-").map(Number)
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
    scrollToMonth(selectedMonth.year, selectedMonth.month)
  }, [])

  const navigateMonth = (direction: "prev" | "next") => {
    let newMonth = selectedMonth.month + (direction === "next" ? 1 : -1)
    let newYear = selectedMonth.year

    if (newMonth > 11) {
      newMonth = 0
      newYear++
    } else if (newMonth < 0) {
      newMonth = 11
      newYear--
    }

    onMonthChange(newYear, newMonth)
    scrollToMonth(newYear, newMonth)
  }

  const renderMonth = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startingDay = firstDay.getDay()
    const daysInMonth = lastDay.getDate()

    const days: (number | null)[] = []

    // Add empty cells for days before the first day
    for (let i = 0; i < startingDay; i++) {
      days.push(null)
    }

    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i)
    }

    const key = `${year}-${month}`

    return (
      <div
        key={key}
        ref={(el) => {
          if (el) monthRefs.current.set(key, el)
        }}
        className="flex-shrink-0 w-[280px] sm:w-[320px]"
      >
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-center mb-2">
              <h3 className="font-semibold text-foreground">
                {MONTHS[month]} {year}
              </h3>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((day) => (
                <div key={day} className="text-center text-xs text-muted-foreground py-1">
                  {day.charAt(0)}
                </div>
              ))}

              {days.map((day, index) => {
                if (day === null) {
                  return <div key={`empty-${index}`} className="aspect-square" />
                }

                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                const hasFlights = allFlightDates.has(dateStr)
                const flightsOnDay = flightsByDate[dateStr] || []
                const isOvernight = flights.some((f) => {
                  const flightDates = getFlightDates(f)
                  return flightDates.length > 1 && flightDates[1] === dateStr
                })

                return (
                  <div
                    key={`day-${day}`}
                    className={cn(
                      "aspect-square flex items-center justify-center text-xs rounded-md relative",
                      hasFlights && "bg-primary/20 text-primary font-medium",
                      isOvernight && "bg-chart-3/20 text-chart-3",
                      !hasFlights && "text-muted-foreground",
                    )}
                  >
                    {day}
                    {flightsOnDay.length > 1 && (
                      <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
                        {flightsOnDay.length}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Legend for the month */}
            <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-primary/20" />
                <span>Flight</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-chart-3/20" />
                <span>Overnight</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Month Navigation */}
      <div className="flex items-center justify-between px-2">
        <Button variant="ghost" size="sm" onClick={() => navigateMonth("prev")}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-foreground">
          {MONTHS[selectedMonth.month]} {selectedMonth.year}
        </span>
        <Button variant="ghost" size="sm" onClick={() => navigateMonth("next")}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable Calendar */}
      <div
        ref={scrollContainerRef}
        className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {months.map(({ year, month }) => (
          <div key={`${year}-${month}`} className="snap-center">
            {renderMonth(year, month)}
          </div>
        ))}
      </div>
    </div>
  )
})
