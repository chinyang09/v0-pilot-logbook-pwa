"use client"

import {
  Calendar,
  Clock,
  Plane,
  Coffee,
  GraduationCap,
  FileText,
  ChevronRight,
} from "lucide-react"
import type { ScheduleEntry, DutyType } from "@/types"
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

const DUTY_TYPE_COLORS: Record<DutyType, string> = {
  flight: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  standby: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  training: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  leave: "bg-green-500/10 text-green-500 border-green-500/20",
  off: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  ground: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  positioning: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  other: "bg-gray-500/10 text-gray-500 border-gray-500/20",
}

const DUTY_TYPE_BG_COLORS: Record<DutyType, string> = {
  flight: "bg-blue-500",
  standby: "bg-yellow-500",
  training: "bg-purple-500",
  leave: "bg-green-500",
  off: "bg-gray-400",
  ground: "bg-orange-500",
  positioning: "bg-cyan-500",
  other: "bg-gray-400",
}

interface DutyEntryCardProps {
  entry: ScheduleEntry
  variant?: "default" | "compact" | "minimal"
  showDate?: boolean
  onClick?: () => void
  className?: string
}

export function DutyEntryCard({
  entry,
  variant = "default",
  showDate = false,
  onClick,
  className,
}: DutyEntryCardProps) {
  const Icon = DUTY_TYPE_ICONS[entry.dutyType] || FileText
  const colorClass = DUTY_TYPE_COLORS[entry.dutyType] || DUTY_TYPE_COLORS.other

  if (variant === "minimal") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 p-1.5 rounded-md",
          colorClass,
          onClick && "cursor-pointer hover:opacity-80",
          className
        )}
        onClick={onClick}
      >
        <Icon className="h-3 w-3 flex-shrink-0" />
        <span className="text-xs font-medium truncate">
          {entry.dutyCode || entry.dutyType}
        </span>
      </div>
    )
  }

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 p-2 rounded-lg border",
          colorClass,
          onClick && "cursor-pointer hover:opacity-80",
          className
        )}
        onClick={onClick}
      >
        <div className={cn("p-1.5 rounded-md", colorClass)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-xs truncate">
            {entry.dutyCode || entry.dutyType}
          </div>
          {entry.sectors.length > 0 && (
            <div className="text-[10px] text-muted-foreground truncate">
              {entry.sectors.map((s) => `${s.departureIata}-${s.arrivalIata}`).join(", ")}
            </div>
          )}
        </div>
        {entry.reportTime && (
          <span className="text-[10px] text-muted-foreground">{entry.reportTime}</span>
        )}
      </div>
    )
  }

  // Default variant
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50",
        onClick && "cursor-pointer hover:bg-secondary/50 transition-colors",
        className
      )}
      onClick={onClick}
    >
      <div className={cn("p-2 rounded-lg", colorClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        {showDate && (
          <div className="text-xs text-muted-foreground mb-0.5">
            {new Date(entry.date + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
        <div className="font-medium text-sm truncate">
          {entry.dutyCode || entry.dutyType}
        </div>
        {entry.dutyDescription && (
          <div className="text-xs text-muted-foreground truncate">{entry.dutyDescription}</div>
        )}
        {entry.sectors.length > 0 && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {entry.sectors.map((s) => `${s.departureIata}-${s.arrivalIata}`).join(" → ")}
          </div>
        )}
        {entry.crew.length > 0 && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Crew: {entry.crew.map((c) => c.name.split(" ")[0]).join(", ")}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {entry.reportTime && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary/50">
            {entry.reportTime}
          </span>
        )}
        {entry.debriefTime && (
          <span className="text-[10px] text-muted-foreground">
            Off: {entry.debriefTime}
          </span>
        )}
        {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
    </div>
  )
}

/**
 * Get the background color class for a duty type (for calendar dots)
 */
export function getDutyTypeColor(dutyType: DutyType): string {
  return DUTY_TYPE_BG_COLORS[dutyType] || DUTY_TYPE_BG_COLORS.other
}

/**
 * Export duty type constants for use in other components
 */
export { DUTY_TYPE_ICONS, DUTY_TYPE_COLORS, DUTY_TYPE_BG_COLORS }
