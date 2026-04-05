"use client"

import { useMemo } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassContainer } from "@/components/ui/glass-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Info,
} from "lucide-react"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import { FDPTimelineChart } from "@/components/roster/fdp-timeline-chart"
import { cn } from "@/lib/utils"

function formatDateDDMMM(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z")
  return `${d.getUTCDate().toString().padStart(2, "0")} ${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`
}

function LimitCard({
  label,
  regulation,
  used,
  limit,
}: {
  label: string
  regulation: string
  used: number
  limit: number
}) {
  const remaining = Math.max(0, limit - used)
  const pct = limit > 0 ? (used / limit) * 100 : 0
  const barColor = pct >= 100 ? "bg-red-500"
    : pct >= 90 ? "bg-orange-500"
      : pct >= 75 ? "bg-yellow-500"
        : "bg-green-500"
  const remainingColor = pct >= 100 ? "text-red-500"
    : pct >= 90 ? "text-orange-500"
      : pct >= 75 ? "text-yellow-500"
        : "text-green-500"

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">{regulation}</span>
      </div>
      <div className="text-lg font-semibold tabular-nums">
        {used.toFixed(1)}h <span className="text-muted-foreground text-sm font-normal">/ {limit}h</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className={cn("text-xs font-medium", remainingColor)}>
        {remaining.toFixed(1)}h available
      </div>
    </div>
  )
}

export default function FDPPage() {
  const { refresh, isLoading: scheduleLoading } = useScheduleEntries()
  const {
    capacity,
    forecast,
    restViolations,
    timelineData,
    isLoading,
  } = useFDPData()

  // Refresh action button
  const fdpActions = useMemo(
    () => (
      <GlassContainer cornerRadius={28}>
        <Button
          variant="ghost"
          size="icon"
          className="h-14 w-14"
          onClick={() => refresh()}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
        </Button>
      </GlassContainer>
    ),
    [refresh, isLoading]
  )

  useRegisterMainActions(fdpActions, true)

  return (
    <PageContainer>
      <div className="px-4 pt-4 pb-safe space-y-4">
        {/* Capacity Overview — 4 limit cards */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="grid grid-cols-2 gap-4">
              <LimitCard
                label="14-Day Duty"
                regulation="Reg 12(a)"
                used={capacity.duty14Days.used}
                limit={capacity.duty14Days.limit}
              />
              <LimitCard
                label="28-Day Duty"
                regulation="Reg 12(b)"
                used={capacity.duty28Days.used}
                limit={capacity.duty28Days.limit}
              />
              <LimitCard
                label="28-Day Flight"
                regulation="Reg 107(a)"
                used={capacity.flight28Days.used}
                limit={capacity.flight28Days.limit}
              />
              <LimitCard
                label="12-Mo Flight"
                regulation="Reg 107(b)"
                used={capacity.flight365Days.used}
                limit={capacity.flight365Days.limit}
              />
            </div>

            {/* Warnings footer */}
            {(restViolations.length > 0 || forecast.hasExceedance) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border">
                {restViolations.length > 0 && (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-500" />
                    <span className="text-xs text-red-500">
                      {restViolations.length} rest violation{restViolations.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                {forecast.hasExceedance && (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                    <span className="text-xs text-orange-500">
                      Breach on {formatDateDDMMM(forecast.exceedances[0].date)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Interactive Timeline Chart */}
        {timelineData.length > 0 ? (
          <FDPTimelineChart
            timelineData={timelineData}
            limits={DEFAULT_FTL_LIMITS}
            capacity={capacity}
            forecast={forecast}
          />
        ) : !isLoading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-10 w-10 text-muted-foreground/40 mb-3 mx-auto" />
              <p className="text-sm font-medium text-foreground mb-1">No Duty Periods</p>
              <p className="text-xs text-muted-foreground max-w-[240px] mx-auto">
                Import your schedule or log flights to see FDP calculations and regulatory
                compliance.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Regulatory Info */}
        <Card>
          <CardContent className="pt-4 pb-3 px-3">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Regulatory Authority</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {DEFAULT_FTL_LIMITS.regulationType} — Civil Aviation Authority of Singapore
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Reg 3 (Rest Periods) · Reg 12 (Duty Hours) · Reg 107 (Flight Time)
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
