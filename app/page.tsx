"use client"

import { useState, useEffect, useCallback } from "react"
import { Header } from "@/components/header"
import { FlightForm } from "@/components/flight-form"
import { FlightList } from "@/components/flight-list"
import { StatsDashboard } from "@/components/stats-dashboard"
import { ManageData } from "@/components/manage-data"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { Button } from "@/components/ui/button"
import { getAllFlights, getFlightStats, type FlightLog } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { Plus, Database, RefreshCw } from "lucide-react"

export default function Home() {
  const [flights, setFlights] = useState<FlightLog[]>([])
  const [stats, setStats] = useState({
    totalFlights: 0,
    blockTime: "00:00",
    flightTime: "00:00",
    p1Time: "00:00",
    p2Time: "00:00",
    p1usTime: "00:00",
    dualTime: "00:00",
    nightTime: "00:00",
    ifrTime: "00:00",
    totalDayLandings: 0,
    totalNightLandings: 0,
    uniqueAircraft: 0,
    uniqueAirports: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showManageData, setShowManageData] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [flightData, statsData] = await Promise.all([getAllFlights(), getFlightStats()])
      setFlights(flightData)
      setStats(statsData)
    } catch (error) {
      console.error("Failed to load data:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const initSync = async () => {
      await loadData()

      if (navigator.onLine) {
        setIsSyncing(true)
        try {
          await syncService.fullSync()
          // Reload data after sync to get any new records from server
          await loadData()
        } catch (error) {
          console.error("Initial sync failed:", error)
        } finally {
          setIsSyncing(false)
        }
      }
    }

    initSync()
  }, [loadData])

  const handleManualSync = async () => {
    if (!navigator.onLine) return

    setIsSyncing(true)
    try {
      await syncService.fullSync()
      await loadData()
    } catch (error) {
      console.error("Manual sync failed:", error)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleFlightAdded = async (flight: FlightLog) => {
    setFlights((prev) => [flight, ...prev])
    // Reload stats to get accurate totals
    const statsData = await getFlightStats()
    setStats(statsData)
    setShowForm(false)

    // Trigger sync
    if (navigator.onLine) {
      syncService.fullSync()
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-6 pb-24 space-y-6">
        {/* Stats Dashboard */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Overview</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualSync}
              disabled={isSyncing || !navigator.onLine}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Syncing..." : "Sync"}
            </Button>
          </div>
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
