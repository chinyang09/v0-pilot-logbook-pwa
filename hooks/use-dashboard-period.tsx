"use client"

import * as React from "react"

export type DashboardPreset = "1w" | "28d" | "3m" | "6m" | "1y"

export type DashboardPeriod =
  | { kind: "preset"; preset: DashboardPreset }
  | { kind: "custom"; from: string; to: string }

export interface ResolvedPeriod {
  period: DashboardPeriod
  fromIso: string
  toIso: string
  label: string
  shortLabel: string
}

interface DashboardPeriodContextValue {
  period: DashboardPeriod
  resolved: ResolvedPeriod
  setPeriod: (period: DashboardPeriod) => void
}

const DashboardPeriodContext = React.createContext<DashboardPeriodContextValue | null>(null)

const PRESET_LABELS: Record<DashboardPreset, { short: string; long: string; days: number }> = {
  "1w": { short: "1w", long: "Last 7 days", days: 7 },
  "28d": { short: "28d", long: "Last 28 days", days: 28 },
  "3m": { short: "3m", long: "Last 3 months", days: 90 },
  "6m": { short: "6m", long: "Last 6 months", days: 180 },
  "1y": { short: "1y", long: "Last 12 months", days: 365 },
}

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
    const cfg = PRESET_LABELS[period.preset]
    const toIso = todayIso()
    const fromIso = isoDaysAgo(cfg.days - 1)
    return {
      period,
      fromIso,
      toIso,
      label: cfg.long,
      shortLabel: cfg.short,
    }
  }
  return {
    period,
    fromIso: period.from,
    toIso: period.to,
    label: formatRangeLabel(period.from, period.to),
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

  const resolved = React.useMemo(() => resolvePeriod(period), [period])

  const value = React.useMemo<DashboardPeriodContextValue>(
    () => ({ period, resolved, setPeriod }),
    [period, resolved],
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
  { value: "1w", label: "1w" },
  { value: "28d", label: "28d" },
  { value: "3m", label: "3m" },
  { value: "6m", label: "6m" },
  { value: "1y", label: "1y" },
]
