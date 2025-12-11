"use client"

import type React from "react"

import { useState, useMemo, useRef, useEffect } from "react"
import type { FlightLog, Aircraft, Airport, Personnel } from "@/lib/indexed-db"
import { deleteFlight } from "@/lib/indexed-db"
import { formatHHMMDisplay } from "@/lib/time-utils"
import { syncService } from "@/lib/sync-service"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Plane, Cloud, CloudOff, Moon, ChevronDown, Trash2, Lock, Unlock } from "lucide-react"
import { cn } from "@/lib/utils"

interface FlightListProps {
  flights: FlightLog[]
  isLoading?: boolean
  onEdit?: (flight: FlightLog) => void
  onDeleted?: () => void
  aircraft?: Aircraft[]
  airports?: Airport[]
  personnel?: Personnel[]
  onFlightVisible?: (flight: FlightLog) => void
  showMonthHeaders?: boolean
  hideFilters?: boolean
}

const INITIAL_LOAD = 10
const LOAD_INCREMENT = 10
const SWIPE_THRESHOLD = 80

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function SwipeableFlightCard({
  flight,
  onEdit,
  onDelete,
  onToggleLock,
}: {
  flight: FlightLog
  onEdit: () => void
  onDelete: () => void
  onToggleLock: () => void
}) {
  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const isLocked = (flight as any).isLocked || false

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
        setSwipeX(Math.max(diffX, -(SWIPE_THRESHOLD * 2 + 20)))
      } else if (swipeX < 0) {
        setSwipeX(Math.min(0, swipeX + diffX))
      }
    }
  }

  const handleTouchEnd = () => {
    setIsSwiping(false)
    if (swipeX < -SWIPE_THRESHOLD) {
      setSwipeX(-SWIPE_THRESHOLD * 2)
    } else {
      setSwipeX(0)
    }
  }

  const handleClick = () => {
    if (swipeX < 0) {
      setSwipeX(0)
    } else if (!isLocked) {
      onEdit()
    }
  }

  const formatTime = (time: string) => time?.slice(0, 5) || "--:--"

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center transition-opacity",
          swipeX < 0 ? "opacity-100" : "opacity-0",
        )}
        style={{ width: SWIPE_THRESHOLD * 2 }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-20 rounded-none bg-secondary text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onToggleLock()
            setSwipeX(0)
          }}
        >
          {isLocked ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-full w-20 rounded-none bg-destructive text-destructive-foreground"
          onClick={(e) => {
            e.stopPropagation()
            if (!isLocked) onDelete()
          }}
          disabled={isLocked}
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </div>

      <Card
        className={cn(
          "bg-card border-border cursor-pointer relative",
          !isSwiping && "transition-transform duration-200",
          isLocked && "opacity-75",
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
                {isLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
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
                {flight.nightTime && flight.nightTime !== "00:00" && (
                  <Badge variant="secondary" className="text-xs flex items-center gap-1 font-mono">
                    <Moon className="h-3 w-3" /> {formatHHMMDisplay(flight.nightTime)}
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
  onFlightVisible,
  showMonthHeaders = false,
  hideFilters = false,
}: FlightListProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD)
  const [deleteTarget, setDeleteTarget] = useState<FlightLog | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const observerRef = useRef<IntersectionObserver | null>(null)
  const flightRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Set up intersection observer for flight visibility tracking
  useEffect(() => {
    if (!onFlightVisible) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible flight
        let topmostFlight: FlightLog | null = null
        let topmostY = Number.POSITIVE_INFINITY

        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const rect = entry.boundingClientRect
            if (rect.top < topmostY && rect.top >= 0) {
              topmostY = rect.top
              const flightId = entry.target.id.replace("flight-", "")
              topmostFlight = flights.find((f) => f.id === flightId) || null
            }
          }
        })

        if (topmostFlight) {
          onFlightVisible(topmostFlight)
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -80% 0px" },
    )

    flightRefs.current.forEach((element) => {
      observerRef.current?.observe(element)
    })

    return () => {
      observerRef.current?.disconnect()
    }
  }, [flights, onFlightVisible])

  // Group flights by month
  const flightsByMonth = useMemo(() => {
    if (!showMonthHeaders) return null

    const grouped: { month: string; year: number; monthNum: number; flights: FlightLog[] }[] = []
    const monthMap = new Map<string, FlightLog[]>()

    flights.forEach((flight) => {
      const date = new Date(flight.date)
      const key = `${date.getFullYear()}-${date.getMonth()}`
      if (!monthMap.has(key)) {
        monthMap.set(key, [])
      }
      monthMap.get(key)!.push(flight)
    })

    monthMap.forEach((monthFlights, key) => {
      const [year, month] = key.split("-").map(Number)
      grouped.push({
        month: MONTHS[month],
        year,
        monthNum: month,
        flights: monthFlights,
      })
    })

    grouped.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      return b.monthNum - a.monthNum
    })

    return grouped
  }, [flights, showMonthHeaders])

  const visibleFlights = useMemo(() => flights.slice(0, visibleCount), [flights, visibleCount])
  const hasMore = visibleCount < flights.length

  const loadMore = () => {
    setVisibleCount((prev) => Math.min(prev + LOAD_INCREMENT, flights.length))
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

  const handleToggleLock = async (flight: FlightLog) => {
    const { updateFlight } = await import("@/lib/indexed-db")
    await updateFlight(flight.id, { isLocked: !(flight as any).isLocked })
    onDeleted?.() // Refresh list
  }

  const registerFlightRef = (id: string, element: HTMLDivElement | null) => {
    if (element) {
      flightRefs.current.set(id, element)
      observerRef.current?.observe(element)
    } else {
      const existing = flightRefs.current.get(id)
      if (existing) {
        observerRef.current?.unobserve(existing)
        flightRefs.current.delete(id)
      }
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

  const renderFlightCard = (flight: FlightLog) => (
    <div key={flight.id} id={`flight-${flight.id}`} ref={(el) => registerFlightRef(flight.id, el)}>
      <SwipeableFlightCard
        flight={flight}
        onEdit={() => onEdit?.(flight)}
        onDelete={() => setDeleteTarget(flight)}
        onToggleLock={() => handleToggleLock(flight)}
      />
    </div>
  )

  return (
    <>
      <div className="space-y-3">
        {showMonthHeaders && flightsByMonth
          ? flightsByMonth.map(({ month, year, flights: monthFlights }) => (
              <div key={`${year}-${month}`} className="space-y-3">
                <div className="sticky top-24 z-10 bg-background/95 backdrop-blur-sm py-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {month} {year}
                  </h3>
                </div>
                {monthFlights.slice(0, visibleCount).map(renderFlightCard)}
              </div>
            ))
          : visibleFlights.map(renderFlightCard)}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="ghost" onClick={loadMore} className="gap-2">
              <ChevronDown className="h-4 w-4" />
              Load More ({flights.length - visibleCount} remaining)
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Flight</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this flight? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
