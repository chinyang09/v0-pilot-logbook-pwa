/**
 * Duty Period Card Component
 * Displays duty period information with FDP compliance indicators
 */

import type { DutyPeriod, FTLLimits } from "@/types/entities/roster.types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Plane, AlertTriangle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { minutesToHHMM } from "@/lib/utils/time"
import { isDutyExceedingLimits } from "@/lib/utils/roster/fdp-calculator"

interface DutyPeriodCardProps {
  dutyPeriod: DutyPeriod
  limits: FTLLimits
  compact?: boolean
}

export function DutyPeriodCard({ dutyPeriod, limits, compact = false }: DutyPeriodCardProps) {
  const { exceedsFDP, exceedsDuty, exceeds } = isDutyExceedingLimits(dutyPeriod, limits)

  const dutyHours = (dutyPeriod.dutyMinutes / 60).toFixed(1)
  const flightHours = (dutyPeriod.flightMinutes / 60).toFixed(1)
  const maxFdpHours = (dutyPeriod.maxFdpMinutes / 60).toFixed(1)

  const utilizationPercent = (dutyPeriod.dutyMinutes / dutyPeriod.maxFdpMinutes) * 100
  const isNearLimit = utilizationPercent >= 90 && !exceeds

  const statusConfig = exceeds
    ? {
        bg: "bg-red-500/10",
        border: "border-red-500/20",
        text: "text-red-500",
        icon: AlertTriangle,
        label: "Exceeded",
      }
    : isNearLimit
      ? {
          bg: "bg-yellow-500/10",
          border: "border-yellow-500/20",
          text: "text-yellow-500",
          icon: AlertTriangle,
          label: "Near Limit",
        }
      : {
          bg: "bg-green-500/10",
          border: "border-green-500/20",
          text: "text-green-500",
          icon: CheckCircle2,
          label: "OK",
        }

  const StatusIcon = statusConfig.icon

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
        className={cn("flex items-center gap-3 p-2 rounded-lg bg-secondary/30", statusConfig.border)}
      >
        <div className={cn("p-2 rounded-lg", statusConfig.bg, statusConfig.text)}>
          <Clock className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{formatDate(dutyPeriod.date)}</div>
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

  return (
    <Card className={cn("overflow-hidden transition-all hover:shadow-md", statusConfig.border)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("p-2.5 rounded-xl", statusConfig.bg, statusConfig.text)}>
            <Clock className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-base">{formatDate(dutyPeriod.date)}</h3>
              <Badge variant="outline" className={cn("text-xs", statusConfig.text)}>
                {statusConfig.label}
              </Badge>
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
                exceeds
                  ? "bg-red-500"
                  : isNearLimit
                    ? "bg-yellow-500"
                    : "bg-green-500"
              )}
              style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
            />
          </div>
        </div>

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
}
