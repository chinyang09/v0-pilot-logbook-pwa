"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { FlightList, type FlightListRef } from "@/components/flight-list"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { BottomNavbar } from "@/components/bottom-navbar"
import { LogbookCalendar, type CalendarHandle } from "@/components/logbook-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FlightLog } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { useFlights, refreshAllData, useDBReady, useAircraft, useAirports, usePersonnel } from "@/hooks/use-indexed-db"
import { Calendar, Plus, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { SyncStatus } from "@/components/sync-status"
import { cn } from "@/lib/utils"
import { CSVImportButton } from "@/components/csv-import-button"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export default function LogbookPage() {
  const currentUserId = "user_12345"
  const currentUserName = "Lim Chin Yang"

  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      if (e.message.includes("ResizeObserver loop")) {
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener("error", handleError)
    return () => window.removeEventListener("error", handleError)
  }, [])

  const router = useRouter()
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()
  const { flights, isLoading: flightsLoading, refresh: refreshFlights } = useFlights()
  const { aircraft } = useAircraft()
  const { airports } = useAirports()
  const { personnel } = usePersonnel()

  const [showCalendar, setShowCalendar] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [activeFilterType, setActiveFilterType] = useState<"none" | "flight" | "aircraft" | "airport" | "crew">("none")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [selectedFilters, setSelectedFilters] = useState<string[]>([])
  const [hideNavbar, setHideNavbar] = useState(false)

  const calendarRef = useRef<CalendarHandle>(null)
  const flightListRef = useRef<FlightListRef>(null)

  const syncSourceRef = useRef<"calendar" | "flights" | null>(null)
  const syncLockRef = useRef(false)
  const hideNavbarTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  const handleCalendarMonthChange = useCallback(
    (year: number, month: number) => {
      setSelectedMonth({ year, month })

      if (syncSourceRef.current !== "calendar" || syncLockRef.current) {
        return
      }

      syncLockRef.current = true

      const monthFlights = flights.filter((f) => {
        const date = new Date(f.date)
        return date.getFullYear() === year && date.getMonth() === month
      })

      if (monthFlights.length > 0) {
        const sortedFlights = [...monthFlights].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        flightListRef.current?.scrollToFlight(sortedFlights[0].id, sortedFlights[0].date)
      }

      setTimeout(() => {
        syncLockRef.current = false
        syncSourceRef.current = null
      }, 400)
    },
    [flights],
  )

  const handleFlightScroll = useCallback(
    (topFlight: FlightLog | null) => {
      if (!showCalendar || !topFlight) return

      if (syncSourceRef.current !== "flights" || syncLockRef.current) {
        return
      }

      const flightDate = new Date(topFlight.date)
      const newYear = flightDate.getFullYear()
      const newMonth = flightDate.getMonth()

      if (newYear !== selectedMonth.year || newMonth !== selectedMonth.month) {
        syncLockRef.current = true
        setSelectedMonth({ year: newYear, month: newMonth })
        calendarRef.current?.scrollToMonth(newYear, newMonth)

        setTimeout(() => {
          syncLockRef.current = false
          syncSourceRef.current = null
        }, 400)
      }
    },
    [selectedMonth, showCalendar],
  )

  const handleCalendarScrollStart = useCallback(() => {
    if (!syncLockRef.current) {
      syncSourceRef.current = "calendar"
    }
  }, [])

  const handleFlightScrollStart = useCallback(() => {
    if (!syncLockRef.current) {
      syncSourceRef.current = "flights"
    }
  }, [])

  const handleCalendarSwipeStart = useCallback(() => {
    if (hideNavbarTimeoutRef.current) {
      clearTimeout(hideNavbarTimeoutRef.current)
    }
    setHideNavbar(true)
  }, [])

  const handleCalendarInteractionEnd = useCallback(() => {
    hideNavbarTimeoutRef.current = setTimeout(() => {
      setHideNavbar(false)
    }, 300)
  }, [])

  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate((prev) => (prev === date ? null : date))
  }, [])

  const handleEditFlight = (flight: FlightLog) => {
    router.push(`/new-flight?edit=${flight.id}`)
  }

  const handleFlightDeleted = async () => {
    await refreshFlights()
  }

  const filterOptions = useMemo(() => {
    const options = new Set<string>()
    const query = searchQuery.toLowerCase()

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
  }, [activeFilterType, searchQuery, flights, aircraft, airports, personnel])

  const filteredFlights = useMemo(() => {
    let result = flights

    if (selectedDate) {
      result = result.filter((f) => f.date === selectedDate)
    }

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
  }, [flights, selectedDate, selectedFilters, activeFilterType])

  const clearAllFilters = () => {
    setSelectedDate(null)
    setActiveFilterType("none")
    setSearchQuery("")
    setSelectedFilters([])
  }

  const toggleFilterOption = (option: string) => {
    setSelectedFilters((prev) => (prev.includes(option) ? prev.filter((f) => f !== option) : [...prev, option]))
  }

  const hasActiveFilters = selectedDate || selectedFilters.length > 0
  const isLoading = dbLoading || !dbReady

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header */}
      <header
        className={cn(
          "flex-shrink-0 bg-background/95 backdrop-blur-lg border-b border-border z-50 transition-all duration-300",
          showCalendar ? "h-12" : "h-24",
        )}
      >
        <div className="px-4 h-full relative">
          <div
            className={cn(
              "absolute top-0 left-0 right-0 px-4 h-12 flex items-center justify-between transition-all duration-300",
              searchFocused ? "opacity-0 -translate-y-2 pointer-events-none" : "opacity-100 translate-y-0",
            )}
          >
            <h1 className="text-lg font-semibold text-foreground">
              {showCalendar ? `${MONTHS[selectedMonth.month]} ${selectedMonth.year}` : "Logbook"}
            </h1>

            <div className="flex items-center gap-2">
              <SyncStatus />
              <Button
                variant={showCalendar ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  setShowCalendar(!showCalendar)
                  setSelectedDate(null)
                  setSearchFocused(false)
                }}
                className="gap-2"
              >
                <Calendar className="h-4 w-4" />
              </Button>

              <CSVImportButton userId={currentUserId} userName={currentUserName} onComplete={() => refreshAllData()} />

              <Button size="sm" onClick={() => router.push("/new-flight")} className="gap-2">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {searchFocused && (
            <div className="flex items-center gap-1.5 mt-2 p-0 bg-secondary/30 rounded-lg border border-border animate-in fade-in slide-in-from-top-5 duration-300">
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

          {selectedFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5 animate-in fade-in duration-300 mt-2">
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

          {hasActiveFilters && !searchFocused && (
            <div className="flex items-center justify-between animate-in fade-in duration-300 mt-1">
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

          <div
            className={cn(
              "absolute left-0 right-0 px-2 space-y-2",
              searchFocused
                ? "top-10 opacity-100"
                : showCalendar
                  ? "top-12 opacity-0 pointer-events-none h-0"
                  : "top-12 opacity-100",
            )}
          >
            <div className="relative border border-border rounded-lg p-0 bg-input/50 backdrop-blur-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
              <Input
                placeholder="Search flights..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  setSearchFocused(true)
                  setShowCalendar(false)
                }}
                className="pl-9 pr-20 h-9 bg-transparent border-none"
              />
              {searchFocused && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchFocused(false)
                    setSearchQuery("")
                    setActiveFilterType("none")
                    setSelectedFilters([])
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 px-3 py-1 text-sm text-primary font-medium hover:bg-primary/10 rounded transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Calendar drawer */}
      <div
        className={cn(
          "flex-shrink-0 bg-card border-b border-border overflow-hidden transition-all duration-300",
          showCalendar ? "h-[35vh]" : "h-0",
        )}
      >
        <LogbookCalendar
          ref={calendarRef}
          flights={flights}
          selectedMonth={selectedMonth}
          onMonthChange={handleCalendarMonthChange}
          onDateSelect={handleDateSelect}
          selectedDate={selectedDate}
          onScrollStart={handleCalendarScrollStart}
          onSwipeStart={handleCalendarSwipeStart}
          onInteractionEnd={handleCalendarInteractionEnd}
        />
      </div>

      <main className="flex-1 min-h-0 overflow-hidden pb-safe">
        <FlightList
          ref={flightListRef}
          flights={filteredFlights}
          allFlights={flights}
          isLoading={flightsLoading || isLoading}
          onEdit={handleEditFlight}
          onDeleted={handleFlightDeleted}
          aircraft={aircraft}
          airports={airports}
          personnel={personnel}
          onTopFlightChange={handleFlightScroll}
          onScrollStart={handleFlightScrollStart}
          showMonthHeaders={false}
          hideFilters={true}
        />
      </main>

      <BottomNavbar className={cn("transition-all duration-200", hideNavbar && "translate-y-full opacity-0")} />

      <PWAInstallPrompt />
    </div>
  )
}
