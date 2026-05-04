"use client"

import * as React from "react"

export type DashboardPreset = "7d" | "28d" | "1y" | "all"

export type DashboardPeriod =
  | { kind: "preset"; preset: DashboardPreset }
  | { kind: "custom"; from: string; to: string }

export interface ResolvedPeriod {
  period: DashboardPeriod
  fromIso: string
  toIso: string
  /** Human-friendly range text, e.g. "Apr 15 – Apr 21" or "All time". */
  rangeLabel: string
  /** Short tab label, e.g. "7d", "All", "Custom". */
  shortLabel: string
}

interface DashboardPeriodContextValue {
  period: DashboardPeriod
  resolved: ResolvedPeriod
  setPeriod: (period: DashboardPeriod) => void
  /** Whether the action-bar filter pills are expanded. */
  showFilter: boolean
  setShowFilter: (open: boolean) => void
  /** Whether the action-bar calendar popover is open. */
  showCalendar: boolean
  setShowCalendar: (open: boolean) => void
}

const DashboardPeriodContext = React.createContext<DashboardPeriodContextValue | null>(null)

const PRESET_CONFIG: Record<DashboardPreset, { short: string; days: number | "all" }> = {
  "7d": { short: "7d", days: 7 },
  "28d": { short: "28d", days: 28 },
  "1y": { short: "1y", days: 365 },
  "all": { short: "All", days: "all" },
}

/** Far-back fromIso used for the "all" preset. Earlier than any plausible
 *  logbook entry; the aggregator filters on string comparison so any prefix
 *  before real flight dates is fine. */
const ALL_TIME_FROM_ISO = "1970-01-01"

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = (now.getMonth() + 1).toString().padStart(2, "0")
  const d = now.getDate().toString().padStart(2, "0")
  return `${y}-${m}-${d}`
}

function isoDaysAgo(days: number): string {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const y = now.getFullYear()
  const m = (now.getMonth() + 1).toString().padStart(2, "0")
  const d = now.getDate().toString().padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatRangeLabel(fromIso: string, toIso: string): string {
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIso}T00:00:00`)
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
  return `${fmt.format(from)} – ${fmt.format(to)}`
}

export function resolvePeriod(period: DashboardPeriod): ResolvedPeriod {
  if (period.kind === "preset") {
    const cfg = PRESET_CONFIG[period.preset]
    const toIso = todayIso()
    if (cfg.days === "all") {
      return {
        period,
        fromIso: ALL_TIME_FROM_ISO,
        toIso,
        rangeLabel: "All time",
        shortLabel: cfg.short,
      }
    }
    const fromIso = isoDaysAgo(cfg.days - 1)
    return {
      period,
      fromIso,
      toIso,
      rangeLabel: formatRangeLabel(fromIso, toIso),
      shortLabel: cfg.short,
    }
  }
  return {
    period,
    fromIso: period.from,
    toIso: period.to,
    rangeLabel: formatRangeLabel(period.from, period.to),
    shortLabel: "Custom",
  }
}

export function DashboardPeriodProvider({
  children,
  defaultPeriod,
}: {
  children: React.ReactNode
  defaultPeriod?: DashboardPeriod
}) {
  const [period, setPeriod] = React.useState<DashboardPeriod>(
    defaultPeriod ?? { kind: "preset", preset: "28d" },
  )
  const [showFilter, setShowFilter] = React.useState(false)
  const [showCalendar, setShowCalendar] = React.useState(false)

  const resolved = React.useMemo(() => resolvePeriod(period), [period])

  const value = React.useMemo<DashboardPeriodContextValue>(
    () => ({ period, resolved, setPeriod, showFilter, setShowFilter, showCalendar, setShowCalendar }),
    [period, resolved, showFilter, showCalendar],
  )

  return (
    <DashboardPeriodContext.Provider value={value}>
      {children}
    </DashboardPeriodContext.Provider>
  )
}

export function useDashboardPeriod(): DashboardPeriodContextValue {
  const ctx = React.useContext(DashboardPeriodContext)
  if (!ctx) {
    throw new Error("useDashboardPeriod must be used within DashboardPeriodProvider")
  }
  return ctx
}

export const PERIOD_PRESETS: ReadonlyArray<{ value: DashboardPreset; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "28d", label: "28d" },
  { value: "1y", label: "1y" },
  { value: "all", label: "All" },
]
