"use client"

import * as React from "react"
import { CalendarRange, X } from "lucide-react"

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
import { cn } from "@/lib/utils"

const CUSTOM_VALUE = "custom" as const
type TabValue = DashboardPreset | typeof CUSTOM_VALUE

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`
}

export function DashboardPeriodTabs({ className }: { className?: string }) {
  const { period, resolved, setPeriod } = useDashboardPeriod()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [draftFrom, setDraftFrom] = React.useState<string>(
    period.kind === "custom" ? period.from : isoDaysAgo(13),
  )
  const [draftTo, setDraftTo] = React.useState<string>(
    period.kind === "custom" ? period.to : todayIso(),
  )

  const value: TabValue = period.kind === "preset" ? period.preset : CUSTOM_VALUE

  const options = React.useMemo(() => {
    return [
      ...PERIOD_PRESETS.map((p) => ({ value: p.value as TabValue, label: p.label })),
      { value: CUSTOM_VALUE as TabValue, label: <CalendarRange className="h-3 w-3" /> },
    ]
  }, [])

  const handleChange = (next: TabValue) => {
    if (next === CUSTOM_VALUE) {
      setPickerOpen(true)
      return
    }
    setPeriod({ kind: "preset", preset: next })
  }

  const handleApply = () => {
    if (!draftFrom || !draftTo) return
    const from = draftFrom <= draftTo ? draftFrom : draftTo
    const to = draftFrom <= draftTo ? draftTo : draftFrom
    setPeriod({ kind: "custom", from, to })
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
      {period.kind === "custom" && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-card"
        >
          <CalendarRange className="h-3 w-3" />
          {resolved.label}
          <span
            role="button"
            aria-label="Clear custom range"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              setPeriod({ kind: "preset", preset: "28d" })
            }}
            className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom period</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                value={draftFrom}
                max={draftTo || todayIso()}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input
                type="date"
                value={draftTo}
                min={draftFrom}
                max={todayIso()}
                onChange={(e) => setDraftTo(e.target.value)}
                className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!draftFrom || !draftTo}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
