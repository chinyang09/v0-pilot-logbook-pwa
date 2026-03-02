"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { FlightList, type FlightListRef } from "@/components/flight-list"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useDebounce } from "@/hooks/use-debounce"
import { LogbookCalendar, type CalendarHandle } from "@/components/logbook-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type FlightLog } from "@/lib/db"
import { syncService } from "@/lib/sync"
import { useCreateFlight } from "@/hooks/use-create-flight"
import {
  useFlights,
  refreshAllData,
  useDBReady,
  useAircraft,
  useAirportDatabase,
  usePersonnel,
} from "@/hooks/data"
import { Calendar, Plus, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { StandardPageHeader } from "@/components/standard-page-header"
import { cn } from "@/lib/utils"
import { CSVImportButton } from "@/components/csv-import-button"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useSearchParams } from "next/navigation"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function parseDateLocal(dateStr: string): Date {
  if (!dateStr || typeof dateStr !== "string") {
    return new Date()
  }

  const parts = dateStr.split("-")
  if (parts.length !== 3) {
    return new Date()
  }

  let year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])

  if (year < 100) {
    year = 2000 + year
  }

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return new Date()
  }

  return new Date(year, month - 1, day)
}

// Persists top flight ID across layout switches (mobile ↔ desktop remounts)
let savedTopFlightId: string | null = null

