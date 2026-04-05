"use client"

import { useMemo, useState, useCallback } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassContainer } from "@/components/ui/glass-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  RefreshCw, TrendingUp, AlertTriangle, CheckCircle2, Info,
  BedDouble, Calculator, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert,
} from "lucide-react"
import { useScheduleEntries } from "@/hooks/data/use-schedule"
import { DutyPeriodCard } from "@/components/roster"
import {
  getDutyPeriodsFromSchedule,
  calculateCumulativeLimits,
  calculateRestStatus,
  checkLegalityWithDuty,
  getComplianceStatus,
} from "@/lib/utils/roster/fdp-calculator"
import { DEFAULT_FTL_LIMITS } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"

function formatMinutesAsHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

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

  // Rest status — how much rest remains before legal for next duty
  const restStatus = useMemo(() => {
    return calculateRestStatus(dutyPeriods, DEFAULT_FTL_LIMITS)
  }, [dutyPeriods])

  // Quick legality check state
  const [quickCheckOpen, setQuickCheckOpen] = useState(false)
  const [quickCheckForm, setQuickCheckForm] = useState({
    date: new Date().toISOString().split("T")[0],
    reportTime: "",
    debriefTime: "",
    sectors: "1",
    flightMinutes: "",
  })
  const [quickCheckResult, setQuickCheckResult] = useState<ReturnType<typeof checkLegalityWithDuty> | null>(null)

  const runQuickCheck = useCallback(() => {
    if (!quickCheckForm.reportTime || !quickCheckForm.debriefTime) return

    // Parse flight time from HH:MM to minutes
    let flightMins = 0
    if (quickCheckForm.flightMinutes) {
      const parts = quickCheckForm.flightMinutes.split(":")
      if (parts.length === 2) {
        flightMins = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0)
      } else {
        flightMins = (parseFloat(quickCheckForm.flightMinutes) || 0) * 60
      }
    }

    const result = checkLegalityWithDuty(
      dutyPeriods,
      {
        date: quickCheckForm.date,
        reportTime: quickCheckForm.reportTime,
        debriefTime: quickCheckForm.debriefTime,
        sectors: parseInt(quickCheckForm.sectors, 10) || 1,
        flightMinutes: flightMins,
      },
      DEFAULT_FTL_LIMITS
    )
    setQuickCheckResult(result)
  }, [quickCheckForm, dutyPeriods])

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

  // Glass action buttons for the floating header bar
  const fdpActions = useMemo(() => (
    <GlassContainer cornerRadius={28}>
      <Button variant="ghost" size="icon" className="h-14 w-14" onClick={() => refresh()} disabled={isLoading}>
        <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
      </Button>
    </GlassContainer>
  ), [refresh, isLoading])

  useRegisterMainActions(fdpActions, true)

  return (
    <PageContainer
    >
      <div className="px-4 pt-4 pb-safe space-y-4">
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

        {/* Rest Countdown Card */}
        {dutyPeriods.length > 0 && (
          <Card
            className={cn(
              "border",
              restStatus.isLegalForDuty
                ? "border-green-500/20 bg-green-500/5"
                : "border-orange-500/20 bg-orange-500/5"
            )}
          >
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "p-2.5 rounded-xl",
                    restStatus.isLegalForDuty ? "bg-green-500/10" : "bg-orange-500/10"
                  )}
                >
                  <BedDouble
                    className={cn("h-6 w-6", restStatus.isLegalForDuty ? "text-green-500" : "text-orange-500")}
                  />
                </div>
                <div className="flex-1">
                  {restStatus.isLegalForDuty ? (
                    <>
                      <div className="text-sm font-semibold text-green-500">Legal for Next Duty</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Min rest of {DEFAULT_FTL_LIMITS.minRestBetweenDuties}h met
                        {restStatus.lastDutyDate && (
                          <> &middot; Last debrief {restStatus.lastDebriefTime} on{" "}
                            {new Date(restStatus.lastDutyDate + "T00:00:00").toLocaleDateString("en-US", {
                              month: "short", day: "numeric",
                            })}
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-orange-500">
                        {formatMinutesAsHHMM(restStatus.restRemainingMinutes)} rest needed
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Before legal for next duty
                        {restStatus.legalAtTime && (
                          <> &middot; Legal at{" "}
                            {restStatus.legalAtTime.toLocaleTimeString("en-US", {
                              hour: "2-digit", minute: "2-digit", hour12: false,
                            })}
                            {" "}
                            {restStatus.legalAtTime.toLocaleDateString("en-US", {
                              month: "short", day: "numeric",
                            })}
                          </>
                        )}
                      </div>
                      {/* Rest progress bar */}
                      <div className="mt-2">
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-orange-500 transition-all"
                            style={{
                              width: `${Math.min((restStatus.restElapsedMinutes / restStatus.restRequiredMinutes) * 100, 100)}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span>{formatMinutesAsHHMM(restStatus.restElapsedMinutes)} elapsed</span>
                          <span>{formatMinutesAsHHMM(restStatus.restRequiredMinutes)} required</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Legality Check */}
        <Card>
          <CardContent className="pt-4 pb-3 px-3">
            <button
              className="flex items-center justify-between w-full text-left"
              onClick={() => setQuickCheckOpen(!quickCheckOpen)}
            >
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Quick Legality Check</span>
              </div>
              {quickCheckOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {quickCheckOpen && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enter a hypothetical duty to check if accepting it would cause any violations.
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={quickCheckForm.date}
                      onChange={(e) => setQuickCheckForm(prev => ({ ...prev, date: e.target.value }))}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Sectors</Label>
                    <Input
                      type="number"
                      min="1"
                      max="8"
                      value={quickCheckForm.sectors}
                      onChange={(e) => setQuickCheckForm(prev => ({ ...prev, sectors: e.target.value }))}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Report Time</Label>
                    <Input
                      type="time"
                      value={quickCheckForm.reportTime}
                      onChange={(e) => setQuickCheckForm(prev => ({ ...prev, reportTime: e.target.value }))}
                      className="h-9 text-sm"
                      placeholder="HH:MM"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Debrief Time</Label>
                    <Input
                      type="time"
                      value={quickCheckForm.debriefTime}
                      onChange={(e) => setQuickCheckForm(prev => ({ ...prev, debriefTime: e.target.value }))}
                      className="h-9 text-sm"
                      placeholder="HH:MM"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Flight Time (HH:MM, optional)</Label>
                  <Input
                    type="text"
                    placeholder="e.g. 05:30"
                    value={quickCheckForm.flightMinutes}
                    onChange={(e) => setQuickCheckForm(prev => ({ ...prev, flightMinutes: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </div>

                <Button
                  onClick={runQuickCheck}
                  disabled={!quickCheckForm.reportTime || !quickCheckForm.debriefTime}
                  className="w-full"
                  size="sm"
                >
                  <Calculator className="h-4 w-4 mr-2" />
                  Check Legality
                </Button>

                {/* Quick check results */}
                {quickCheckResult && (
                  <div
                    className={cn(
                      "p-3 rounded-lg border",
                      quickCheckResult.isLegal
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-red-500/5 border-red-500/20"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {quickCheckResult.isLegal ? (
                        <>
                          <ShieldCheck className="h-5 w-5 text-green-500" />
                          <span className="text-sm font-semibold text-green-500">Legal — All Clear</span>
                        </>
                      ) : (
                        <>
                          <ShieldAlert className="h-5 w-5 text-red-500" />
                          <span className="text-sm font-semibold text-red-500">
                            {quickCheckResult.violations.filter(v => v.severity === "exceeded").length} Violation(s)
                          </span>
                        </>
                      )}
                    </div>

                    {/* Duty summary */}
                    <div className="text-xs text-muted-foreground mb-2">
                      Duty: {(quickCheckResult.dutyPeriod.dutyMinutes / 60).toFixed(1)}h
                      {" · "}FDP Max: {(quickCheckResult.dutyPeriod.maxFdpMinutes / 60).toFixed(1)}h
                      {quickCheckResult.dutyPeriod.flightMinutes > 0 && (
                        <>{" · "}Flight: {(quickCheckResult.dutyPeriod.flightMinutes / 60).toFixed(1)}h</>
                      )}
                    </div>

                    {/* Violations & warnings */}
                    {quickCheckResult.violations.length > 0 && (
                      <div className="space-y-1">
                        {quickCheckResult.violations.map((v, i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex items-center justify-between text-xs px-2 py-1 rounded",
                              v.severity === "exceeded"
                                ? "bg-red-500/10 text-red-500"
                                : "bg-yellow-500/10 text-yellow-500"
                            )}
                          >
                            <span className="font-medium">{v.rule}</span>
                            <span>{v.actual} / {v.limit}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {quickCheckResult.isLegal && quickCheckResult.violations.length > 0 && (
                      <p className="text-xs text-yellow-500 mt-1">
                        Legal but approaching limits — proceed with caution.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
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
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-10 w-10 text-muted-foreground/40 mb-3 mx-auto" />
              <p className="text-sm font-medium text-foreground mb-1">No Duty Periods</p>
              <p className="text-xs text-muted-foreground max-w-[240px] mx-auto">Import your schedule to see FDP calculations and regulatory compliance.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
