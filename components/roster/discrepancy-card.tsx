/**
 * Discrepancy Card Component
 * Displays discrepancy information with severity indicators
 */

import { memo } from "react"
import type { Discrepancy, DiscrepancyType } from "@/types/entities/roster.types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Copy,
  Clock,
  Users,
  MapPin,
  FileText,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

const DISCREPANCY_TYPE_CONFIG: Record<
  DiscrepancyType,
  {
    icon: typeof AlertCircle
    label: string
    description: string
  }
> = {
  duplicate: {
    icon: Copy,
    label: "Duplicate",
    description: "Same flight exists multiple times",
  },
  time_mismatch: {
    icon: Clock,
    label: "Time Mismatch",
    description: "Times differ between schedule and logbook",
  },
  crew_mismatch: {
    icon: Users,
    label: "Crew Mismatch",
    description: "Crew assignments differ",
  },
  route_mismatch: {
    icon: MapPin,
    label: "Route Mismatch",
    description: "Departure or arrival airports differ",
  },
  missing_in_logbook: {
    icon: FileText,
    label: "Missing in Logbook",
    description: "Scheduled flight not found in logbook",
  },
  missing_in_schedule: {
    icon: FileText,
    label: "Missing in Schedule",
    description: "Logged flight not found in schedule",
  },
}

const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    border: "border-blue-500/20",
    label: "Info",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-yellow-500/10",
    text: "text-yellow-500",
    border: "border-yellow-500/20",
    label: "Warning",
  },
  error: {
    icon: AlertCircle,
    bg: "bg-red-500/10",
    text: "text-red-500",
    border: "border-red-500/20",
    label: "Error",
  },
}

const RESOLUTION_LABELS = {
  keep_logbook: "Kept Logbook",
  keep_schedule: "Kept Schedule",
  merged: "Merged",
  ignored: "Ignored",
}

interface DiscrepancyCardProps {
  discrepancy: Discrepancy
  onResolve?: (discrepancy: Discrepancy) => void
  onReopen?: (discrepancy: Discrepancy) => void
  compact?: boolean
}

export const DiscrepancyCard = memo(function DiscrepancyCard({
  discrepancy,
  onResolve,
  onReopen,
  compact = false,
}: DiscrepancyCardProps) {
  const typeConfig = DISCREPANCY_TYPE_CONFIG[discrepancy.type]
  const severityConfig = SEVERITY_CONFIG[discrepancy.severity]
  const TypeIcon = typeConfig.icon
  const SeverityIcon = severityConfig.icon

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-2 rounded-lg bg-secondary/30 transition-colors",
          severityConfig.border
        )}
      >
        <div className={cn("p-2 rounded-lg", severityConfig.bg, severityConfig.text)}>
          <TypeIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{typeConfig.label}</div>
          <div className="text-xs text-muted-foreground truncate">
            {discrepancy.message || typeConfig.description}
          </div>
        </div>
        {discrepancy.resolved ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full border border-border",
              severityConfig.bg
            )}
          >
            {severityConfig.label}
          </span>
        )}
      </div>
    )
  }

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all hover:shadow-md",
        severityConfig.border,
        discrepancy.resolved && "opacity-60"
      )}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("p-2.5 rounded-xl", severityConfig.bg, severityConfig.text)}>
            <TypeIcon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-base">{typeConfig.label}</h3>
              <Badge variant="outline" className={cn("text-xs", severityConfig.text)}>
                {severityConfig.label}
              </Badge>
              {discrepancy.resolved && (
                <Badge variant="secondary" className="text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Resolved
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {discrepancy.message || typeConfig.description}
            </p>
          </div>
        </div>

        {/* Details */}
        {(discrepancy.field || discrepancy.scheduleValue || discrepancy.logbookValue) && (
          <div className="space-y-2 mb-3 p-3 rounded-lg bg-secondary/30">
            {discrepancy.field && (
              <div className="text-sm">
                <span className="font-medium">Field:</span>{" "}
                <span className="text-muted-foreground">{discrepancy.field}</span>
              </div>
            )}
            {discrepancy.scheduleValue && (
              <div className="text-sm">
                <span className="font-medium">Schedule:</span>{" "}
                <span className="text-muted-foreground">{discrepancy.scheduleValue}</span>
              </div>
            )}
            {discrepancy.logbookValue && (
              <div className="text-sm">
                <span className="font-medium">Logbook:</span>{" "}
                <span className="text-muted-foreground">{discrepancy.logbookValue}</span>
              </div>
            )}
          </div>
        )}

        {/* Resolution Info */}
        {discrepancy.resolved && (
          <div className="mb-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="flex items-center gap-2 text-sm mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="font-medium">
                {discrepancy.resolvedBy
                  ? RESOLUTION_LABELS[discrepancy.resolvedBy]
                  : "Resolved"}
              </span>
            </div>
            {discrepancy.resolutionNotes && (
              <p className="text-xs text-muted-foreground mt-1">
                {discrepancy.resolutionNotes}
              </p>
            )}
            {discrepancy.resolvedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(discrepancy.resolvedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            {new Date(discrepancy.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <div className="flex gap-1">
            {discrepancy.resolved ? (
              onReopen && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onReopen(discrepancy)}
                  className="h-7 text-xs"
                >
                  Reopen
                </Button>
              )
            ) : (
              onResolve && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onResolve(discrepancy)}
                  className="h-7 text-xs"
                >
                  Resolve
                </Button>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
