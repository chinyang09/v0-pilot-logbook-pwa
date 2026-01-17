/**
 * Monthly Roster Calendar Component
 * Shows duty entries in a calendar grid view
 */

"use client"

import { useState, useMemo } from "react"
import type { ScheduleEntry, DutyType } from "@/types/entities/roster.types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const DUTY_TYPE_DOTS: Record<DutyType, string> = {
  flight: "bg-blue-500",
  standby: "bg-yellow-500",
  training: "bg-purple-500",
  leave: "bg-green-500",
  off: "bg-gray-400",
  ground: "bg-orange-500",
  positioning: "bg-cyan-500",
  other: "bg-gray-400",
}

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
    const startingDayOfWeek = firstDay.getDay() // 0 = Sunday

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
      const dateString = date.toISOString().split("T")[0]
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
      const dateString = date.toISOString().split("T")[0]
      days.push({
        date,
        dateString,
        isCurrentMonth: true,
        isToday: date.getTime() === today.getTime(),
        entries: entriesByDate[dateString] || [],
      })
    }

    // Add days from next month to complete the grid
    const remainingDays = 42 - days.length // 6 weeks * 7 days
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(year, month + 1, day)
      const dateString = date.toISOString().split("T")[0]
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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{monthName}</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={goToPreviousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={goToNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-2">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, idx) => {
            const hasEntries = day.entries.length > 0
            const primaryEntry = day.entries[0]

            return (
              <button
                key={idx}
                onClick={() => hasEntries && onDateClick?.(day.dateString, day.entries)}
                className={cn(
                  "aspect-square p-1 rounded-lg text-sm transition-colors relative",
                  "hover:bg-secondary/50",
                  day.isCurrentMonth ? "bg-background" : "bg-muted/30",
                  day.isToday && "ring-2 ring-primary",
                  !day.isCurrentMonth && "text-muted-foreground",
                  hasEntries && "cursor-pointer font-medium",
                  !hasEntries && "cursor-default"
                )}
              >
                <div className="absolute top-1 left-1 right-1 text-left">
                  {day.date.getDate()}
                </div>

                {/* Duty indicators */}
                {hasEntries && (
                  <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5 justify-center">
                    {day.entries.slice(0, 3).map((entry, entryIdx) => {
                      const dotColor = DUTY_TYPE_DOTS[entry.dutyType] || DUTY_TYPE_DOTS.other
                      return (
                        <div
                          key={entryIdx}
                          className={cn("h-1.5 w-1.5 rounded-full", dotColor)}
                          title={entry.dutyCode || entry.dutyType}
                        />
                      )
                    })}
                    {day.entries.length > 3 && (
                      <div className="text-[8px] text-muted-foreground">+{day.entries.length - 3}</div>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-border/50">
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", DUTY_TYPE_DOTS.flight)} />
              <span>Flight</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", DUTY_TYPE_DOTS.standby)} />
              <span>Standby</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", DUTY_TYPE_DOTS.training)} />
              <span>Training</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", DUTY_TYPE_DOTS.leave)} />
              <span>Leave</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", DUTY_TYPE_DOTS.off)} />
              <span>Off</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
