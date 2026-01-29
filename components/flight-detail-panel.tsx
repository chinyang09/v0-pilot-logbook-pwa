"use client"

import type { FlightLog } from "@/lib/db"
import { formatTimezoneOffset } from "@/lib/utils/time"
import { Plane, ChevronRight, Info } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

interface FlightDetailPanelProps {
  flight: FlightLog
  onEdit?: (flight: FlightLog) => void
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-"
  const parts = dateStr.split("-")
  if (parts.length !== 3) return dateStr

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  let year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])

  if (year < 100) year = 2000 + year

  const date = new Date(year, month - 1, day)
  const dayName = days[date.getDay()]
  const monthName = months[month - 1]

  return `${dayName} ${day}-${monthName}-${String(year).slice(-2)}`
}

function SettingsRow({
  label,
  value,
  secondaryValue,
  showChevron = false,
  showInfo = false,
  onClick,
}: {
  label: string
  value?: string | number
  secondaryValue?: string
  showChevron?: boolean
  showInfo?: boolean
  onClick?: () => void
}) {
  const content = (
    <div
      className={`flex items-center justify-between py-3 px-4 border-b border-border last:border-b-0 ${
        onClick ? "cursor-pointer active:bg-muted/50" : ""
      }`}
      onClick={onClick}
    >
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {secondaryValue && (
          <span className="text-xs text-muted-foreground">{secondaryValue}</span>
        )}
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {value || "-"}
        </span>
        {showInfo && <Info className="h-4 w-4 text-primary" />}
        {showChevron && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
    </div>
  )

  return content
}

function TimeRow({
  label,
  utcValue,
  localValue,
  timezone,
}: {
  label: string
  utcValue?: string
  localValue?: string
  timezone?: number
}) {
  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-foreground">{utcValue || "-"}</div>
          <div className="text-xs text-muted-foreground">UTC</div>
        </div>
        {localValue && timezone !== undefined && (
          <div className="text-right">
            <div className="text-foreground">{localValue}</div>
            <div className="text-xs text-muted-foreground">
              {formatTimezoneOffset(timezone)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function FlightDetailPanel({ flight, onEdit }: FlightDetailPanelProps) {
  const router = useRouter()

  const handleEdit = () => {
    if (onEdit) {
      onEdit(flight)
    } else {
      router.push(`/new-flight?edit=${flight.id}`)
    }
  }

  // Calculate local times
  const getLocalTime = (utcTime: string, timezoneOffset: number): string => {
    if (!utcTime) return ""
    const [hours, minutes] = utcTime.split(":").map(Number)
    const totalMinutes = hours * 60 + minutes + timezoneOffset * 60
    const localHours = Math.floor(((totalMinutes % 1440) + 1440) % 1440 / 60)
    const localMinutes = ((totalMinutes % 60) + 60) % 60
    return `${String(localHours).padStart(2, "0")}${String(localMinutes).padStart(2, "0")}`
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex-none bg-card border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Plane className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold">Flight</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEdit}
            className="text-primary"
          >
            Edit
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Basic Info */}
        <div className="bg-card border-b border-border">
          <SettingsRow label="Date" value={formatDate(flight.date)} secondaryValue="UTC" />
          <SettingsRow label="Flight #" value={flight.flightNumber} />
          <SettingsRow
            label="Aircraft ID"
            value={flight.aircraftReg}
            showInfo
            showChevron
          />
          <SettingsRow
            label="Aircraft Type"
            value={flight.aircraftType}
            showInfo
            showChevron
          />
          <SettingsRow
            label="From"
            value={flight.departureIcao}
            showInfo
            showChevron
          />
          <SettingsRow
            label="To"
            value={flight.arrivalIcao}
            showInfo
            showChevron
          />
        </div>

        {/* Times - Scheduled */}
        <div className="bg-card border-b border-border mt-4">
          <TimeRow
            label="Scheduled Out"
            utcValue={flight.scheduledOut}
            localValue={flight.scheduledOut ? getLocalTime(flight.scheduledOut, flight.departureTimezone) : undefined}
            timezone={flight.departureTimezone}
          />
          <TimeRow
            label="Scheduled In"
            utcValue={flight.scheduledIn}
            localValue={flight.scheduledIn ? getLocalTime(flight.scheduledIn, flight.arrivalTimezone) : undefined}
            timezone={flight.arrivalTimezone}
          />
        </div>

        {/* Times - Actual */}
        <div className="bg-card border-b border-border mt-4">
          <TimeRow
            label="Out"
            utcValue={flight.outTime}
            localValue={flight.outTime ? getLocalTime(flight.outTime, flight.departureTimezone) : undefined}
            timezone={flight.departureTimezone}
          />
          <TimeRow
            label="Off"
            utcValue={flight.offTime}
            localValue={flight.offTime ? getLocalTime(flight.offTime, flight.departureTimezone) : undefined}
            timezone={flight.departureTimezone}
          />
          <TimeRow
            label="On"
            utcValue={flight.onTime}
            localValue={flight.onTime ? getLocalTime(flight.onTime, flight.arrivalTimezone) : undefined}
            timezone={flight.arrivalTimezone}
          />
          <TimeRow
            label="In"
            utcValue={flight.inTime}
            localValue={flight.inTime ? getLocalTime(flight.inTime, flight.arrivalTimezone) : undefined}
            timezone={flight.arrivalTimezone}
          />
        </div>

        {/* Time Summary */}
        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4">
          Time
        </div>
        <div className="bg-card border-b border-border">
          <SettingsRow label="Total Time" value={flight.blockTime} />
          <SettingsRow label="Flight Time" value={flight.flightTime} />
          <SettingsRow label="Night Time" value={flight.nightTime} />
          <SettingsRow label="Day Time" value={flight.dayTime} />
        </div>

        {/* Crew */}
        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4">
          Crew
        </div>
        <div className="bg-card border-b border-border">
          <SettingsRow label="PIC" value={flight.picName || "-"} showChevron />
          <SettingsRow label="SIC" value={flight.sicName || "-"} showChevron />
          <SettingsRow label="Role" value={flight.pilotRole} />
          <SettingsRow label="Pilot Flying" value={flight.pilotFlying ? "Yes" : "No"} />
        </div>

        {/* Takeoffs & Landings */}
        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4">
          Takeoffs & Landings
        </div>
        <div className="bg-card border-b border-border">
          <SettingsRow label="Day Takeoffs" value={flight.dayTakeoffs} />
          <SettingsRow label="Day Landings" value={flight.dayLandings} />
          <SettingsRow label="Night Takeoffs" value={flight.nightTakeoffs} />
          <SettingsRow label="Night Landings" value={flight.nightLandings} />
        </div>

        {/* Remarks */}
        {flight.remarks && (
          <>
            <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4">
              Remarks
            </div>
            <div className="bg-card border-b border-border px-4 py-3">
              <p className="text-foreground">{flight.remarks}</p>
            </div>
          </>
        )}

        {/* Bottom spacing */}
        <div className="h-8" />
      </div>
    </div>
  )
}
