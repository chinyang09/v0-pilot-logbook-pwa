"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { FlightForm } from "@/components/flight-form"
import { FlightList } from "@/components/flight-list"
import { StatsDashboard } from "@/components/stats-dashboard"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { Button } from "@/components/ui/button"
import { getAllFlights, getFlightStats, type FlightLog } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { Plus } from "lucide-react"

export default function Home() {
  const [flights, setFlights] = useState<FlightLog[]>([])
  const [stats, setStats] = useState({
    totalFlights: 0,
    totalTime: 0,
    picTime: 0,
    nightTime: 0,
    ifrTime: 0,
    totalLandings: 0,
    uniqueAircraft: 0,
    uniqueAirports: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const loadData = async () => {
    try {
      const [flightData, statsData] = await Promise.all([getAllFlights(), getFlightStats()])
      setFlights(flightData)
      setStats(statsData)
    } catch (error) {
      console.error("Failed to load data:", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    // Try to sync on mount if online
    if (navigator.onLine) {
      syncService.syncPendingChanges()
    }
  }, [])

  const handleFlightAdded = (flight: FlightLog) => {
    setFlights((prev) => [flight, ...prev])
    setStats((prev) => ({
      ...prev,
      totalFlights: prev.totalFlights + 1,
      totalTime: prev.totalTime + flight.totalTime,
      picTime: prev.picTime + flight.picTime,
      nightTime: prev.nightTime + flight.nightTime,
      ifrTime: prev.ifrTime + flight.ifrTime,
      totalLandings: prev.totalLandings + flight.landings,
    }))
    setShowForm(false)

    // Try to sync the new flight
    syncService.syncPendingChanges()
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-6 pb-24 space-y-6">
        {/* Stats Dashboard */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Overview</h2>
          <StatsDashboard stats={stats} />
        </section>

        {/* Flight Form / Add Button */}
        <section>
          {showForm ? (
            <FlightForm onFlightAdded={handleFlightAdded} onClose={() => setShowForm(false)} />
          ) : (
            <Button onClick={() => setShowForm(true)} className="w-full" size="lg">
              <Plus className="h-5 w-5 mr-2" />
              Log New Flight
            </Button>
          )}
        </section>

        {/* Flight List */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Recent Flights</h2>
          <FlightList flights={flights} isLoading={isLoading} />
        </section>
      </main>

      <PWAInstallPrompt />
    </div>
  )
}
