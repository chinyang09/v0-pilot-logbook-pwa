"use client"

import { useState, useMemo } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DutyEntryCard, getDutyTypeColor } from "@/components/duty-entry-card"
import type { ScheduleEntry } from "@/types"
import { cn } from "@/lib/utils"

interface RosterCalendarProps {
  entries: ScheduleEntry[]
  onDateSelect?: (date: string, entries: ScheduleEntry[]) => void
  className?: string
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]

export function RosterCalendar({ entries, onDateSelect, className }: RosterCalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Group entries by date
  const entriesByDate = useMemo(() => {
    return entries.reduce((acc, entry) => {
      if (!acc[entry.date]) {
        acc[entry.date] = []
      }
      acc[entry.date].push(entry)
      return acc
    }, {} as Record<string, ScheduleEntry[]>)
  }, [entries])

  // Get calendar days for current month
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    const startDay = firstDay.getDay()
    const totalDays = lastDay.getDate()

    const days: Array<{ date: string; day: number; isCurrentMonth: boolean; isToday: boolean }> = []

    // Previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate()
    for (let i = startDay - 1; i >= 0; i--) {
      const day = prevMonthLastDay - i
      const prevMonth = month === 0 ? 11 : month - 1
      const prevYear = month === 0 ? year - 1 : year
      const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      days.push({ date: dateStr, day, isCurrentMonth: false, isToday: false })
    }

    // Current month days
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`

    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      days.push({
        date: dateStr,
        day,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
      })
    }

    // Next month days to fill the grid
    const remainingDays = 42 - days.length // 6 rows × 7 days
    for (let day = 1; day <= remainingDays; day++) {
      const nextMonth = month === 11 ? 0 : month + 1
      const nextYear = month === 11 ? year + 1 : year
      const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      days.push({ date: dateStr, day, isCurrentMonth: false, isToday: false })
    }

    return days
  }, [currentDate])

  const goToPrevMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const goToToday = () => {
    setCurrentDate(new Date())
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
    setSelectedDate(todayStr)
    if (entriesByDate[todayStr]) {
      onDateSelect?.(todayStr, entriesByDate[todayStr])
    }
  }

  const handleDateClick = (date: string) => {
    setSelectedDate(date)
    onDateSelect?.(date, entriesByDate[date] || [])
  }

  const selectedEntries = selectedDate ? entriesByDate[selectedDate] || [] : []

  return (
    <div className={cn("space-y-4", className)}>
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={goToPrevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h2>
          <Button variant="outline" size="sm" onClick={goToToday} className="text-xs h-7">
            Today
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={goToNextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map(({ date, day, isCurrentMonth, isToday }) => {
          const dayEntries = entriesByDate[date] || []
          const isSelected = date === selectedDate
          const hasEntries = dayEntries.length > 0

          return (
            <button
              key={date}
              onClick={() => handleDateClick(date)}
              className={cn(
                "aspect-square p-1 rounded-lg text-sm relative transition-colors",
                "flex flex-col items-center justify-start",
                isCurrentMonth
                  ? "text-foreground"
                  : "text-muted-foreground/50",
                isToday && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                isSelected && "bg-primary text-primary-foreground",
                !isSelected && hasEntries && "bg-secondary/50",
                !isSelected && !hasEntries && "hover:bg-secondary/30"
              )}
            >
              <span className={cn("text-xs font-medium", isToday && !isSelected && "text-primary")}>
                {day}
              </span>

              {/* Duty indicators */}
              {hasEntries && (
                <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center max-w-full">
                  {dayEntries.slice(0, 3).map((entry, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        isSelected ? "bg-primary-foreground/70" : getDutyTypeColor(entry.dutyType)
                      )}
                    />
                  ))}
                  {dayEntries.length > 3 && (
                    <span className={cn(
                      "text-[8px]",
                      isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
                    )}>
                      +{dayEntries.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected Date Details */}
      {selectedDate && (
        <div className="border-t border-border pt-4 space-y-2">
          <h3 className="font-medium text-sm">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </h3>
          {selectedEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No duties scheduled for this day
            </p>
          ) : (
            <div className="space-y-2">
              {selectedEntries.map((entry) => (
                <DutyEntryCard key={entry.id} entry={entry} variant="compact" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
