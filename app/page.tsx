"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { FlightForm } from "@/components/flight-form"
import { FlightList } from "@/components/flight-list"
import { StatsDashboard } from "@/components/stats-dashboard"
import { ManageData } from "@/components/manage-data"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { Button } from "@/components/ui/button"
import { getAllFlights, getFlightStats, type FlightLog } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { Plus, Database } from "lucide-react"

export default function Home() {
  const [flights, setFlights] = useState<FlightLog[]>([])
  const [stats, setStats] = useState({
    totalFlights: 0,
    blockTime: 0,
    flightTime: 0,
    p1Time: 0,
    p2Time: 0,
    p1usTime: 0,
    dualTime: 0,
    nightTime: 0,
    ifrTime: 0,
    totalDayLandings: 0,
    totalNightLandings: 0,
    uniqueAircraft: 0,
    uniqueAirports: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showManageData, setShowManageData] = useState(false)

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

    if (navigator.onLine) {
      syncService.syncPendingChanges()
    }
  }, [])

  const handleFlightAdded = (flight: FlightLog) => {
    setFlights((prev) => [flight, ...prev])
    setStats((prev) => ({
      ...prev,
      totalFlights: prev.totalFlights + 1,
      blockTime: prev.blockTime + flight.blockTime,
      flightTime: prev.flightTime + flight.flightTime,
      p1Time: prev.p1Time + flight.p1Time,
      p2Time: prev.p2Time + flight.p2Time,
      nightTime: prev.nightTime + flight.nightTime,
      ifrTime: prev.ifrTime + flight.ifrTime,
      totalDayLandings: prev.totalDayLandings + flight.dayLandings,
      totalNightLandings: prev.totalNightLandings + flight.nightLandings,
    }))
    setShowForm(false)

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

        {/* Action Buttons */}
        <section className="flex gap-3">
          <Button
            onClick={() => {
              setShowForm(!showForm)
              setShowManageData(false)
            }}
            className="flex-1"
            size="lg"
            variant={showForm ? "secondary" : "default"}
          >
            <Plus className="h-5 w-5 mr-2" />
            {showForm ? "Cancel" : "Log Flight"}
          </Button>
          <Button
            onClick={() => {
              setShowManageData(!showManageData)
              setShowForm(false)
            }}
            size="lg"
            variant={showManageData ? "secondary" : "outline"}
          >
            <Database className="h-5 w-5 mr-2" />
            Data
          </Button>
        </section>

        {/* Forms */}
        {showForm && (
          <section>
            <FlightForm onFlightAdded={handleFlightAdded} onClose={() => setShowForm(false)} />
          </section>
        )}

        {showManageData && (
          <section>
            <ManageData onClose={() => setShowManageData(false)} />
          </section>
        )}

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
