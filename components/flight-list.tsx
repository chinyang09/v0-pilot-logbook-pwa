"use client"

import type { FlightLog } from "@/lib/indexed-db"
import { Card, CardContent } from "@/components/ui/card"
import { Plane, Clock, Cloud, CloudOff, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface FlightListProps {
  flights: FlightLog[]
  isLoading?: boolean
}

export function FlightList({ flights, isLoading }: FlightListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (flights.length === 0) {
    return (
      <div className="text-center py-12">
        <Plane className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">No flights logged</h3>
        <p className="text-muted-foreground mt-1">Add your first flight to get started</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {flights.map((flight) => (
        <Card
          key={flight.id}
          className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer"
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Route */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-foreground">{flight.departureAirport}</span>
                  <div className="flex-1 h-px bg-border relative">
                    <Plane className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 text-primary bg-card px-1" />
                  </div>
                  <span className="font-semibold text-foreground">{flight.arrivalAirport}</span>
                </div>

                {/* Details */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>{new Date(flight.date).toLocaleDateString()}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {flight.totalTime.toFixed(1)}h
                  </span>
                  <span>
                    {flight.aircraftType} ({flight.aircraftReg})
                  </span>
                </div>

                {/* Time breakdown */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {flight.picTime > 0 && (
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded">PIC: {flight.picTime.toFixed(1)}</span>
                  )}
                  {flight.nightTime > 0 && (
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded">
                      Night: {flight.nightTime.toFixed(1)}
                    </span>
                  )}
                  {flight.ifrTime > 0 && (
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded">IFR: {flight.ifrTime.toFixed(1)}</span>
                  )}
                  {flight.landings > 0 && (
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded">
                      {flight.landings} landing{flight.landings !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>

              {/* Sync status */}
              <div
                className={cn(
                  "p-2 rounded-full",
                  flight.syncStatus === "synced" && "bg-[var(--status-synced)]/10",
                  flight.syncStatus === "pending" && "bg-[var(--status-pending)]/10",
                  flight.syncStatus === "error" && "bg-[var(--status-offline)]/10",
                )}
              >
                {flight.syncStatus === "synced" && <Cloud className="h-4 w-4 text-[var(--status-synced)]" />}
                {flight.syncStatus === "pending" && <CloudOff className="h-4 w-4 text-[var(--status-pending)]" />}
                {flight.syncStatus === "error" && <CloudOff className="h-4 w-4 text-[var(--status-offline)]" />}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
