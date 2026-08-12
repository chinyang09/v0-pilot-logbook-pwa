"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldAlert, Clock, ArrowUpRight } from "lucide-react"

import { MiniBar } from "@/components/ui/mini-bar"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { usePageActive } from "@/hooks/use-page-active"
import { cn } from "@/lib/utils"

interface LimitRow {
  label: string
  used: number
  max: number
  utilization: number
}

function utilizationTone(pct: number): { bar: string; text: string } {
  if (pct >= 95) return { bar: "bg-destructive", text: "text-destructive" }
  if (pct >= 80) return { bar: "bg-chart-5", text: "text-chart-5" }
  if (pct >= 60) return { bar: "bg-chart-4", text: "text-chart-4" }
  return { bar: "bg-chart-2", text: "text-chart-2" }
}

function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0.0"
  return hours.toFixed(1)
}

/**
 * A 1Hz clock, and it only runs when something is actually counting down.
 *
 * The dashboard is a keep-alive page: mounted on first visit and never
 * unmounted. An unconditional interval here therefore re-rendered this whole
 * stack — four limit rows and their bars — once a second for the rest of the
 * session, including while the user was somewhere else entirely, scrolling the
 * logbook. It exists to drive ONE countdown, which is only shown when the pilot
 * is not yet legal to fly; the rest of the time there is nothing to tick.
 *
 * So it is gated on both: a pending deadline, and this tab being the one on
 * screen. `now` simply holds its last value while the clock is off, and no
 * consumer can see it in that state.
 */
function useLiveClock(active: boolean, intervalMs: number = 1000): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    // Catch up immediately on re-activation, from a callback rather than the
    // effect body (see the react-compiler lint note in CLAUDE.md).
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, intervalMs)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [active, intervalMs])
  return now
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`
}

export function FDPLimitsStack({ className }: { className?: string }) {
  const { cumulativeLimits, capacity, restUntilLegal, forecast } = useFDPData()
  // Tick only while there is a deadline to count down AND the dashboard is the
  // tab on screen — see useLiveClock.
  const isVisibleTab = usePageActive("/")
  const now = useLiveClock(isVisibleTab && !!restUntilLegal?.legalAtUtc)

  const rows: LimitRow[] = [
    {
      label: "Duty 14d",
      used: cumulativeLimits.last14Days.dutyHours,
      max: cumulativeLimits.last14Days.maxDutyHours,
      utilization: cumulativeLimits.last14Days.utilizationPercent,
    },
    {
      label: "Duty 28d",
      used: cumulativeLimits.last28Days.dutyHours,
      max: cumulativeLimits.last28Days.maxDutyHours,
      utilization: cumulativeLimits.last28Days.utilizationPercent,
    },
    {
      label: "Flight 28d",
      used: cumulativeLimits.last28Days.flightHours,
      max: cumulativeLimits.last28Days.maxFlightHours,
      utilization:
        cumulativeLimits.last28Days.maxFlightHours > 0
          ? (cumulativeLimits.last28Days.flightHours /
              cumulativeLimits.last28Days.maxFlightHours) *
            100
          : 0,
    },
    {
      label: "Flight 365d",
      used: cumulativeLimits.last365Days.flightHours,
      max: cumulativeLimits.last365Days.maxFlightHours,
      utilization: cumulativeLimits.last365Days.utilizationPercent,
    },
  ]

  const restMs = restUntilLegal && restUntilLegal.legalAtUtc
    ? new Date(restUntilLegal.legalAtUtc).getTime() - now
    : 0
  const isLegalNow =
    restUntilLegal === null || (restUntilLegal && restMs <= 0)

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-border/60 bg-card/70 p-2.5 sm:p-3 shadow-sm",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link
          href="/fdp"
          className="group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          Duty &amp; Flight Limits
          <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
        {forecast.hasExceedance && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
            Forecast breach
          </span>
        )}
      </div>

      <Link href="/fdp" aria-label="Open FDP limits" className="flex-1">
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const tone = utilizationTone(row.utilization)
            return (
              <li key={row.label}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{row.label}</span>
                  <span className=" tabular-nums text-muted-foreground">
                    <span className="text-foreground">{formatHours(row.used)}</span>
                    {" / "}
                    {formatHours(row.max)}h
                    <span className={cn("ml-1.5 font-semibold", tone.text)}>
                      {Math.round(row.utilization)}%
                    </span>
                  </span>
                </div>
                <MiniBar
                  value={row.utilization}
                  max={100}
                  indicatorClassName={tone.bar}
                  height={5}
                  className="mt-1"
                />
              </li>
            )
          })}
        </ul>
      </Link>

      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border/40 bg-background/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Clock
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              isLegalNow ? "text-chart-2" : "text-chart-4",
            )}
          />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isLegalNow ? "Legal for next duty" : "Rest until legal"}
            </p>
            <p
              className={cn(
                " tabular-nums text-sm font-bold",
                isLegalNow ? "text-chart-2" : "text-foreground",
              )}
            >
              {isLegalNow
                ? "Ready"
                : formatDuration(restMs)}
            </p>
          </div>
        </div>
        {capacity.bottleneck && (
          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {capacity.bottleneck}
          </span>
        )}
      </div>
    </div>
  )
}
