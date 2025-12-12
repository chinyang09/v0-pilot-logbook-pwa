"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Header } from "@/components/header"
import { FlightList } from "@/components/flight-list"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { BottomNavbar } from "@/components/bottom-navbar"
import { LogbookCalendar } from "@/components/logbook-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FlightLog } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { useFlights, refreshAllData, useDBReady, useAircraft, useAirports, usePersonnel } from "@/hooks/use-indexed-db"
import { Calendar, Upload, Plus, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export default function LogbookPage() {
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
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [selectedFilters, setSelectedFilters] = useState<string[]>([])

  const calendarRef = useRef<{ scrollToMonth: (year: number, month: number) => void } | null>(null)
  const flightListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  const handleFlightVisible = useCallback(
    (flight: FlightLog) => {
      if (!showCalendar) return

      const flightDate = new Date(flight.date)
      const year = flightDate.getFullYear()
      const month = flightDate.getMonth()

      if (year !== selectedMonth.year || month !== selectedMonth.month) {
        setSelectedMonth({ year, month })
      }
    },
    [selectedMonth, showCalendar],
  )

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
          const name = `${p.firstName} ${p.lastName}`
          if (name.toLowerCase().includes(query)) {
            options.add(name)
          }
        })
        break
    }

    return Array.from(options).slice(0, 10) // Limit to 10 options
  }, [activeFilterType, searchQuery, flights, aircraft, airports, personnel])

  const filteredFlights = useMemo(() => {
    let result = flights

    // Date filter from calendar
    if (selectedDate) {
      result = result.filter((f) => f.date === selectedDate)
    }

    // Search filter with selected items
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
              const crewNames = flight.crewIds
                ?.map((id) => {
                  const p = personnel.find((per) => per.id === id)
                  return p ? `${p.firstName} ${p.lastName}` : ""
                })
                .filter(Boolean)
              return crewNames?.includes(filter)
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

  const handleMonthChange = useCallback((year: number, month: number) => {
    setSelectedMonth({ year, month })
  }, [])

  const monthFilteredFlights = useMemo(() => {
    if (!showCalendar) return filteredFlights

    return filteredFlights.filter((f) => {
      const date = new Date(f.date)
      return date.getFullYear() === selectedMonth.year && date.getMonth() === selectedMonth.month
    })
  }, [filteredFlights, showCalendar, selectedMonth])

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Header />

      <div className="fixed top-14 left-0 right-0 z-40 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-12">
            <h1 className="text-lg font-semibold text-foreground">{showCalendar ? "" : "Logbook"}</h1>

            {showCalendar && (
              <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-foreground">
                {MONTHS[selectedMonth.month]} {selectedMonth.year}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant={showCalendar ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setShowCalendar(!showCalendar)
                  if (showCalendar) setSelectedDate(null)
                }}
                className="gap-2"
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
        </div>
      </div>

      <main className="flex-1 flex flex-col pt-26 pb-16 overflow-hidden">
        {showCalendar && (
          <div className="flex-shrink-0 bg-card border-b border-border">
            <LogbookCalendar
              ref={calendarRef}
              flights={flights}
              selectedMonth={selectedMonth}
              onMonthChange={handleMonthChange}
              onDateSelect={handleDateSelect}
              selectedDate={selectedDate}
            />
          </div>
        )}

        <div className="container mx-auto px-4 py-3 flex-shrink-0">
          <div className="flex flex-col gap-3">
            {activeFilterType !== "none" && (
              <div className="relative border border-border rounded-lg p-1 bg-input">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  placeholder={`Search ${activeFilterType}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setShowSearchDropdown(true)}
                  className="pl-9 pr-9 h-9 bg-transparent border-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-10"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}

                {showSearchDropdown && filterOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                    {filterOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          toggleFilterOption(option)
                          setSearchQuery("")
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 flex items-center gap-2"
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
            )}

            {/* Button group for filter type with border */}
            <div className="flex items-center gap-1 p-1 bg-secondary/30 rounded-lg border border-border">
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
                  onClick={() => {
                    setActiveFilterType(activeFilterType === filter.id ? "none" : (filter.id as any))
                    if (activeFilterType === filter.id) {
                      setSearchQuery("")
                      setSelectedFilters([])
                    }
                    setShowSearchDropdown(false)
                  }}
                  className="flex-1 text-xs h-8"
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            {/* Selected filters chips */}
            {selectedFilters.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => toggleFilterOption(filter)}
                    className="px-2 py-1 bg-primary/20 text-primary text-xs rounded-md flex items-center gap-1"
                  >
                    {filter}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}

            {/* Active filters summary and clear */}
            {hasActiveFilters && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {filteredFlights.length} flight{filteredFlights.length !== 1 ? "s" : ""}
                  {selectedDate && ` on ${selectedDate}`}
                </span>
                <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 container mx-auto px-4 overflow-y-auto" ref={flightListRef}>
          <FlightList
            flights={monthFilteredFlights}
            isLoading={flightsLoading || isLoading}
            onEdit={handleEditFlight}
            onDeleted={handleFlightDeleted}
            aircraft={aircraft}
            airports={airports}
            personnel={personnel}
            onFlightVisible={handleFlightVisible}
            showMonthHeaders={!selectedDate && selectedFilters.length === 0 && !showCalendar}
            hideFilters={true}
          />
        </div>
      </main>

      <BottomNavbar />
      <PWAInstallPrompt />
    </div>
  )
}
