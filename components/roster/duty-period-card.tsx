/**
 * Duty Period Card Component
 * Displays duty period information with FDP compliance indicators,
 * rest period info, and data source badge.
 */

import { memo } from "react"
import type { DutyPeriod, FTLLimits } from "@/types/entities/roster.types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Plane, AlertTriangle, CheckCircle2, Moon, BookOpen, Calendar, Merge } from "lucide-react"
import { cn } from "@/lib/utils"
import { isDutyExceedingLimits } from "@/lib/utils/roster/fdp-calculator"

const RULE_LABELS: Record<string, string> = {
  "3a": "Reg 3(1)(a) — 10h with local night",
  "3b": "Reg 3(1)(b) — 12h without local night",
  "3c": "Reg 3(1)(c) — rest ≥ preceding duty",
  "3d": "Reg 3(1)(d) — 24h after >16h duty",
}

interface DutyPeriodCardProps {
  dutyPeriod: DutyPeriod
  limits: FTLLimits
  compact?: boolean
}

export const DutyPeriodCard = memo(function DutyPeriodCard({ dutyPeriod, limits, compact = false }: DutyPeriodCardProps) {
  const { exceedsFDP, exceedsDuty, exceeds } = isDutyExceedingLimits(dutyPeriod, limits)

  const dutyHours = (dutyPeriod.dutyMinutes / 60).toFixed(1)
  const flightHours = (dutyPeriod.flightMinutes / 60).toFixed(1)
  const maxFdpHours = (dutyPeriod.maxFdpMinutes / 60).toFixed(1)

  const utilizationPercent = (dutyPeriod.dutyMinutes / dutyPeriod.maxFdpMinutes) * 100
  const isNearLimit = utilizationPercent >= 90 && !exceeds

  const statusConfig = exceeds
    ? { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-500", icon: AlertTriangle, label: "Exceeded" }
    : isNearLimit
      ? { bg: "bg-yellow-500/10", border: "border-yellow-500/20", text: "text-yellow-500", icon: AlertTriangle, label: "Near Limit" }
      : { bg: "bg-green-500/10", border: "border-green-500/20", text: "text-green-500", icon: CheckCircle2, label: "OK" }

  const StatusIcon = statusConfig.icon

  const sourceConfig = {
    logbook: { label: "Logbook", icon: BookOpen, color: "text-blue-500 bg-blue-500/10" },
    schedule: { label: "Schedule", icon: Calendar, color: "text-muted-foreground bg-secondary" },
    merged: { label: "Merged", icon: Merge, color: "text-purple-500 bg-purple-500/10" },
  }
  const source = sourceConfig[dutyPeriod.source]

  const formatDate = (dateString: string) => {
    const date = new Date(dateString + "T00:00:00")
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-2 rounded-lg bg-secondary/30",
          statusConfig.border,
          dutyPeriod.isFuture && "border-dashed opacity-80"
        )}
      >
        <div className={cn("p-2 rounded-lg", statusConfig.bg, statusConfig.text)}>
          <Clock className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm truncate">{formatDate(dutyPeriod.date)}</span>
            {dutyPeriod.isFuture && (
              <span className="text-[10px] text-muted-foreground">(upcoming)</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Duty: {dutyHours}h · Flight: {flightHours}h
          </div>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full", statusConfig.bg, statusConfig.text)}>
          {statusConfig.label}
        </span>
      </div>
    )
  }

  const SourceIcon = source.icon

  return (
    <Card className={cn(
      "overflow-hidden transition-all hover:shadow-md",
      statusConfig.border,
      dutyPeriod.isFuture && "border-dashed"
    )}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("p-2.5 rounded-xl", statusConfig.bg, statusConfig.text)}>
            <Clock className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-base">{formatDate(dutyPeriod.date)}</h3>
              <Badge variant="outline" className={cn("text-xs", statusConfig.text)}>
                {statusConfig.label}
              </Badge>
              <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full", source.color)}>
                <SourceIcon className="h-2.5 w-2.5" />
                {source.label}
              </span>
              {dutyPeriod.isFuture && (
                <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
                  Upcoming
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {dutyPeriod.reportTime} - {dutyPeriod.debriefTime}
            </p>
          </div>
          <StatusIcon className={cn("h-5 w-5", statusConfig.text)} />
        </div>

        {/* Duty Times */}
        <div className="space-y-2 mb-3 p-3 rounded-lg bg-secondary/30">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Duty Time:</span>
            </div>
            <span className="font-medium">
              {dutyHours}h / {maxFdpHours}h
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Plane className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Flight Time:</span>
            </div>
            <span className="font-medium">{flightHours}h</span>
          </div>

          {dutyPeriod.sectorCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sectors:</span>
              <span className="font-medium">{dutyPeriod.sectorCount}</span>
            </div>
          )}
        </div>

        {/* Utilization Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>FDP Utilization</span>
            <span>{utilizationPercent.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                exceeds ? "bg-red-500" : isNearLimit ? "bg-yellow-500" : "bg-green-500"
              )}
              style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Rest Period Info */}
        {dutyPeriod.restBefore && (
          <div className={cn(
            "mt-3 p-2 rounded-lg border",
            dutyPeriod.restBefore.compliant
              ? "bg-secondary/30 border-border"
              : "bg-red-500/10 border-red-500/20"
          )}>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Moon className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Rest before:</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn("font-medium", !dutyPeriod.restBefore.compliant && "text-red-500")}>
                  {(dutyPeriod.restBefore.restMinutes / 60).toFixed(1)}h
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="text-muted-foreground">
                  {(dutyPeriod.restBefore.requiredRestMinutes / 60).toFixed(0)}h req
                </span>
                {dutyPeriod.restBefore.compliant ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-red-500" />
                )}
              </div>
            </div>
            {!dutyPeriod.restBefore.compliant && (
              <p className="text-[10px] text-red-500 mt-1">
                {RULE_LABELS[dutyPeriod.restBefore.rule]}
              </p>
            )}
          </div>
        )}

        {/* Warning Messages */}
        {exceeds && (
          <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 text-xs text-red-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                {exceedsFDP && "Exceeded FDP limit"}
                {exceedsFDP && exceedsDuty && " · "}
                {exceedsDuty && "Exceeded single duty limit"}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
