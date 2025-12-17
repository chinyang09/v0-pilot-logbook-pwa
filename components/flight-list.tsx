"use client"

import type React from "react"

import { useState, useMemo, useRef, useEffect } from "react"
import type { FlightLog, Aircraft, Airport, Personnel } from "@/lib/indexed-db"
import { deleteFlight } from "@/lib/indexed-db"
import { formatHHMMDisplay } from "@/lib/time-utils"
import { syncService } from "@/lib/sync-service"
import { Card, CardContent } from "@/components/ui/card"
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
import { Plane, ChevronDown, Trash2, Lock, Unlock, Sun, Moon, FileEdit } from "lucide-react"
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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

function SwipeableFlightCard({
  flight,
  onEdit,
  onDelete,
  onToggleLock,
  personnel = [],
}: {
  flight: FlightLog
  onEdit: () => void
  onDelete: () => void
  onToggleLock: () => void
  personnel?: Personnel[]
}) {
  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const isLocked = flight.isLocked || false
  const isDraft = flight.isDraft || false

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

  const flightDate = new Date(flight.date)
  const day = flightDate.getDate().toString().padStart(2, "0")
  const month = MONTHS[flightDate.getMonth()]
  const year = flightDate.getFullYear().toString().slice(2)

  const totalDayLandings = flight.dayLandings || 0
  const totalNightLandings = flight.nightLandings || 0

  const crewNames = useMemo(() => {
    const names: string[] = []

    if (flight.picName && flight.picName !== "Self") {
      names.push(flight.picName)
    }
    if (flight.sicName && flight.sicName !== "Self") {
      names.push(flight.sicName)
    }
    if (flight.additionalCrew && Array.isArray(flight.additionalCrew)) {
      flight.additionalCrew.forEach((crew) => {
        if (crew.name) names.push(crew.name)
      })
    }

    return names
  }, [flight.picName, flight.sicName, flight.additionalCrew])

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
          isDraft && "border-dashed border-primary/50",
        )}
        style={{ transform: `translateX(${swipeX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        <CardContent className="p-1">
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-center justify-start shrink-0 w-16">
              <div className="text-6xl font-bold leading-none tracking-tight">{day}</div>
              <div className="text-base text-muted-foreground mt-0.5 tracking-wide">
                {month} {year}
              </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-base font-semibold leading-tight">
                    {flight.outTime?.slice(0, 5) || "--:--"}
                  </span>
                  <div className="flex items-center gap-1 flex-1 justify-center">
                    <div className="h-px flex-1 bg-border max-w-[40px]" />
                    <span className="text-base font-medium whitespace-nowrap px-1">
                      {formatHHMMDisplay(flight.blockTime)} hrs
                    </span>
                    <div className="h-px flex-1 bg-border max-w-[40px]" />
                  </div>
                  <span className="text-base font-semibold leading-tight">{flight.inTime?.slice(0, 5) || "--:--"}</span>
                </div>

                <div className="flex items-center justify-between mt-0">
                  <span className="text-2xl font-bold leading-tight tracking-tight">
                    {flight.departureIcao || "----"}
                  </span>
                  <span className="text-2xl font-bold leading-tight tracking-tight">
                    {flight.arrivalIcao || "----"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground leading-tight mt-0.5">
                <span>{flight.flightNumber || "----"}</span>
                <span>•</span>
                <span>{flight.aircraftReg || "----"}</span>
                <span>•</span>
                <span>{flight.aircraftType || "----"}</span>
              </div>

              <div className="flex items-center justify-between mt-0.5">
                <div className="text-xs text-muted-foreground truncate flex-1 leading-tight">
                  {crewNames.length > 0 ? crewNames.join(", ") : ""}
                </div>

                <div className="flex items-center gap-1.5 text-xs font-medium shrink-0 ml-2">
                  {totalDayLandings > 0 && (
                    <div className="flex items-center gap-0.5">
                      <Sun className="h-3 w-3" />
                      <span>{totalDayLandings}D</span>
                    </div>
                  )}
                  {totalNightLandings > 0 && (
                    <div className="flex items-center gap-0.5">
                      <Moon className="h-3 w-3" />
                      <span>{totalNightLandings}N</span>
                    </div>
                  )}
                  {isDraft && <FileEdit className="h-3 w-3 text-primary" />}
                  {isLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
                </div>
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
  const lastReportedMonthRef = useRef<string>("")

  useEffect(() => {
    if (!onFlightVisible) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const intersecting: { flight: FlightLog; top: number }[] = []

        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const flightId = entry.target.id.replace("flight-", "")
            const flight = flights.find((f) => f.id === flightId)
            if (flight) {
              intersecting.push({
                flight,
                top: entry.boundingClientRect.top,
              })
            }
          }
        })

        flightRefs.current.forEach((element, id) => {
          const rect = element.getBoundingClientRect()
          if (rect.top >= -50 && rect.top < window.innerHeight * 0.5) {
            const flight = flights.find((f) => f.id === id)
            if (flight && !intersecting.find((i) => i.flight.id === id)) {
              intersecting.push({ flight, top: rect.top })
            }
          }
        })

        if (intersecting.length > 0) {
          intersecting.sort((a, b) => a.top - b.top)
          const topmostFlight = intersecting[0].flight

          const flightDate = new Date(topmostFlight.date)
          const monthKey = `${flightDate.getFullYear()}-${flightDate.getMonth()}`

          if (monthKey !== lastReportedMonthRef.current) {
            lastReportedMonthRef.current = monthKey
            onFlightVisible(topmostFlight)
          }
        }
      },
      {
        threshold: [0, 0.1, 0.5, 1],
        rootMargin: "-100px 0px -50% 0px",
      },
    )

    flightRefs.current.forEach((element) => {
      observerRef.current?.observe(element)
    })

    return () => {
      observerRef.current?.disconnect()
    }
  }, [flights, onFlightVisible])

  useEffect(() => {
    if (!onFlightVisible) return

    const handleScroll = () => {
      let topmostFlight: FlightLog | null = null
      let topmostY = Number.POSITIVE_INFINITY

      flightRefs.current.forEach((element, id) => {
        const rect = element.getBoundingClientRect()
        if (rect.top >= -50 && rect.top < topmostY && rect.top < window.innerHeight * 0.4) {
          topmostY = rect.top
          topmostFlight = flights.find((f) => f.id === id) || null
        }
      })

      if (topmostFlight) {
        const flightDate = new Date(topmostFlight.date)
        const monthKey = `${flightDate.getFullYear()}-${flightDate.getMonth()}`

        if (monthKey !== lastReportedMonthRef.current) {
          lastReportedMonthRef.current = monthKey
          onFlightVisible(topmostFlight)
        }
      }
    }

    let ticking = false
    const throttledScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll()
          ticking = false
        })
        ticking = true
      }
    }

    const scrollContainer = document.querySelector("main .overflow-y-auto")
    scrollContainer?.addEventListener("scroll", throttledScroll, { passive: true })

    return () => {
      scrollContainer?.removeEventListener("scroll", throttledScroll)
    }
  }, [flights, onFlightVisible])

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
    await updateFlight(flight.id, { isLocked: !flight.isLocked })
    onDeleted?.()
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
        personnel={personnel}
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