export default function LogbookPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isDesktop = useIsDesktop()
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()

  const { flights, isLoading: flightsLoading, refresh: refreshFlights } = useFlights()
  const { aircraft } = useAircraft()
  const { airports } = useAirportDatabase()
  const { personnel } = usePersonnel()
  const createFlight = useCreateFlight()

  // Initialize calendar state from URL (preserves state when switching layouts)
  const [showCalendar, setShowCalendar] = useState(() => {
    if (typeof window !== "undefined") {
      return searchParams.get("calendar") === "true"
    }
    return false
  })

  // Sync calendar state to URL
  const toggleCalendar = useCallback((show: boolean) => {
    setShowCalendar(show)
    const url = new URL(window.location.href)
    if (show) {
      url.searchParams.set("calendar", "true")
    } else {
      url.searchParams.delete("calendar")
    }
    window.history.replaceState({}, "", url.toString())
  }, [])
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [activeFilterType, setActiveFilterType] = useState<"none" | "flight" | "aircraft" | "airport" | "crew">("none")
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearchQuery = useDebounce(searchQuery, 150)
  const [searchFocused, setSearchFocused] = useState(false)
  const [selectedFilters, setSelectedFilters] = useState<string[]>([])
  const { handleScroll } = useScrollNavbarContext()

  // Detail panel integration
  // The layout now renders FlightForm directly based on selectedId (Smart Switcher pattern).
  // This page only manages selection state - no more pushing ReactNodes via setDetailContent.
  const {
    selectedId: selectedFlightId,
    setSelectedId: setSelectedFlightId,
    setHasDetailSupport,
  } = useDetailPanel()

  // Register detail panel support
  useEffect(() => {
    setHasDetailSupport(true)
    return () => setHasDetailSupport(false)
  }, [setHasDetailSupport])

  const calendarRef = useRef<CalendarHandle>(null)
  const flightListRef = useRef<FlightListRef>(null)
  const calendarContainerRef = useRef<HTMLDivElement>(null)

  // Measure calendar's natural height once for fixed spacer (not animated via ResizeObserver)
  const [calendarNaturalHeight, setCalendarNaturalHeight] = useState(0)

  useEffect(() => {
    const el = calendarContainerRef.current
    if (!el) return
    // scrollHeight gives natural content height regardless of max-height constraint
    const measure = () => {
      const h = el.scrollHeight
      if (h > 0) setCalendarNaturalHeight(h)
    }
    measure()
    // Re-measure on resize (panel width changes affect calendar height)
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Restore scroll position after layout switch (mobile ↔ desktop remount)
  const hasRestoredScrollRef = useRef(false)
  useEffect(() => {
    if (hasRestoredScrollRef.current) return
    if (!flights.length || flightsLoading) return
    hasRestoredScrollRef.current = true

    if (savedTopFlightId && flights.some(f => f.id === savedTopFlightId)) {
      requestAnimationFrame(() => {
        flightListRef.current?.scrollToFlight(savedTopFlightId!, true)
      })
    }
  }, [flights, flightsLoading])

  const syncSourceRef = useRef<"calendar" | "flights" | null>(null)
  const selectedMonthRef = useRef(selectedMonth)
  const showCalendarRef = useRef(showCalendar)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    selectedMonthRef.current = selectedMonth
  }, [selectedMonth])

  useEffect(() => {
    showCalendarRef.current = showCalendar
  }, [showCalendar])

  const handleCalendarMonthChange = useCallback(
    (year: number, month: number) => {
      setSelectedMonth({ year, month })
      selectedMonthRef.current = { year, month }

      if (syncSourceRef.current !== "calendar") {
        return
      }

      const monthFlights = flights.filter((f) => {
        const date = parseDateLocal(f.date)
        return date.getFullYear() === year && date.getMonth() === month
      })

      if (monthFlights.length > 0) {
        // Sort by date (newest first), then by time within the same date (latest first)
        const sortedFlights = [...monthFlights].sort((a, b) => {
          const dateComparison = parseDateLocal(b.date).getTime() - parseDateLocal(a.date).getTime()
          if (dateComparison !== 0) return dateComparison
          // Within same date, sort by outTime (latest first)
          const timeA = a.outTime || "00:00"
          const timeB = b.outTime || "00:00"
          return timeB.localeCompare(timeA)
        })
        flightListRef.current?.scrollToFlight(sortedFlights[0].id)
      }
    },
    [flights],
  )

  const handleFlightScroll = useCallback(
    (topFlight: FlightLog | null) => {
      if (!topFlight) return
      // Always persist for scroll restoration across layout switches
      savedTopFlightId = topFlight.id

      if (!showCalendarRef.current) return
      if (syncSourceRef.current !== "flights") return

      const flightDate = parseDateLocal(topFlight.date)
      const newYear = flightDate.getFullYear()
      const newMonth = flightDate.getMonth()

      if (newYear !== selectedMonthRef.current.year || newMonth !== selectedMonthRef.current.month) {
        selectedMonthRef.current = { year: newYear, month: newMonth }
        setSelectedMonth({ year: newYear, month: newMonth })
        calendarRef.current?.scrollToMonth(newYear, newMonth)
      }
    },
    [],
  )

  const handleCalendarScrollStart = useCallback(() => {
    syncSourceRef.current = "calendar"
  }, [])

  const handleFlightScrollStart = useCallback(() => {
    syncSourceRef.current = "flights"
  }, [])

  const handleDateSelect = useCallback((date: string) => {
    // Scroll to the first flight on this date instead of filtering
    const flight = flights.find(f => f.date === date)
    if (flight) {
      syncSourceRef.current = "calendar"
      flightListRef.current?.scrollToFlight(flight.id)
    }
  }, [flights])

  // Handle flight selection from list
  // Sets selectedId which the AppShell renders as:
  // - Desktop: FlightForm in right detail panel
  // - Mobile: FlightForm in full-screen overlay
  const handleEditFlight = useCallback((flight: FlightLog) => {
    setSelectedFlightId(flight.id)
  }, [setSelectedFlightId])

  const handleFlightDeleted = async () => {
    await refreshFlights()
  }

  const filterOptions = useMemo(() => {
    const options = new Set<string>()
    const query = debouncedSearchQuery.toLowerCase()

    switch (activeFilterType) {
      case "flight":
        flights.forEach((f) => {
          if (f.flightNumber && f.flightNumber.toLowerCase().includes(query)) {
            options.add(f.flightNumber)
          }
        })
        break
      case "aircraft":
        aircraft.forEach((a) => {
          if (
            (a.registration && a.registration.toLowerCase().includes(query)) ||
            (a.type && a.type.toLowerCase().includes(query))
          ) {
            options.add(`${a.registration} (${a.type})`)
          }
        })
        break
      case "airport":
        airports.forEach((a) => {
          if ((a.icao && a.icao.toLowerCase().includes(query)) || (a.name && a.name.toLowerCase().includes(query))) {
            options.add(`${a.icao} - ${a.name}`)
          }
        })
        break
      case "crew":
        personnel.forEach((p) => {
          const name = p.name || ""
          if (name.toLowerCase().includes(query)) {
            options.add(name)
          }
        })
        break
    }

    return Array.from(options).slice(0, 10)
  }, [activeFilterType, debouncedSearchQuery, flights, aircraft, airports, personnel])

  const filteredFlights = useMemo(() => {
    let result = flights

    if (selectedFilters.length > 0 && activeFilterType !== "none") {
      result = result.filter((flight) => {
        switch (activeFilterType) {
          case "flight":
            return selectedFilters.some((filter) => flight.flightNumber === filter)
          case "aircraft":
            const acLabel = flight.aircraftReg ? `${flight.aircraftReg} (${flight.aircraftType})` : ""
            return selectedFilters.includes(acLabel)
          case "airport":
            return selectedFilters.some((filter) => {
              const icao = filter.split(" - ")[0]
              return flight.departureIcao === icao || flight.arrivalIcao === icao
            })
          case "crew":
            return selectedFilters.some((filter) => {
              if (flight.picName === filter || flight.sicName === filter) return true
              if (flight.additionalCrew?.some((c) => c.name === filter)) return true
              return false
            })
          default:
            return true
        }
      })
    }

    return result
  }, [flights, selectedFilters, activeFilterType])

  const clearAllFilters = () => {
    setSelectedDate(null)
    setActiveFilterType("none")
    setSearchQuery("")
    setSelectedFilters([])
  }

  const toggleFilterOption = (option: string) => {
    setSelectedFilters((prev) => (prev.includes(option) ? prev.filter((f) => f !== option) : [...prev, option]))
  }

  const hasActiveFilters = selectedFilters.length > 0
  const isLoading = dbLoading || !dbReady

  return (
    <div className="h-full relative flex flex-col">
      {/* Combined header + calendar overlay - single continuous frosted glass */}
      <div className="absolute top-0 left-0 right-0 z-50 bg-background/30 backdrop-blur-xl border-b border-border/50">
        <StandardPageHeader
          title={showCalendar ? `${MONTHS[selectedMonth.month]} ${selectedMonth.year}` : "Logbook"}
          className="bg-transparent backdrop-blur-none border-b-0"
          actions={
            <>
              <Button
                variant={showCalendar ? "default" : "ghost"}
                size="icon-sm"
                onClick={() => {
                  toggleCalendar(!showCalendar)
                  setSelectedDate(null)
                  setSearchFocused(false)
                }}
              >
                <Calendar className="h-4 w-4" />
              </Button>

              <CSVImportButton
                onComplete={() => {
                  refreshAllData()
                }}
              />

              <Button
                size="icon-sm"
                onClick={async () => {
                  const draftFlight = await createFlight()
                  await refreshFlights()
                  setSelectedFlightId(draftFlight.id)
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </>
          }
        />
        {/* Calendar collapse section */}
        <div
          ref={calendarContainerRef}
          className={cn(
            "transition-[max-height,opacity] duration-300 ease-in-out overflow-hidden",
            showCalendar ? "opacity-100" : "max-h-0 opacity-0 pointer-events-none",
          )}
          style={showCalendar ? { maxHeight: `${calendarNaturalHeight}px` } : undefined}
        >
          <LogbookCalendar
            ref={calendarRef}
            className="bg-transparent shadow-none border-none"
            flights={flights}
            selectedMonth={selectedMonth}
            onMonthChange={handleCalendarMonthChange}
            onDateSelect={handleDateSelect}
            selectedDate={selectedDate}
            onScrollStart={handleCalendarScrollStart}
          />
        </div>
      </div>

      {/* FLIGHT LIST */}
      <main className="flex-1 overflow-hidden overscroll-contain relative">
        <FlightList
          ref={flightListRef}
          flights={filteredFlights}
          allFlights={flights}
          isLoading={flightsLoading || isLoading}
          onEdit={handleEditFlight}
          onDeleted={handleFlightDeleted}
          onTopFlightChange={handleFlightScroll}
          onScrollStart={handleFlightScrollStart}
          onScroll={handleScroll}
          topSpacerHeight={48 + (showCalendar ? calendarNaturalHeight : 0)}
          selectedFlightId={selectedFlightId}
          headerContent={
            <div className="flex-shrink-0 top-0 z-40 px-2 py-1">
              <div className="relative">
                <Input
                  placeholder="Search flights..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  className="pl-10 h-10 bg-background/30 backdrop-blur-xl border-border"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                {searchFocused && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchFocused(false)
                      setSearchQuery("")
                      setActiveFilterType("none")
                      setSelectedFilters([])
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-sm text-primary font-medium"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* Filter type buttons */}
              {searchFocused && (
                <div className="flex items-center gap-1.5 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  {[
                    { id: "flight", label: "Flight" },
                    { id: "aircraft", label: "Aircraft" },
                    { id: "airport", label: "Airport" },
                    { id: "crew", label: "Crew" },
                  ].map((filter) => (
                    <Button
                      key={filter.id}
                      variant={activeFilterType === filter.id ? "secondary" : "ghost"}
                      size="sm"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setActiveFilterType(
                          activeFilterType === filter.id ? "none" : (filter.id as typeof activeFilterType),
                        )
                        if (activeFilterType === filter.id) {
                          setSearchQuery("")
                          setSelectedFilters([])
                        }
                      }}
                      className="flex-1 text-xs h-8 font-medium"
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              )}

              {/* Selected filter chips */}
              {selectedFilters.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3 animate-in fade-in duration-200">
                  {selectedFilters.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => toggleFilterOption(filter)}
                      className="px-2.5 py-1 bg-primary/20 text-primary text-xs rounded-full flex items-center gap-1 font-medium hover:bg-primary/30 transition-colors"
                    >
                      {filter}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}

              {/* Filter results count */}
              {hasActiveFilters && !searchFocused && (
                <div className="flex items-center justify-between mt-2 animate-in fade-in duration-200">
                  <span className="text-xs text-muted-foreground">
                    {filteredFlights.length} flight
                    {filteredFlights.length !== 1 ? "s" : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="text-xs h-7 hover:bg-destructive/10"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear filters
                  </Button>
                </div>
              )}

              {/* Search suggestions dropdown */}
              {searchFocused && activeFilterType !== "none" && filterOptions.length > 0 && (
                <div className="mt-2 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                  {filterOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        toggleFilterOption(option)
                      }}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                        selectedFilters.includes(option) && "bg-primary/10 text-primary",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />
      </main>
    </div>
  )
}
