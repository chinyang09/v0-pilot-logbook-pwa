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
  Shield,
  Info,
} from "lucide-react"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import { getComplianceStatus } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import { FDPTimelineChart } from "@/components/roster/fdp-timeline-chart"
import { cn } from "@/lib/utils"

export default function FDPPage() {
  const { refresh, isLoading: scheduleLoading } = useScheduleEntries()
  const {
    allDutyPeriods,
    cumulativeLimits,
    capacity,
    forecast,
    restViolations,
    timelineData,
    isLoading,
  } = useFDPData()

  // Compliance for each rolling period
  const compliance14Days = getComplianceStatus(cumulativeLimits.last14Days.utilizationPercent)
  const compliance28Days = getComplianceStatus(cumulativeLimits.last28Days.utilizationPercent)
  const compliance365Days = getComplianceStatus(cumulativeLimits.last365Days.utilizationPercent)

  // Overall compliance (worst status)
  const overallCompliance = [compliance14Days, compliance28Days, compliance365Days].reduce(
    (worst, current) => {
      const order = ["ok", "warning", "critical", "exceeded"]
      return order.indexOf(current.status) > order.indexOf(worst.status) ? current : worst
    }
  )

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
        {/* Overall Status Banner */}
        <Card
          className={cn(
            "border",
            overallCompliance.status === "exceeded"
              ? "border-red-500/20 bg-red-500/5"
              : overallCompliance.status === "critical"
                ? "border-orange-500/20 bg-orange-500/5"
                : overallCompliance.status === "warning"
                  ? "border-yellow-500/20 bg-yellow-500/5"
                  : "border-green-500/20 bg-green-500/5"
          )}
        >
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Overall Compliance</div>
                <div className={cn("text-2xl font-bold", overallCompliance.color)}>
                  {overallCompliance.label}
                </div>

                {capacity.canAcceptMore ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    {capacity.flight28Days.remaining.toFixed(1)}h flight and{" "}
                    {Math.min(capacity.duty14Days.remaining, capacity.duty28Days.remaining).toFixed(1)}h duty remaining
                    (limited by {capacity.bottleneck})
                  </p>
                ) : (
                  <p className="text-xs text-red-500 mt-1">
                    Limit reached — {capacity.bottleneck}
                  </p>
                )}

                {forecast.hasExceedance && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                    <p className="text-xs text-orange-500">
                      Projected breach on{" "}
                      {new Date(forecast.exceedances[0].date + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                )}

                {restViolations.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3 text-red-500" />
                    <p className="text-xs text-red-500">
                      {restViolations.length} rest period violation{restViolations.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "p-3 rounded-xl",
                  overallCompliance.status === "exceeded"
                    ? "bg-red-500/10"
                    : overallCompliance.status === "critical"
                      ? "bg-orange-500/10"
                      : overallCompliance.status === "warning"
                        ? "bg-yellow-500/10"
                        : "bg-green-500/10"
                )}
              >
                <Shield className={cn("h-8 w-8", overallCompliance.color)} />
              </div>
            </div>
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
