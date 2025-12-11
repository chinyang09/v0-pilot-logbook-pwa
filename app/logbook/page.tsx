"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Header } from "@/components/header"
import { FlightList } from "@/components/flight-list"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { BottomNavbar } from "@/components/bottom-navbar"
import { LogbookCalendar } from "@/components/logbook-calendar"
import { Button } from "@/components/ui/button"
import type { FlightLog } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { useFlights, refreshAllData, useDBReady, useAircraft, useAirports, usePersonnel } from "@/hooks/use-indexed-db"
import { Calendar, Upload, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

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
  const [isToolbarVisible, setIsToolbarVisible] = useState(true)
  const [lastScrollY, setLastScrollY] = useState(0)

  const flightListRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<{ scrollToMonth: (year: number, month: number) => void } | null>(null)
  const isScrollingFromCalendar = useRef(false)
  const isScrollingFromList = useRef(false)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  // Handle toolbar visibility on scroll
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      if (currentScrollY < lastScrollY || currentScrollY < 50) {
        setIsToolbarVisible(true)
      } else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsToolbarVisible(false)
      }

      setLastScrollY(currentScrollY)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [lastScrollY])

  // Group flights by month for syncing
  const flightsByMonth = useMemo(() => {
    const grouped: Record<string, FlightLog[]> = {}
    flights.forEach((flight) => {
      const date = new Date(flight.date)
      const key = `${date.getFullYear()}-${date.getMonth()}`
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(flight)
    })
    return grouped
  }, [flights])

  // Handle calendar month change - sync flight list
  const handleCalendarMonthChange = useCallback(
    (year: number, month: number) => {
      if (isScrollingFromList.current) return

      isScrollingFromCalendar.current = true
      setSelectedMonth({ year, month })

      // Find flights for this month and scroll to them
      const monthKey = `${year}-${month}`
      const monthFlights = flightsByMonth[monthKey]

      if (monthFlights && monthFlights.length > 0 && flightListRef.current) {
        const firstFlightId = monthFlights[0].id
        const flightElement = document.getElementById(`flight-${firstFlightId}`)
        if (flightElement) {
          flightElement.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      }

      setTimeout(() => {
        isScrollingFromCalendar.current = false
      }, 500)
    },
    [flightsByMonth],
  )

  // Handle flight list scroll - sync calendar
  const handleFlightVisible = useCallback(
    (flight: FlightLog) => {
      if (isScrollingFromCalendar.current) return

      const flightDate = new Date(flight.date)
      const year = flightDate.getFullYear()
      const month = flightDate.getMonth()

      if (year !== selectedMonth.year || month !== selectedMonth.month) {
        isScrollingFromList.current = true
        setSelectedMonth({ year, month })

        if (calendarRef.current) {
          calendarRef.current.scrollToMonth(year, month)
        }

        setTimeout(() => {
          isScrollingFromList.current = false
        }, 500)
      }
    },
    [selectedMonth],
  )

  const handleEditFlight = (flight: FlightLog) => {
    router.push(`/new-flight?edit=${flight.id}`)
  }

  const handleFlightDeleted = async () => {
    await refreshFlights()
  }

  const isLoading = dbLoading || !dbReady

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Disappearing Toolbar */}
      <div
        className={cn(
          "fixed top-14 left-0 right-0 z-40 bg-background/95 backdrop-blur-lg border-b border-border transition-transform duration-300",
          !isToolbarVisible && "-translate-y-full",
        )}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-12">
            <h1 className="text-lg font-semibold text-foreground">Logbook</h1>
            <div className="flex items-center gap-2">
              <Button
                variant={showCalendar ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setShowCalendar(!showCalendar)}
                className="gap-2"
              >
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">Calendar</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-2" disabled>
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              <Button size="sm" onClick={() => router.push("/new-flight")} className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 pt-28 pb-24 space-y-4">
        {/* Calendar View */}
        {showCalendar && (
          <LogbookCalendar
            ref={calendarRef}
            flights={flights}
            selectedMonth={selectedMonth}
            onMonthChange={handleCalendarMonthChange}
          />
        )}

        {/* Flight List */}
        <section ref={flightListRef}>
          <FlightList
            flights={flights}
            isLoading={flightsLoading || isLoading}
            onEdit={handleEditFlight}
            onDeleted={handleFlightDeleted}
            aircraft={aircraft}
            airports={airports}
            personnel={personnel}
            onFlightVisible={handleFlightVisible}
            showMonthHeaders
          />
        </section>
      </main>

      <BottomNavbar />

      <PWAInstallPrompt />
    </div>
  )
}
