"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { FlightList, type FlightListRef } from "@/components/flight-list"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { LogbookCalendar, type CalendarHandle } from "@/components/logbook-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FlightLog } from "@/lib/db"
import { syncService } from "@/lib/sync"
import {
  useFlights,
  refreshAllData,
  useDBReady,
  useAircraft,
  useAirportDatabase,
  usePersonnel,
} from "@/hooks/use-indexed-db"
import { ArrowLeft, Calendar, Plus, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { SyncStatus } from "@/components/sync-status"
import { cn } from "@/lib/utils"
import { CSVImportButton } from "@/components/csv-import-button"

const FORM_STORAGE_KEY = "flight-form-draft"

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

export default function LogbookPage() {
  const router = useRouter()
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()
  const { flights, isLoading: flightsLoading, refresh: refreshFlights } = useFlights()
  const { aircraft } = useAircraft()
  const { airports } = useAirportDatabase()
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
  const { handleScroll } = useScrollNavbarContext()

  const calendarRef = useRef<CalendarHandle>(null)
  const flightListRef = useRef<FlightListRef>(null)
  const calendarContainerRef = useRef<HTMLDivElement>(null)

  const HEADER_HEIGHT = 48

  const [calendarHeight, setCalendarHeight] = useState(0)

  useEffect(() => {
    if (calendarContainerRef.current) {
      setCalendarHeight(calendarContainerRef.current.offsetHeight)
    }
  }, [])

  const totalOffset = showCalendar ? calendarHeight + HEADER_HEIGHT : HEADER_HEIGHT

  const syncSourceRef = useRef<"calendar" | "flights" | null>(null)
  const syncLockRef = useRef(false)

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
        const date = parseDateLocal(f.date)
        return date.getFullYear() === year && date.getMonth() === month
      })

      if (monthFlights.length > 0) {
        const sortedFlights = [...monthFlights].sort(
          (a, b) => parseDateLocal(b.date).getTime() - parseDateLocal(a.date).getTime(),
        )
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
      if (syncSourceRef.current !== "flights" || syncLockRef.current) return

      const flightDate = parseDateLocal(topFlight.date)
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
    <>
      {/* HEADER */}
      <header className="flex-none h-12 z-50 bg-background/40 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between h-full px-4">
          {showCalendar ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowCalendar(false)
                setSelectedDate(null)
              }}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          ) : (
            <h1 className="text-lg font-semibold text-foreground">Logbook</h1>
          )}

          {showCalendar && (
            <h1 className="text-lg font-semibold text-foreground">
              {MONTHS[selectedMonth.month]} {selectedMonth.year}
            </h1>
          )}

          <div className="flex items-center gap-2">
            <SyncStatus />
            <Button
              variant={showCalendar ? "default" : "ghost"}
              size="icon"
              onClick={() => {
                setShowCalendar(!showCalendar)
                setSelectedDate(null)
                setSearchFocused(false)
              }}
              className="h-8 w-8"
            >
              <Calendar className="h-4 w-4" />
            </Button>

            <CSVImportButton
              onComplete={() => {
                sessionStorage.removeItem(FORM_STORAGE_KEY)
                refreshAllData()
              }}
            />

            <Button size="icon" onClick={() => router.push("/new-flight")} className="h-8 w-8">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* CALENDAR */}
      <div
        ref={calendarContainerRef}
        className={cn(
          "flex-none z-40 border-b border-white/10 dark:border-white/5",
          "bg-white/60 dark:bg-background/60 backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]",
          "transition-all duration-500 will-change-transform overflow-hidden",
          "max-h-[40vh]",
          showCalendar ? "opacity-100" : "max-h-0 opacity-0",
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)" }}
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

      {/* FLIGHT LIST */}
      <main className="flex-1 overflow-hidden">
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
          topSpacerHeight={0}
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
    </>
  )
}
