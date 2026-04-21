"use client"

import * as React from "react"
import { DayPicker, type DateRange } from "react-day-picker"
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react"

import { TabsPill } from "@/components/ui/tabs-pill"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  PERIOD_PRESETS,
  useDashboardPeriod,
  type DashboardPreset,
} from "@/hooks/use-dashboard-period"
import { AlertsDropdown } from "./alerts-dropdown"
import { cn } from "@/lib/utils"

const CUSTOM_VALUE = "custom" as const
type TabValue = DashboardPreset | typeof CUSTOM_VALUE

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

export function DashboardPeriodTabs({ className }: { className?: string }) {
  const { period, resolved, setPeriod } = useDashboardPeriod()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [draftRange, setDraftRange] = React.useState<DateRange | undefined>(() => ({
    from: parseIsoDate(resolved.fromIso),
    to: parseIsoDate(resolved.toIso),
  }))

  // Reset the draft whenever the dialog opens so it mirrors the live period.
  React.useEffect(() => {
    if (pickerOpen) {
      setDraftRange({
        from: parseIsoDate(resolved.fromIso),
        to: parseIsoDate(resolved.toIso),
      })
    }
  }, [pickerOpen, resolved.fromIso, resolved.toIso])

  const value: TabValue = period.kind === "preset" ? period.preset : CUSTOM_VALUE

  const options = React.useMemo(
    () => [
      ...PERIOD_PRESETS.map((p) => ({ value: p.value as TabValue, label: p.label })),
      {
        value: CUSTOM_VALUE as TabValue,
        label: <CalendarRange className="h-3.5 w-3.5" aria-label="Custom range" />,
      },
    ],
    [],
  )

  const handleChange = (next: TabValue) => {
    if (next === CUSTOM_VALUE) {
      setPickerOpen(true)
      return
    }
    setPeriod({ kind: "preset", preset: next })
  }

  const handleApply = () => {
    const from = draftRange?.from
    const to = draftRange?.to ?? draftRange?.from
    if (!from || !to) return
    const a = from <= to ? from : to
    const b = from <= to ? to : from
    setPeriod({ kind: "custom", from: toIsoDate(a), to: toIsoDate(b) })
    setPickerOpen(false)
  }

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      <TabsPill<TabValue>
        value={value}
        onChange={handleChange}
        options={options}
        ariaLabel="Dashboard period"
      />
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        aria-label="Change date range"
      >
        <CalendarRange className="h-3 w-3" />
        {resolved.rangeLabel}
      </button>
      <div className="ml-auto">
        <AlertsDropdown />
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Select date range</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center pt-1">
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
                month: "flex flex-col gap-3",
                month_caption: "flex justify-center items-center h-8 text-sm font-medium",
                caption_label: "text-sm font-medium",
                nav: "flex items-center justify-between absolute inset-x-0 top-0 px-1 h-8",
                button_previous:
                  "inline-flex items-center justify-center rounded-md h-7 w-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                button_next:
                  "inline-flex items-center justify-center rounded-md h-7 w-7 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                month_grid: "w-full border-collapse",
                weekdays: "flex",
                weekday: "w-8 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
                week: "flex mt-1",
                day: "relative p-0 w-8 h-8 text-center text-sm",
                day_button:
                  "w-8 h-8 rounded-md text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:pointer-events-none",
                selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
                range_start: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-r-none",
                range_end: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-l-none",
                range_middle:
                  "bg-primary/15 [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-foreground [&>button]:hover:bg-primary/20",
                today: "[&>button]:ring-1 [&>button]:ring-primary/60",
                outside: "[&>button]:text-muted-foreground [&>button]:opacity-40",
                disabled: "[&>button]:opacity-30 [&>button]:pointer-events-none",
                hidden: "invisible",
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={!draftRange?.from}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
