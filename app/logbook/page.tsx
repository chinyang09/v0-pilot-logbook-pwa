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

  const filteredFlights = useMemo(() => {
    let result = flights

    // Date filter from calendar
    if (selectedDate) {
      result = result.filter((f) => f.date === selectedDate)
    }

    // Search filter based on active type
    if (searchQuery && activeFilterType !== "none") {
      const query = searchQuery.toLowerCase()
      result = result.filter((flight) => {
        switch (activeFilterType) {
          case "flight":
            return flight.flightNumber?.toLowerCase().includes(query)
          case "aircraft":
            const ac = aircraft.find((a) => a.id === flight.aircraftId)
            return ac?.registration?.toLowerCase().includes(query) || ac?.type?.toLowerCase().includes(query)
          case "airport":
            return (
              flight.departureIcao?.toLowerCase().includes(query) || flight.arrivalIcao?.toLowerCase().includes(query)
            )
          case "crew":
            const crewNames = flight.crewIds
              ?.map((id) => {
                const p = personnel.find((per) => per.id === id)
                return p ? `${p.firstName} ${p.lastName}`.toLowerCase() : ""
              })
              .join(" ")
            return crewNames?.includes(query)
          default:
            return true
        }
      })
    }

    return result
  }, [flights, selectedDate, searchQuery, activeFilterType, aircraft, personnel])

  const clearAllFilters = () => {
    setSelectedDate(null)
    setActiveFilterType("none")
    setSearchQuery("")
  }

  const hasActiveFilters = selectedDate || (searchQuery && activeFilterType !== "none")

  const isLoading = dbLoading || !dbReady

  return (
    <div className="min-h-screen bg-background flex flex-col">
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

      <main className="flex-1 flex flex-col pt-28 pb-24">
        {showCalendar && (
          <div className="container mx-auto px-4 mb-4">
            <div className="bg-card rounded-lg border border-border p-3">
              <LogbookCalendar
                ref={calendarRef}
                flights={flights}
                selectedMonth={selectedMonth}
                onMonthChange={setSelectedMonth}
                onDateSelect={handleDateSelect}
                selectedDate={selectedDate}
              />
            </div>
          </div>
        )}

        <div className="container mx-auto px-4 mb-4">
          <div className="flex flex-col gap-3">
            {/* Button group for filter type */}
            <div className="flex items-center gap-1 p-1 bg-secondary/30 rounded-lg">
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
                    if (activeFilterType === filter.id) setSearchQuery("")
                  }}
                  className="flex-1 text-xs h-8"
                >
                  {filter.label}
                </Button>
              ))}
            </div>

            {/* Search bar - visible when a filter type is selected */}
            {activeFilterType !== "none" && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={`Search by ${activeFilterType}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-9 h-9 bg-input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
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

        <div className="flex-1 container mx-auto px-4" ref={flightListRef}>
          <FlightList
            flights={filteredFlights}
            isLoading={flightsLoading || isLoading}
            onEdit={handleEditFlight}
            onDeleted={handleFlightDeleted}
            aircraft={aircraft}
            airports={airports}
            personnel={personnel}
            onFlightVisible={handleFlightVisible}
            showMonthHeaders={!selectedDate && !searchQuery}
            hideFilters={true}
          />
        </div>
      </main>

      <BottomNavbar />
      <PWAInstallPrompt />
    </div>
  )
}
