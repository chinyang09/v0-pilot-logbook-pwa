"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { FlightForm } from "@/components/flight-form"
import { FlightList } from "@/components/flight-list"
import { StatsDashboard } from "@/components/stats-dashboard"
import { ManageData } from "@/components/manage-data"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { FlightLog } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { useFlights, useFlightStats, refreshAllData, useDBReady } from "@/hooks/use-indexed-db"
import { Plus, Database, RefreshCw, AlertCircle } from "lucide-react"

export default function Home() {
  const { isReady: dbReady, isLoading: dbLoading } = useDBReady()
  const { flights, isLoading: flightsLoading, refresh: refreshFlights } = useFlights()
  const { stats, isLoading: statsLoading, refresh: refreshStats } = useFlightStats()

  const [isSyncing, setIsSyncing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showManageData, setShowManageData] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [editingFlight, setEditingFlight] = useState<FlightLog | null>(null)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!dbReady) return

    const doInitialSync = async () => {
      if (navigator.onLine) {
        setIsSyncing(true)
        setSyncError(null)
        try {
          const result = await syncService.fullSync()
          console.log("[v0] Initial sync complete:", result)
          await refreshAllData()
        } catch (error) {
          console.error("[v0] Initial sync failed:", error)
          setSyncError("Sync failed. Data may be outdated.")
        } finally {
          setIsSyncing(false)
        }
      }
    }

    doInitialSync()
  }, [dbReady])

  const handleManualSync = async () => {
    if (!navigator.onLine) {
      setSyncError("You are offline. Sync will happen when connection is restored.")
      return
    }

    setIsSyncing(true)
    setSyncError(null)
    try {
      const result = await syncService.fullSync()
      console.log("[v0] Manual sync complete:", result)
      await refreshAllData()
    } catch (error) {
      console.error("[v0] Manual sync failed:", error)
      setSyncError("Sync failed. Please try again.")
    } finally {
      setIsSyncing(false)
    }
  }

  const handleFlightAdded = async (flight: FlightLog) => {
    await refreshFlights()
    await refreshStats()
    setShowForm(false)
    setEditingFlight(null)

    if (navigator.onLine) {
      syncService.fullSync()
    }
  }

  const handleEditFlight = (flight: FlightLog) => {
    setEditingFlight(flight)
    setShowForm(true)
    setShowManageData(false)
  }

  const handleFlightDeleted = async () => {
    await refreshFlights()
    await refreshStats()
  }

  const handleCloseForm = () => {
    setShowForm(false)
    setEditingFlight(null)
  }

  const isLoading = dbLoading || !dbReady

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-6 pb-24 space-y-6">
        {syncError && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{syncError}</span>
            <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setSyncError(null)}>
              Dismiss
            </Button>
          </div>
        )}

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Overview</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualSync}
              disabled={isSyncing || isLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Syncing..." : "Sync"}
            </Button>
          </div>
          {statsLoading || isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <StatsDashboard stats={stats} />
          )}
        </section>

        <section className="flex gap-3">
          <Button
            onClick={() => {
              if (showForm && !editingFlight) {
                handleCloseForm()
              } else {
                setEditingFlight(null)
                setShowForm(true)
                setShowManageData(false)
              }
            }}
            className="flex-1"
            size="lg"
            variant={showForm ? "secondary" : "default"}
            disabled={isLoading}
          >
            <Plus className="h-5 w-5 mr-2" />
            {showForm && !editingFlight ? "Cancel" : "Log Flight"}
          </Button>
          <Button
            onClick={() => {
              setShowManageData(!showManageData)
              setShowForm(false)
              setEditingFlight(null)
            }}
            size="lg"
            variant={showManageData ? "secondary" : "outline"}
            disabled={isLoading}
          >
            <Database className="h-5 w-5 mr-2" />
            Data
          </Button>
        </section>

        {showForm && (
          <section>
            <FlightForm onFlightAdded={handleFlightAdded} onClose={handleCloseForm} editingFlight={editingFlight} />
          </section>
        )}

        {showManageData && (
          <section>
            <ManageData onClose={() => setShowManageData(false)} />
          </section>
        )}

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Recent Flights</h2>
          <FlightList
            flights={flights}
            isLoading={flightsLoading || isLoading}
            onEdit={handleEditFlight}
            onDeleted={handleFlightDeleted}
          />
        </section>
      </main>

      <PWAInstallPrompt />
    </div>
  )
}
