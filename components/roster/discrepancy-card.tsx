/**
 * One import note as a ROW of a grouped list — what kind of note, its message,
 * when it was filed — the way currencies and crew are listed.
 *
 * It was a card per note, ~200px each (an icon tile, a title with two badges,
 * a "Field: dayTakeoffs" box in the field's code name, a resolution box, a
 * footer with a button), so a single import's notes were screens of
 * scrolling. Everything past the row — the values, the resolution, Resolve
 * and Reopen — is the note's DETAIL, and opens in the detail panel
 * (`DiscrepancyDetailPanel`).
 */

import { memo } from "react"
import type { Discrepancy, DiscrepancyType } from "@/types/entities/roster.types"
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Copy,
  ChevronRight,
  Clock,
  Users,
  MapPin,
  FileText,
  XCircle,
  Plane,
} from "lucide-react"
import { cn } from "@/lib/utils"

/** One formatter for every card's timestamps — `toLocaleDateString` built two
 *  per card, per render of the list. */
export const STAMP = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export const DISCREPANCY_TYPE_CONFIG: Record<
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
  stale_report: {
    icon: XCircle,
    label: "Stale Report",
    description: "Older report skipped to protect newer data",
  },
  aircraft_mismatch: {
    icon: Plane,
    label: "Aircraft",
    description: "Logged on a different aircraft from the day's published schedule",
  },
  // These two normally render as a FlightMismatchCard on the discrepancies
  // page; the entries exist so a resolved one still has a label in the notes
  // list.
  pilot_flying_mismatch: {
    icon: Users,
    label: "Pilot Flying",
    description: "Your PF/PM entry differs from the company report",
  },
  day_night_mismatch: {
    icon: Clock,
    label: "Day / Night",
    description: "Your day/night takeoff or landing split differs from the company report",
  },
}

export const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    bg: "bg-status-info/10",
    text: "text-status-info",
    border: "border-status-info/20",
    label: "Info",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-status-warning/10",
    text: "text-status-warning",
    border: "border-status-warning/20",
    label: "Warning",
  },
  error: {
    icon: AlertCircle,
    bg: "bg-status-error/10",
    text: "text-status-error",
    border: "border-status-error/20",
    label: "Error",
  },
}

export const RESOLUTION_LABELS = {
  keep_logbook: "Kept Logbook",
  keep_schedule: "Kept Schedule",
  merged: "Merged",
  ignored: "Ignored",
}

/** A day-month stamp for the row; the panel carries the full one. */
const ROW_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

interface DiscrepancyRowProps {
  discrepancy: Discrepancy
  /** Shown in the detail panel beside the list. */
  selected?: boolean
  onOpen: (discrepancy: Discrepancy) => void
}

export const DiscrepancyRow = memo(function DiscrepancyRow({
  discrepancy,
  selected = false,
  onOpen,
}: DiscrepancyRowProps) {
  const typeConfig = DISCREPANCY_TYPE_CONFIG[discrepancy.type]
  const severity = SEVERITY_CONFIG[discrepancy.severity]
  const TypeIcon = typeConfig.icon

  return (
    <button
      type="button"
      onClick={() => onOpen(discrepancy)}
      aria-current={selected || undefined}
      className={cn(
        "row-divider flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted/50",
        selected && "bg-primary/10"
      )}
    >
      {discrepancy.resolved ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-status-valid" aria-label="Handled" />
      ) : (
        <TypeIcon className={cn("h-5 w-5 shrink-0", severity.text)} aria-label={severity.label} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug text-foreground">
          {typeConfig.label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {discrepancy.message || typeConfig.description}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {ROW_DATE.format(new Date(discrepancy.resolvedAt ?? discrepancy.createdAt))}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </button>
  )
})
