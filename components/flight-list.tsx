"use client"

import type React from "react"

import { useState, useMemo, useRef } from "react"
import type { FlightLog, Aircraft, Airport, Personnel } from "@/lib/indexed-db"
import { deleteFlight } from "@/lib/indexed-db"
import { formatHHMMDisplay } from "@/lib/time-utils"
import { syncService } from "@/lib/sync-service"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Plane, Cloud, CloudOff, Moon, ChevronDown, Trash2, Search, X, Filter } from "lucide-react"
import { cn } from "@/lib/utils"

interface FlightListProps {
  flights: FlightLog[]
  isLoading?: boolean
  onEdit?: (flight: FlightLog) => void
  onDeleted?: () => void
  aircraft?: Aircraft[]
  airports?: Airport[]
  personnel?: Personnel[]
}

const INITIAL_LOAD = 10
const LOAD_INCREMENT = 10
const SWIPE_THRESHOLD = 80

function SwipeableFlightCard({
  flight,
  onEdit,
  onDelete,
}: {
  flight: FlightLog
  onEdit: () => void
  onDelete: () => void
}) {
  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    isHorizontalSwipe.current = null
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return

    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const diffX = currentX - startX.current
    const diffY = currentY - startY.current

    if (isHorizontalSwipe.current === null && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
      isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY)
    }

    if (isHorizontalSwipe.current) {
      if (diffX < 0) {
        // Swiping left - reveal delete
        setSwipeX(Math.max(diffX, -(SWIPE_THRESHOLD + 20)))
      } else if (swipeX < 0) {
        // Swiping right while delete is shown - hide delete
        setSwipeX(Math.min(0, swipeX + diffX))
      }
    }
  }

  const handleTouchEnd = () => {
    setIsSwiping(false)
    if (swipeX < -SWIPE_THRESHOLD / 2) {
      setSwipeX(-SWIPE_THRESHOLD)
    } else {
      setSwipeX(0)
    }
  }

  const handleClick = () => {
    if (swipeX < 0) {
      setSwipeX(0)
    } else {
      onEdit()
    }
  }

  const formatTime = (time: string) => time?.slice(0, 5) || "--:--"

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-center bg-destructive transition-opacity",
          swipeX < 0 ? "opacity-100" : "opacity-0",
        )}
        style={{ width: SWIPE_THRESHOLD }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-full rounded-none text-destructive-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-6 w-6" />
        </Button>
      </div>

      <Card
        className={cn(
          "bg-card border-border cursor-pointer relative",
          !isSwiping && "transition-transform duration-200",
        )}
        style={{ transform: `translateX(${swipeX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground">
                {flight.flightNumber && <span className="font-medium text-foreground">{flight.flightNumber}</span>}
                <span>{new Date(flight.date).toLocaleDateString()}</span>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <span className="font-semibold text-foreground">{flight.departureIcao}</span>
                <div className="flex-1 h-px bg-border relative max-w-[120px]">
                  <Plane className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 text-primary bg-card px-1" />
                </div>
                <span className="font-semibold text-foreground">{flight.arrivalIcao}</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
                <span>OUT {formatTime(flight.outTime)}</span>
                <span>OFF {formatTime(flight.offTime)}</span>
                <span>ON {formatTime(flight.onTime)}</span>
                <span>IN {formatTime(flight.inTime)}</span>
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

            <div className="flex items-center shrink-0">
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function FlightList({
  flights,
  isLoading,
  onEdit,
  onDeleted,
  aircraft = [],
  airports = [],
  personnel = [],
}: FlightListProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD)
  const [deleteTarget, setDeleteTarget] = useState<FlightLog | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [showFilters, setShowFilters] = useState(false)
  const [filterFlightNumber, setFilterFlightNumber] = useState("")
  const [filterAircraft, setFilterAircraft] = useState<string>("all")
  const [filterAirport, setFilterAirport] = useState<string>("all")
  const [filterPersonnel, setFilterPersonnel] = useState<string>("all")

  const filteredFlights = useMemo(() => {
    return flights.filter((flight) => {
      if (filterFlightNumber && !flight.flightNumber?.toLowerCase().includes(filterFlightNumber.toLowerCase())) {
        return false
      }
      if (filterAircraft !== "all" && flight.aircraftId !== filterAircraft) {
        return false
      }
      if (filterAirport !== "all") {
        const airport = airports.find((a) => a.id === filterAirport)
        if (airport && flight.departureIcao !== airport.icao && flight.arrivalIcao !== airport.icao) {
          return false
        }
      }
      if (filterPersonnel !== "all" && !flight.crewIds?.includes(filterPersonnel)) {
        return false
      }
      return true
    })
  }, [flights, filterFlightNumber, filterAircraft, filterAirport, filterPersonnel, airports])

  const visibleFlights = useMemo(() => filteredFlights.slice(0, visibleCount), [filteredFlights, visibleCount])

  const hasMore = visibleCount < filteredFlights.length

  const hasActiveFilters =
    filterFlightNumber || filterAircraft !== "all" || filterAirport !== "all" || filterPersonnel !== "all"

  const clearFilters = () => {
    setFilterFlightNumber("")
    setFilterAircraft("all")
    setFilterAirport("all")
    setFilterPersonnel("all")
  }

  const loadMore = () => {
    setVisibleCount((prev) => Math.min(prev + LOAD_INCREMENT, filteredFlights.length))
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteFlight(deleteTarget.id)
      if (navigator.onLine) syncService.fullSync()
      onDeleted?.()
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
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

  return (
    <>
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filter
            {hasActiveFilters && (
              <Badge variant="default" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                !
              </Badge>
            )}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {filteredFlights.length} flight{filteredFlights.length !== 1 ? "s" : ""}
          </span>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-secondary/30 rounded-lg">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Flight Number</label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={filterFlightNumber}
                  onChange={(e) => setFilterFlightNumber(e.target.value)}
                  className="h-8 pl-7 text-sm bg-background"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Aircraft</label>
              <Select value={filterAircraft} onValueChange={setFilterAircraft}>
                <SelectTrigger className="h-8 text-sm bg-background">
                  <SelectValue placeholder="All aircraft" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All aircraft</SelectItem>
                  {aircraft.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.registration}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Airport</label>
              <Select value={filterAirport} onValueChange={setFilterAirport}>
                <SelectTrigger className="h-8 text-sm bg-background">
                  <SelectValue placeholder="All airports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All airports</SelectItem>
                  {airports.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.icao} - {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Crew</label>
              <Select value={filterPersonnel} onValueChange={setFilterPersonnel}>
                <SelectTrigger className="h-8 text-sm bg-background">
                  <SelectValue placeholder="All crew" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All crew</SelectItem>
                  {personnel.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {visibleFlights.map((flight) => (
          <SwipeableFlightCard
            key={flight.id}
            flight={flight}
            onEdit={() => onEdit?.(flight)}
            onDelete={() => setDeleteTarget(flight)}
          />
        ))}

        {filteredFlights.length === 0 && hasActiveFilters && (
          <div className="text-center py-8">
            <Search className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-muted-foreground">No flights match your filters</p>
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="ghost" onClick={loadMore} className="gap-2">
              <ChevronDown className="h-4 w-4" />
              Load More ({filteredFlights.length - visibleCount} remaining)
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Flight</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this flight from {deleteTarget?.departureIcao} to{" "}
              {deleteTarget?.arrivalIcao} on {deleteTarget?.date}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
