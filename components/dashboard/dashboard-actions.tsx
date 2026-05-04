"use client"

import * as React from "react"
import { DayPicker, type DateRange } from "react-day-picker"
import { Calendar, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { GlassContainer } from "@/components/ui/glass-container"
import {
  PERIOD_PRESETS,
  useDashboardPeriod,
  type DashboardPreset,
} from "@/hooks/use-dashboard-period"
import { AlertsDropdown } from "./alerts-dropdown"
import { cn } from "@/lib/utils"

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

export function DashboardActions() {
  const {
    period,
    resolved,
    setPeriod,
    showFilter,
    setShowFilter,
    showCalendar,
    setShowCalendar,
  } = useDashboardPeriod()

  const activePreset: DashboardPreset | null =
    period.kind === "preset" ? period.preset : null

  const [draftRange, setDraftRange] = React.useState<DateRange | undefined>(() => ({
    from: parseIsoDate(resolved.fromIso),
    to: parseIsoDate(resolved.toIso),
  }))

  // Reset the draft whenever the calendar opens so it mirrors the live period.
  React.useEffect(() => {
    if (showCalendar) {
      setDraftRange({
        from: parseIsoDate(resolved.fromIso),
        to: parseIsoDate(resolved.toIso),
      })
    }
  }, [showCalendar, resolved.fromIso, resolved.toIso])

  // Click-outside to close the calendar dropdown.
  const calendarWrapperRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!showCalendar) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (calendarWrapperRef.current && !calendarWrapperRef.current.contains(target)) {
        setShowCalendar(false)
      }
    }
    // Defer one tick so the click that opened the popover doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handler)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener("mousedown", handler)
    }
  }, [showCalendar, setShowCalendar])

  const handleApplyRange = () => {
    const from = draftRange?.from
    const to = draftRange?.to ?? draftRange?.from
    if (!from || !to) return
    const a = from <= to ? from : to
    const b = from <= to ? to : from
    setPeriod({ kind: "custom", from: toIsoDate(a), to: toIsoDate(b) })
    setShowCalendar(false)
  }

  return (
    <>
      <div ref={calendarWrapperRef} className="relative">
        <GlassContainer cornerRadius={28}>
          <div className="flex items-center gap-1 px-1 h-14">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Period filter"
              aria-expanded={showFilter}
              className={cn(
                "h-12 w-12 rounded-full",
                showFilter && "text-primary bg-primary/15",
              )}
              onClick={() => setShowFilter(!showFilter)}
            >
              <SlidersHorizontal className="h-5 w-5" />
            </Button>

            {showFilter && (
              <div
                role="tablist"
                aria-label="Dashboard period"
                className="flex items-center gap-0.5 pl-0.5 pr-1"
              >
                {PERIOD_PRESETS.map((p) => {
                  const isActive = activePreset === p.value
                  return (
                    <button
                      key={p.value}
                      role="tab"
                      type="button"
                      aria-selected={isActive}
                      onClick={() => setPeriod({ kind: "preset", preset: p.value })}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            )}

            <Button
              variant="ghost"
              size="icon"
              aria-label="Date range"
              aria-expanded={showCalendar}
              className={cn(
                "h-12 w-12 rounded-full",
                (showCalendar || period.kind === "custom") &&
                  "text-primary bg-primary/15",
              )}
              onClick={() => setShowCalendar(!showCalendar)}
            >
              <Calendar className="h-5 w-5" />
            </Button>
          </div>
        </GlassContainer>

        {showCalendar && (
          <div className="absolute right-0 top-full z-50 mt-2 w-max max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {resolved.rangeLabel}
            </div>
            <DayPicker
              mode="range"
              selected={draftRange}
              onSelect={setDraftRange}
              numberOfMonths={1}
              disabled={{ after: new Date() }}
              showOutsideDays
              components={{
                Chevron: ({ orientation, className: cls }) =>
                  orientation === "left" ? (
                    <ChevronLeft className={cn("h-4 w-4", cls)} />
                  ) : (
                    <ChevronRight className={cn("h-4 w-4", cls)} />
                  ),
              }}
              classNames={{
                months: "flex flex-col gap-3",
                month: "flex flex-col gap-3 relative",
                month_caption:
                  "flex justify-center items-center h-8 text-sm font-medium",
                caption_label: "text-sm font-medium",
                nav: "flex items-center justify-between absolute inset-x-0 top-0 px-1 h-8 pointer-events-none",
                button_previous:
                  "pointer-events-auto inline-flex items-center justify-center rounded-md h-7 w-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                button_next:
                  "pointer-events-auto inline-flex items-center justify-center rounded-md h-7 w-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                month_grid: "w-full border-collapse",
                weekdays: "flex",
                weekday:
                  "w-8 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
                week: "flex mt-1",
                day: "relative p-0 w-8 h-8 text-center text-sm",
                day_button:
                  "w-8 h-8 rounded-md text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:pointer-events-none",
                selected:
                  "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
                range_start:
                  "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-r-none",
                range_end:
                  "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-l-none",
                range_middle:
                  "bg-primary/15 [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-foreground [&>button]:hover:bg-primary/20",
                today: "[&>button]:ring-1 [&>button]:ring-primary/60",
                outside: "[&>button]:text-muted-foreground [&>button]:opacity-40",
                disabled: "[&>button]:opacity-30 [&>button]:pointer-events-none",
                hidden: "invisible",
              }}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCalendar(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApplyRange}
                disabled={!draftRange?.from}
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </div>

      <GlassContainer cornerRadius={28}>
        <div className="flex items-center px-1 h-14">
          <AlertsDropdown />
        </div>
      </GlassContainer>
    </>
  )
}
