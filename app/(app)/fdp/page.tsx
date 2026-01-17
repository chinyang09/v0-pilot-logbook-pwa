"use client"

import { useMemo } from "react"
import { PageContainer } from "@/components/page-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, TrendingUp, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import { DutyPeriodCard } from "@/components/roster"
import {
  getDutyPeriodsFromSchedule,
  calculateCumulativeLimits,
  getComplianceStatus,
} from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"

export default function FDPPage() {
  const { scheduleEntries, isLoading, refresh } = useScheduleEntries()

  // Calculate duty periods from schedule entries
  const dutyPeriods = useMemo(() => {
    return getDutyPeriodsFromSchedule(scheduleEntries)
  }, [scheduleEntries])

  // Calculate cumulative limits for today
  const cumulativeLimits = useMemo(() => {
    return calculateCumulativeLimits(dutyPeriods, new Date(), DEFAULT_FTL_LIMITS)
  }, [dutyPeriods])

  // Recent duty periods (last 14 days)
  const recentDutyPeriods = useMemo(() => {
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    return dutyPeriods.filter((dp) => {
      const dpDate = new Date(dp.date + "T00:00:00")
      return dpDate >= twoWeeksAgo
    })
  }, [dutyPeriods])

  // Get compliance status for each period
  const compliance7Days = getComplianceStatus(cumulativeLimits.last7Days.utilizationPercent)
  const compliance14Days = getComplianceStatus(cumulativeLimits.last14Days.utilizationPercent)
  const compliance28Days = getComplianceStatus(cumulativeLimits.last28Days.utilizationPercent)
  const compliance90Days = getComplianceStatus(cumulativeLimits.last90Days.utilizationPercent)
  const compliance365Days = getComplianceStatus(cumulativeLimits.last365Days.utilizationPercent)

  // Overall compliance (worst status)
  const overallCompliance = [
    compliance7Days,
    compliance14Days,
    compliance28Days,
    compliance90Days,
    compliance365Days,
  ].reduce((worst, current) => {
    const statusOrder = ["ok", "warning", "critical", "exceeded"]
    const worstIndex = statusOrder.indexOf(worst.status)
    const currentIndex = statusOrder.indexOf(current.status)
    return currentIndex > worstIndex ? current : worst
  })

  const RollingPeriodCard = ({
    title,
    days,
    stats,
    compliance,
  }: {
    title: string
    days: number
    stats: { dutyHours?: number; flightHours: number; maxDutyHours?: number; maxFlightHours: number }
    compliance: ReturnType<typeof getComplianceStatus>
  }) => {
    const StatusIcon =
      compliance.status === "exceeded" || compliance.status === "critical"
        ? AlertTriangle
        : compliance.status === "warning"
          ? Info
          : CheckCircle2

    return (
      <Card>
        <CardContent className="pt-4 pb-3 px-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground">{title}</div>
            <StatusIcon className={cn("h-3.5 w-3.5", compliance.color)} />
          </div>

          {stats.dutyHours !== undefined && stats.maxDutyHours !== undefined && stats.maxDutyHours > 0 && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Duty</span>
                <span className="font-medium">
                  {stats.dutyHours.toFixed(1)}h / {stats.maxDutyHours}h
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all", compliance.color.replace("text", "bg"))}
                  style={{ width: `${Math.min((stats.dutyHours / stats.maxDutyHours) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}

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
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-12">
              <h1 className="text-lg font-semibold text-foreground">FDP Dashboard</h1>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => refresh()}
                  disabled={isLoading}
                  title="Refresh"
                >
                  <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
              </div>
            </div>
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-4 pb-safe space-y-4">
        {/* Overall Status Card */}
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
                <div className="text-xs text-muted-foreground mt-1">
                  Calculated on {new Date(cumulativeLimits.calculatedAt).toLocaleDateString()}
                </div>
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
                <TrendingUp className={cn("h-8 w-8", overallCompliance.color)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Regulatory Info */}
        <Card>
          <CardContent className="pt-4 pb-3 px-3">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Regulatory Authority</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {DEFAULT_FTL_LIMITS.regulationType} - Civil Aviation Authority of Singapore
            </div>
          </CardContent>
        </Card>

        {/* Rolling Periods */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Rolling Limits</h2>

          <div className="grid grid-cols-2 gap-2">
            <RollingPeriodCard
              title="Last 7 Days"
              days={7}
              stats={cumulativeLimits.last7Days}
              compliance={compliance7Days}
            />
            <RollingPeriodCard
              title="Last 14 Days"
              days={14}
              stats={cumulativeLimits.last14Days}
              compliance={compliance14Days}
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <RollingPeriodCard
              title="Last 28 Days"
              days={28}
              stats={cumulativeLimits.last28Days}
              compliance={compliance28Days}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <RollingPeriodCard
              title="Last 90 Days"
              days={90}
              stats={cumulativeLimits.last90Days}
              compliance={compliance90Days}
            />
            <RollingPeriodCard
              title="Last 365 Days"
              days={365}
              stats={cumulativeLimits.last365Days}
              compliance={compliance365Days}
            />
          </div>
        </div>

        {/* Recent Duty Periods */}
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

        {/* Empty State */}
        {dutyPeriods.length === 0 && !isLoading && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <CardTitle className="text-lg mb-2">No Duty Periods</CardTitle>
              <CardDescription>
                Import your schedule to see FDP calculations and regulatory compliance.
              </CardDescription>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
