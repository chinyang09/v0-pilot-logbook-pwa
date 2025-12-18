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
import { Calendar, Upload, Plus, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { SyncStatus } from "@/components/sync-status"
import { cn } from "@/lib/utils"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export default function LogbookPage() {
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
  const lastScrollSourceRef = useRef<{ source: "calendar" | "flights"; timestamp: number } | null>(null)
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

      const now = Date.now()
      // Only sync flights if calendar was last scrolled (within 300ms)
      if (
        lastScrollSourceRef.current?.source === "calendar" &&
        now - lastScrollSourceRef.current.timestamp < 300 &&
        !syncLockRef.current
      ) {
        syncLockRef.current = true

        const monthFlights = flights.filter((f) => {
          const date = new Date(f.date)
          return date.getFullYear() === year && date.getMonth() === month
        })

        if (monthFlights.length > 0) {
          const sortedFlights = [...monthFlights].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          )
          flightListRef.current?.scrollToFlight(sortedFlights[0].id)
        }

        // Release lock after animation completes
        setTimeout(() => {
          syncLockRef.current = false
        }, 350)
      }
    },
    [flights],
  )

  const handleFlightScroll = useCallback(
    (topFlight: FlightLog | null) => {
      if (!showCalendar || !topFlight) return

      const now = Date.now()
      // Only sync calendar if flights was last scrolled (within 300ms)
      if (
        lastScrollSourceRef.current?.source === "flights" &&
        now - lastScrollSourceRef.current.timestamp < 300 &&
        !syncLockRef.current
      ) {
        const flightDate = new Date(topFlight.date)
        const newYear = flightDate.getFullYear()
        const newMonth = flightDate.getMonth()

        if (newYear !== selectedMonth.year || newMonth !== selectedMonth.month) {
          syncLockRef.current = true
          setSelectedMonth({ year: newYear, month: newMonth })
          calendarRef.current?.scrollToMonth(newYear, newMonth)

          setTimeout(() => {
            syncLockRef.current = false
          }, 350)
        }
      }
    },
    [selectedMonth, showCalendar],
  )

  const handleCalendarScrollStart = useCallback(() => {
    lastScrollSourceRef.current = { source: "calendar", timestamp: Date.now() }
    setHideNavbar(true)
  }, [])

  const handleFlightScrollStart = useCallback(() => {
    lastScrollSourceRef.current = { source: "flights", timestamp: Date.now() }
  }, [])

  const handleCalendarInteractionEnd = useCallback(() => {
    setTimeout(() => {
      setHideNavbar(false)
    }, 600)
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
            const ac = aircraft.find((a) => a.id === flight.aircraftId)
            const acLabel = ac ? `${ac.registration} (${ac.type})` : ""
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
  }, [flights, selectedDate, selectedFilters, activeFilterType, aircraft, personnel, airports])

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

  const displayFlights = filteredFlights

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-hidden">
      <div
        className={cn(
          "fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border transition-all duration-500 ease-out",
          showCalendar ? "h-12" : "h-24",
        )}
      >
        <div className="container mx-auto px-4 h-full relative">
          <div
            className={cn(
              "absolute top-0 left-0 right-0 px-4 h-12 flex items-center justify-between transition-all duration-300 ease-out",
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
                className="gap-2 transition-all duration-300"
              >
                <Calendar className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="gap-2" disabled>
                <Upload className="h-4 w-4" />
              </Button>
              <Button size="sm" onClick={() => router.push("/new-flight")} className="gap-2">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "absolute left-0 right-0 px-4 space-y-2 transition-all duration-500 ease-out",
              searchFocused
                ? "top-0 opacity-100"
                : showCalendar
                  ? "top-12 opacity-0 pointer-events-none h-0"
                  : "top-12 mt-2 opacity-100",
            )}
          >
            <div className="relative border border-border rounded-lg p-1 bg-input/50 backdrop-blur-sm">
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
              {searchQuery && !searchFocused && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 hover:bg-secondary/50 rounded-full p-1 transition-colors"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}

              {searchFocused && activeFilterType !== "none" && filterOptions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
                  {filterOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        toggleFilterOption(option)
                        setSearchQuery("")
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 flex items-center gap-2 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFilters.includes(option)}
                        onChange={() => {}}
                        className="h-4 w-4"
                      />
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {searchFocused && (
              <div className="flex items-center gap-1.5 p-1 bg-secondary/30 rounded-lg border border-border animate-in fade-in slide-in-from-top-1 duration-200">
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
                      setActiveFilterType(activeFilterType === filter.id ? "none" : (filter.id as any))
                      if (activeFilterType === filter.id) {
                        setSearchQuery("")
                        setSelectedFilters([])
                      }
                    }}
                    className="flex-1 text-xs h-8 font-medium transition-all duration-200"
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            )}

            {selectedFilters.length > 0 && (
              <div className="flex flex-wrap gap-1.5 animate-in fade-in duration-200">
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
              <div className="flex items-center justify-between animate-in fade-in duration-200">
                <span className="text-xs text-muted-foreground">
                  {filteredFlights.length} flight{filteredFlights.length !== 1 ? "s" : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs h-7 hover:bg-destructive/10 transition-colors"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "fixed left-0 right-0 z-40 bg-card border-b border-border shadow-xl transition-all duration-500 ease-out",
          showCalendar ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none",
        )}
        style={{
          top: "3rem",
          height: "35vh",
        }}
      >
        <LogbookCalendar
          ref={calendarRef}
          flights={flights}
          selectedMonth={selectedMonth}
          onMonthChange={handleCalendarMonthChange}
          onDateSelect={handleDateSelect}
          selectedDate={selectedDate}
          onScrollStart={handleCalendarScrollStart}
          onInteractionEnd={handleCalendarInteractionEnd}
        />
      </div>

      <main
        className="fixed left-0 right-0 bottom-24 flex flex-col overflow-hidden transition-all duration-500 ease-out"
        style={{
          top: showCalendar ? "calc(3rem + 35vh)" : "6rem",
        }}
      >
        <div className="flex-1 overflow-y-auto container mx-auto px-4">
          <FlightList
            ref={flightListRef}
            flights={displayFlights}
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
        </div>
      </main>

      {!hideNavbar && <BottomNavbar />}
      <PWAInstallPrompt />
    </div>
  )
}
