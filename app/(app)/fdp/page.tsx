"use client"

import { useMemo } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassContainer } from "@/components/ui/glass-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Info,
  Shield,
  Moon,
  CalendarClock,
} from "lucide-react"
import { DutyPeriodCard } from "@/components/roster"
import { useFDPData } from "@/hooks/data/use-fdp-data"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import { getComplianceStatus } from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import type { RollingPeriodStats } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"

const RULE_LABELS: Record<string, string> = {
  "3a": "Reg 3(1)(a)",
  "3b": "Reg 3(1)(b)",
  "3c": "Reg 3(1)(c)",
  "3d": "Reg 3(1)(d)",
}

export default function FDPPage() {
  const { refresh, isLoading: scheduleLoading } = useScheduleEntries()
  const {
    allDutyPeriods,
    pastDuties,
    futureDuties,
    cumulativeLimits,
    capacity,
    forecast,
    restViolations,
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

  // Recent past duties (last 14 days, newest first)
  const recentDutyPeriods = useMemo(() => {
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    return [...pastDuties]
      .filter((dp) => new Date(dp.date + "T00:00:00") >= twoWeeksAgo)
      .reverse()
  }, [pastDuties])

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

  // Capacity bar helper
  const CapacityBar = ({
    label,
    used,
    limit,
    remaining,
    unit,
  }: {
    label: string
    used: number
    limit: number
    remaining: number
    unit: string
  }) => {
    const pct = limit > 0 ? (used / limit) * 100 : 0
    const status = getComplianceStatus(pct)
    return (
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted-foreground">{label}</span>
          <span className={cn("font-medium", status.color)}>
            {remaining.toFixed(1)}{unit} left
          </span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full transition-all", status.color.replace("text", "bg"))}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>{used.toFixed(1)}{unit} used</span>
          <span>{limit}{unit} max</span>
        </div>
      </div>
    )
  }

  // Rolling limit card helper
  const RollingLimitCard = ({
    title,
    regulation,
    stats,
    compliance,
  }: {
    title: string
    regulation: string
    stats: RollingPeriodStats | Pick<RollingPeriodStats, "flightHours" | "maxFlightHours" | "utilizationPercent">
    compliance: ReturnType<typeof getComplianceStatus>
  }) => {
    const StatusIcon =
      compliance.status === "exceeded" || compliance.status === "critical"
        ? AlertTriangle
        : compliance.status === "warning"
          ? Info
          : CheckCircle2

    const hasDuty = "dutyHours" in stats && "maxDutyHours" in stats && (stats as RollingPeriodStats).maxDutyHours > 0

    return (
      <Card>
        <CardContent className="pt-4 pb-3 px-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-medium text-foreground">{title}</div>
            <StatusIcon className={cn("h-3.5 w-3.5", compliance.color)} />
          </div>
          <div className="text-[10px] text-muted-foreground mb-2">{regulation}</div>

          {hasDuty && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Duty</span>
                <span className="font-medium">
                  {(stats as RollingPeriodStats).dutyHours.toFixed(1)}h / {(stats as RollingPeriodStats).maxDutyHours}h
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all", compliance.color.replace("text", "bg"))}
                  style={{
                    width: `${Math.min(((stats as RollingPeriodStats).dutyHours / (stats as RollingPeriodStats).maxDutyHours) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {stats.maxFlightHours > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Flight</span>
                <span className="font-medium">
                  {stats.flightHours.toFixed(1)}h / {stats.maxFlightHours}h
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all", compliance.color.replace("text", "bg"))}
                  style={{
                    width: `${Math.min((stats.flightHours / stats.maxFlightHours) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="mt-2 text-center">
            <Badge variant="outline" className={cn("text-xs", compliance.color)}>
              {compliance.label}
            </Badge>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <PageContainer>
      <div className="px-4 pt-4 pb-safe space-y-4">
        {/* ===== Section 1: Overall Status Banner ===== */}
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
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Overall Compliance</div>
                <div className={cn("text-2xl font-bold", overallCompliance.color)}>
                  {overallCompliance.label}
                </div>

                {/* Capacity summary sentence */}
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

                {/* Forecast warning */}
                {forecast.hasExceedance && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                    <p className="text-xs text-orange-500">
                      Projected breach on{" "}
                      {new Date(forecast.exceedances[0].date + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                      : {forecast.exceedances[0].limitName}
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

        {/* ===== Section 2: Capacity Remaining ===== */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Capacity Remaining</h2>
          <Card>
            <CardContent className="pt-4 pb-3 px-3 space-y-3">
              <CapacityBar
                label="14-Day Duty (Reg 12a)"
                used={capacity.duty14Days.used}
                limit={capacity.duty14Days.limit}
                remaining={capacity.duty14Days.remaining}
                unit="h"
              />
              <CapacityBar
                label="28-Day Duty (Reg 12b)"
                used={capacity.duty28Days.used}
                limit={capacity.duty28Days.limit}
                remaining={capacity.duty28Days.remaining}
                unit="h"
              />
              <CapacityBar
                label="28-Day Flight (Reg 107a)"
                used={capacity.flight28Days.used}
                limit={capacity.flight28Days.limit}
                remaining={capacity.flight28Days.remaining}
                unit="h"
              />
              <CapacityBar
                label="12-Month Flight (Reg 107b)"
                used={capacity.flight365Days.used}
                limit={capacity.flight365Days.limit}
                remaining={capacity.flight365Days.remaining}
                unit="h"
              />
            </CardContent>
          </Card>
        </div>

        {/* ===== Section 3: Rolling Limits ===== */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Rolling Limits</h2>

          <div className="grid grid-cols-2 gap-2">
            <RollingLimitCard
              title="14-Day Duty"
              regulation="Reg 12(1)(a) — max 90h"
              stats={cumulativeLimits.last14Days}
              compliance={compliance14Days}
            />
            <RollingLimitCard
              title="28-Day Duty + Flight"
              regulation="Reg 12(1)(b) + 107(2)(a)"
              stats={cumulativeLimits.last28Days}
              compliance={compliance28Days}
            />
          </div>

          <RollingLimitCard
            title="12-Month Flight Time"
            regulation="Reg 107(2)(b) — max 1,000h"
            stats={cumulativeLimits.last365Days}
            compliance={compliance365Days}
          />
        </div>

        {/* ===== Section 4: Rest Period Compliance ===== */}
        {recentDutyPeriods.some((dp) => dp.restBefore) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Rest Periods</h2>
              {restViolations.length > 0 && (
                <Badge variant="outline" className="text-xs text-red-500 border-red-500/30">
                  {restViolations.length} violation{restViolations.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <Card>
              <CardContent className="pt-3 pb-2 px-3">
                <div className="space-y-1.5">
                  {recentDutyPeriods
                    .filter((dp) => dp.restBefore)
                    .slice(0, 8)
                    .map((dp) => {
                      const rest = dp.restBefore!
                      const restHours = (rest.restMinutes / 60).toFixed(1)
                      const reqHours = (rest.requiredRestMinutes / 60).toFixed(0)
                      const dateLabel = new Date(dp.date + "T00:00:00").toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" }
                      )

                      return (
                        <div
                          key={dp.id}
                          className={cn(
                            "flex items-center justify-between py-1.5 px-2 rounded text-xs",
                            !rest.compliant && "bg-red-500/5"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Moon className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">{dateLabel}</span>
                            {rest.includesLocalNight && (
                              <span className="text-[10px] text-muted-foreground">(night)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={cn("font-medium", !rest.compliant && "text-red-500")}>
                              {restHours}h
                            </span>
                            <span className="text-muted-foreground">/ {reqHours}h</span>
                            <span className="text-[10px] text-muted-foreground">
                              {RULE_LABELS[rest.rule]}
                            </span>
                            {rest.compliant ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-red-500" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===== Section 5: Forecast ===== */}
        {futureDuties.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">
                Upcoming Duties ({futureDuties.length})
              </h2>
              {forecast.hasExceedance && (
                <Badge variant="outline" className="text-xs text-red-500 border-red-500/30">
                  Breach projected
                </Badge>
              )}
            </div>

            {/* Forecast exceedance details */}
            {forecast.hasExceedance && (
              <Card className="border-red-500/20 bg-red-500/5">
                <CardContent className="pt-3 pb-2 px-3">
                  <div className="space-y-1.5">
                    {forecast.exceedances.map((exc, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 text-red-500" />
                          <span className="text-red-500 font-medium">
                            {new Date(exc.date + "T00:00:00").toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                        <span className="text-red-500">
                          {exc.limitName}: {exc.projected.toFixed(1)}h / {exc.limit}h
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Future duty period cards */}
            <div className="space-y-2">
              {futureDuties
                .slice()
                .reverse()
                .slice(0, 10)
                .map((dp) => (
                  <DutyPeriodCard key={dp.id} dutyPeriod={dp} limits={DEFAULT_FTL_LIMITS} />
                ))}
              {futureDuties.length > 10 && (
                <p className="text-center text-sm text-muted-foreground">
                  +{futureDuties.length - 10} more upcoming
                </p>
              )}
            </div>
          </div>
        )}

        {/* ===== Section 6: Recent Duty Periods ===== */}
        {recentDutyPeriods.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Recent Duty Periods ({recentDutyPeriods.length})
            </h2>
            <div className="space-y-2">
              {recentDutyPeriods.slice(0, 10).map((dp) => (
                <DutyPeriodCard key={dp.id} dutyPeriod={dp} limits={DEFAULT_FTL_LIMITS} />
              ))}
            </div>
            {recentDutyPeriods.length > 10 && (
              <p className="text-center text-sm text-muted-foreground">
                +{recentDutyPeriods.length - 10} more duty periods
              </p>
            )}
          </div>
        )}

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

        {/* Empty State */}
        {allDutyPeriods.length === 0 && !isLoading && (
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
        )}
      </div>
    </PageContainer>
  )
}
