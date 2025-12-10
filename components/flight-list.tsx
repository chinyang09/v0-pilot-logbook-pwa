"use client"

import { useState, useMemo } from "react"
import type { FlightLog } from "@/lib/indexed-db"
import { formatHHMMDisplay } from "@/lib/time-utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Plane, Clock, Cloud, CloudOff, Moon, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface FlightListProps {
  flights: FlightLog[]
  isLoading?: boolean
}

const INITIAL_LOAD = 10
const LOAD_INCREMENT = 10

export function FlightList({ flights, isLoading }: FlightListProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD)

  const visibleFlights = useMemo(() => flights.slice(0, visibleCount), [flights, visibleCount])

  const hasMore = visibleCount < flights.length

  const loadMore = () => {
    setVisibleCount((prev) => Math.min(prev + LOAD_INCREMENT, flights.length))
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-12" />
                  <Skeleton className="h-px w-20" />
                  <Skeleton className="h-6 w-12" />
                </div>
                <div className="flex gap-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
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

  const formatTime = (time: string) => time?.slice(0, 5) || "--:--"

  return (
    <div className="space-y-3">
      {visibleFlights.map((flight) => (
        <Card
          key={flight.id}
          className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer"
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Flight number and date */}
                <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground">
                  {flight.flightNumber && <span className="font-medium text-foreground">{flight.flightNumber}</span>}
                  <span>{new Date(flight.date).toLocaleDateString()}</span>
                </div>

                {/* Route */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-foreground">{flight.departureIcao}</span>
                  <div className="flex-1 h-px bg-border relative max-w-[120px]">
                    <Plane className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 text-primary bg-card px-1" />
                  </div>
                  <span className="font-semibold text-foreground">{flight.arrivalIcao}</span>
                </div>

                {/* OOOI Times */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
                  <span>OUT {formatTime(flight.outTime)}</span>
                  <span>OFF {formatTime(flight.offTime)}</span>
                  <span>ON {formatTime(flight.onTime)}</span>
                  <span>IN {formatTime(flight.inTime)}</span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="font-mono">{formatHHMMDisplay(flight.blockTime)}</span> block
                  </span>
                  <span className="font-mono">{formatHHMMDisplay(flight.flightTime)} flight</span>
                  <span>
                    {flight.aircraftType} ({flight.aircraftReg})
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-2">
                  {flight.p1Time && flight.p1Time !== "00:00" && (
                    <Badge variant="secondary" className="text-xs font-mono">
                      P1: {formatHHMMDisplay(flight.p1Time)}
                    </Badge>
                  )}
                  {flight.p2Time && flight.p2Time !== "00:00" && (
                    <Badge variant="secondary" className="text-xs font-mono">
                      P2: {formatHHMMDisplay(flight.p2Time)}
                    </Badge>
                  )}
                  {flight.p1usTime && flight.p1usTime !== "00:00" && (
                    <Badge variant="secondary" className="text-xs font-mono">
                      P1US: {formatHHMMDisplay(flight.p1usTime)}
                    </Badge>
                  )}
                  {flight.dualTime && flight.dualTime !== "00:00" && (
                    <Badge variant="secondary" className="text-xs font-mono">
                      Dual: {formatHHMMDisplay(flight.dualTime)}
                    </Badge>
                  )}
                  {flight.nightTime && flight.nightTime !== "00:00" && (
                    <Badge variant="secondary" className="text-xs flex items-center gap-1 font-mono">
                      <Moon className="h-3 w-3" /> {formatHHMMDisplay(flight.nightTime)}
                    </Badge>
                  )}
                  {flight.ifrTime && flight.ifrTime !== "00:00" && (
                    <Badge variant="secondary" className="text-xs font-mono">
                      IFR: {formatHHMMDisplay(flight.ifrTime)}
                    </Badge>
                  )}
                  {(flight.dayLandings > 0 || flight.nightLandings > 0) && (
                    <Badge variant="secondary" className="text-xs">
                      {flight.dayLandings + flight.nightLandings} ldg
                    </Badge>
                  )}
                </div>
              </div>

              {/* Sync status */}
              <div
                className={cn(
                  "p-2 rounded-full shrink-0",
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

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="ghost" onClick={loadMore} className="gap-2">
            <ChevronDown className="h-4 w-4" />
            Load More ({flights.length - visibleCount} remaining)
          </Button>
        </div>
      )}
    </div>
  )
}
