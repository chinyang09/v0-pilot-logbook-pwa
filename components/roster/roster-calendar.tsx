/**
 * Monthly Roster Calendar Component
 * Shows duty entries in a calendar grid view
 */

"use client"

import { useState, useMemo } from "react"
import type { ScheduleEntry, DutyType } from "@/types/entities/roster.types"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatLocalYMD } from "@/lib/utils/date"

// Categorical duty-type colours, tuned per theme so the low-lightness hues
// (standby yellow, off/other grey) don't wash out on the light cream card.
const DUTY_TYPE_DOTS: Record<DutyType, string> = {
  flight: "bg-blue-600 dark:bg-blue-400",
  standby: "bg-amber-500 dark:bg-amber-400",
  training: "bg-purple-600 dark:bg-purple-400",
  leave: "bg-green-600 dark:bg-green-400",
  off: "bg-gray-500 dark:bg-gray-400",
  ground: "bg-orange-600 dark:bg-orange-400",
  positioning: "bg-cyan-600 dark:bg-cyan-400",
  other: "bg-gray-500 dark:bg-gray-400",
}

const DAYS = ["S", "M", "T", "W", "T", "F", "S"]

interface RosterCalendarProps {
  entries: ScheduleEntry[]
  onDateClick?: (date: string, entries: ScheduleEntry[]) => void
}

export function RosterCalendar({ entries, onDateClick }: RosterCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  // Group entries by date
  const entriesByDate = useMemo(() => {
    return entries.reduce(
      (acc, entry) => {
        if (!acc[entry.date]) {
          acc[entry.date] = []
        }
        acc[entry.date].push(entry)
        return acc
      },
      {} as Record<string, ScheduleEntry[]>
    )
  }, [entries])

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startingDayOfWeek = firstDay.getDay()

    const days: Array<{
      date: Date
      dateString: string
      isCurrentMonth: boolean
      isToday: boolean
      entries: ScheduleEntry[]
    }> = []

    // Add days from previous month
    const prevMonthLastDay = new Date(year, month, 0)
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevMonthLastDay.getDate() - i)
      const dateString = formatLocalYMD(date)
      days.push({
        date,
        dateString,
        isCurrentMonth: false,
        isToday: false,
        entries: entriesByDate[dateString] || [],
      })
    }

    // Add days from current month
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month, day)
      const dateString = formatLocalYMD(date)
      days.push({
        date,
        dateString,
        isCurrentMonth: true,
        isToday: date.getTime() === today.getTime(),
        entries: entriesByDate[dateString] || [],
      })
    }

    // Add days from next month to complete the grid
    const remainingDays = 42 - days.length
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(year, month + 1, day)
      const dateString = formatLocalYMD(date)
      days.push({
        date,
        dateString,
        isCurrentMonth: false,
        isToday: false,
        entries: entriesByDate[dateString] || [],
      })
    }

    return days
  }, [currentMonth, entriesByDate])

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const goToToday = () => {
    const now = new Date()
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  const monthName = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })

  return (
    <Card>
      <CardContent className="p-3">
        {/* Month header with navigation */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{monthName}</h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={goToToday} className="text-xs h-7 px-2">
              Today
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goToPreviousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goToNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Weekday headers - matching LogbookCalendar style */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAYS.map((day) => (
            <div key={day} className="text-center text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, idx) => {
            const hasEntries = day.entries.length > 0

            return (
              <button
                key={idx}
                onClick={() => hasEntries && onDateClick?.(day.dateString, day.entries)}
                className={cn(
                  "aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all relative",
                  day.isToday && day.isCurrentMonth
                    ? "text-foreground"
                    : day.isCurrentMonth
                      ? "text-foreground/90"
                      : "text-foreground/15",
                  hasEntries && day.isCurrentMonth && "font-semibold cursor-pointer",
                  !hasEntries && "cursor-default"
                )}
              >
                {/* Today: the number sits in a solid accent disc so it's
                    unmistakable (amber in the night theme), while the duty dots
                    below stay readable on the cell's normal background. */}
                <span
                  className={cn(
                    "text-xs",
                    day.isToday && day.isCurrentMonth &&
                      "flex h-6 w-6 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground shadow-sm"
                  )}
                >
                  {day.date.getDate()}
                </span>

                {/* Duty indicators */}
                {hasEntries && day.isCurrentMonth && (
                  <div className="absolute bottom-0.5 flex gap-0.5 justify-center">
                    {day.entries.slice(0, 3).map((entry, entryIdx) => {
                      const dotColor = DUTY_TYPE_DOTS[entry.dutyType] || DUTY_TYPE_DOTS.other
                      return (
                        <div
                          key={entryIdx}
                          className={cn("h-1 w-1 rounded-full", dotColor)}
                          title={entry.dutyCode || entry.dutyType}
                        />
                      )
                    })}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 pt-2 border-t border-border/30">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(["flight", "standby", "training", "leave", "off"] as DutyType[]).map((type) => (
              <div key={type} className="flex items-center gap-1">
                <div className={cn("h-1.5 w-1.5 rounded-full", DUTY_TYPE_DOTS[type])} />
                <span className="capitalize">{type}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
