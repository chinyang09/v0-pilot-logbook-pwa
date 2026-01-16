/**
 * Enhanced Duty Entry Card Component
 * Displays detailed information for a schedule entry
 */

import type { ScheduleEntry, DutyType } from "@/types/entities/roster.types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Plane,
  Clock,
  GraduationCap,
  Calendar,
  Coffee,
  FileText,
  Users,
  MapPin,
  AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

const DUTY_TYPE_ICONS: Record<DutyType, typeof Plane> = {
  flight: Plane,
  standby: Clock,
  training: GraduationCap,
  leave: Calendar,
  off: Coffee,
  ground: FileText,
  positioning: Plane,
  other: FileText,
}

const DUTY_TYPE_COLORS: Record<DutyType, { bg: string; text: string; border: string }> = {
  flight: { bg: "bg-blue-500/10", text: "text-blue-500", border: "border-blue-500/20" },
  standby: { bg: "bg-yellow-500/10", text: "text-yellow-500", border: "border-yellow-500/20" },
  training: { bg: "bg-purple-500/10", text: "text-purple-500", border: "border-purple-500/20" },
  leave: { bg: "bg-green-500/10", text: "text-green-500", border: "border-green-500/20" },
  off: { bg: "bg-gray-500/10", text: "text-gray-500", border: "border-gray-500/20" },
  ground: { bg: "bg-orange-500/10", text: "text-orange-500", border: "border-orange-500/20" },
  positioning: { bg: "bg-cyan-500/10", text: "text-cyan-500", border: "border-cyan-500/20" },
  other: { bg: "bg-gray-500/10", text: "text-gray-500", border: "border-gray-500/20" },
}

interface DutyEntryCardProps {
  entry: ScheduleEntry
  onClick?: () => void
  compact?: boolean
}

export function DutyEntryCard({ entry, onClick, compact = false }: DutyEntryCardProps) {
  const Icon = DUTY_TYPE_ICONS[entry.dutyType] || FileText
  const colors = DUTY_TYPE_COLORS[entry.dutyType] || DUTY_TYPE_COLORS.other

  const hasSectors = entry.sectors && entry.sectors.length > 0
  const hasCrew = entry.crew && entry.crew.length > 0
  const hasLinkedFlights = entry.linkedFlightIds && entry.linkedFlightIds.length > 0

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-2 rounded-lg bg-secondary/30 cursor-pointer hover:bg-secondary/50 transition-colors",
          onClick && "cursor-pointer"
        )}
        onClick={onClick}
      >
        <div className={cn("p-2 rounded-lg", colors.bg, colors.text)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{entry.dutyCode || entry.dutyType}</div>
          {entry.dutyDescription && (
            <div className="text-xs text-muted-foreground truncate">{entry.dutyDescription}</div>
          )}
          {hasSectors && (
            <div className="text-xs text-muted-foreground">
              {entry.sectors.map((s) => `${s.departureIata}-${s.arrivalIata}`).join(", ")}
            </div>
          )}
        </div>
        {entry.reportTime && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary/50">
            {entry.reportTime}
          </span>
        )}
      </div>
    )
  }

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all hover:shadow-md",
        colors.border,
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("p-2.5 rounded-xl", colors.bg, colors.text)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-base">{entry.dutyCode || entry.dutyType}</h3>
              {hasLinkedFlights && (
                <Badge variant="secondary" className="text-xs">
                  <Plane className="h-3 w-3 mr-1" />
                  {entry.linkedFlightIds.length}
                </Badge>
              )}
            </div>
            {entry.dutyDescription && (
              <p className="text-sm text-muted-foreground">{entry.dutyDescription}</p>
            )}
          </div>
          {entry.indicators && entry.indicators.length > 0 && (
            <div className="flex gap-1">
              {entry.indicators.map((indicator, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {indicator}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Times */}
        {(entry.reportTime || entry.debriefTime) && (
          <div className="flex items-center gap-4 mb-3 text-sm">
            {entry.reportTime && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Report: {entry.reportTime}</span>
              </div>
            )}
            {entry.debriefTime && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Debrief: {entry.debriefTime}</span>
              </div>
            )}
          </div>
        )}

        {/* Flight Sectors */}
        {hasSectors && (
          <div className="space-y-2 mb-3">
            {entry.sectors.map((sector, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 text-sm"
              >
                <div className="flex items-center gap-1 font-medium">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    {sector.departureIata} → {sector.arrivalIata}
                  </span>
                </div>
                <div className="flex-1" />
                {sector.flightNumber && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-secondary">
                    {sector.flightNumber}
                  </span>
                )}
                {sector.aircraftType && (
                  <span className="text-xs text-muted-foreground">{sector.aircraftType}</span>
                )}
                {(sector.actualOut || sector.scheduledOut) && (
                  <span className="text-xs text-muted-foreground">
                    {sector.actualOut || sector.scheduledOut}
                  </span>
                )}
                {sector.linkedFlightId && (
                  <Plane className="h-3.5 w-3.5 text-green-500" title="Linked to flight" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Crew */}
        {hasCrew && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              {entry.crew
                .map((c) => `${c.role === "CPT" || c.role === "PIC" ? "CPT" : "FO"} ${c.name}`)
                .join(", ")}
            </span>
          </div>
        )}

        {/* Standby Window */}
        {entry.standbyWindow && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {entry.standbyWindow.type}: {entry.standbyWindow.start} - {entry.standbyWindow.end}
            </span>
          </div>
        )}

        {/* Training Details */}
        {entry.training && (
          <div className="space-y-1 mt-2 text-sm">
            <div className="font-medium">{entry.training.courseName}</div>
            <div className="text-muted-foreground">{entry.training.courseComponent}</div>
            <div className="text-muted-foreground">
              {entry.training.facility} - {entry.training.facilityLocation}
            </div>
            <div className="text-muted-foreground">
              {entry.training.startTime} - {entry.training.endTime}
            </div>
          </div>
        )}

        {/* Memo */}
        {entry.memo && (
          <div className="mt-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5" />
            <span>{entry.memo}</span>
          </div>
        )}

        {/* Time Reference Badge */}
        {entry.timeReference && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <Badge variant="outline" className="text-xs">
              {entry.timeReference === "UTC" ? "UTC" : "Local Base"}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
