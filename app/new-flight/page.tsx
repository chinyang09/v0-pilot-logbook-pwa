"use client"

import { useState, useEffect, Suspense } from "react"
import { FlightForm } from "@/components/flight-form"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { BottomNavbar } from "@/components/bottom-navbar"
import type { FlightLog } from "@/lib/indexed-db"
import { getFlightById } from "@/lib/indexed-db"
import { syncService } from "@/lib/sync-service"
import { refreshAllData, useDBReady } from "@/hooks/use-indexed-db"
import { useRouter, useSearchParams } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"

function NewFlightContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get("edit")

  const selectedField = searchParams.get("field")
  const selectedAirport = searchParams.get("airport")

  const selectedAircraftReg = searchParams.get("aircraftReg")
  const selectedAircraftType = searchParams.get("aircraftType")

  const selectedCrewId = searchParams.get("crewId")
  const selectedCrewName = searchParams.get("crewName")

  const { isReady: dbReady } = useDBReady()
  const [editingFlight, setEditingFlight] = useState<FlightLog | null>(null)
  const [isLoadingFlight, setIsLoadingFlight] = useState(!!editId)

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!dbReady || !editId) {
      setIsLoadingFlight(false)
      return
    }

    const loadFlight = async () => {
      setIsLoadingFlight(true)
      try {
        const flight = await getFlightById(editId)
        if (flight) {
          setEditingFlight(flight)
        }
      } catch (error) {
        console.error("Failed to load flight:", error)
      } finally {
        setIsLoadingFlight(false)
      }
    }

    loadFlight()
  }, [dbReady, editId])

  const handleFlightAdded = async (flight: FlightLog) => {
    if (navigator.onLine) {
      syncService.fullSync()
    }
    router.push("/logbook")
  }

  const handleClose = () => {
    router.back()
  }

  const isAirportField = selectedField === "departureIcao" || selectedField === "arrivalIcao"
  const isAircraftField = selectedField === "aircraftReg"
  const isCrewField = selectedField === "picId" || selectedField === "sicId"

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-3 py-3 pb-24">
        {isLoadingFlight ? (
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-8 w-48" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
              <div className="grid grid-cols-4 gap-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <FlightForm
            onFlightAdded={handleFlightAdded}
            onClose={handleClose}
            editingFlight={editingFlight}
            selectedAirportField={isAirportField ? selectedField : null}
            selectedAirportCode={isAirportField ? selectedAirport : null}
            selectedAircraftReg={isAircraftField ? selectedAircraftReg : null}
            selectedAircraftType={isAircraftField ? selectedAircraftType : null}
            selectedCrewField={isCrewField ? selectedField : null}
            selectedCrewId={isCrewField ? selectedCrewId : null}
            selectedCrewName={isCrewField ? selectedCrewName : null}
          />
        )}
      </main>

      <BottomNavbar />
      <PWAInstallPrompt />
    </div>
  )
}

export default function NewFlightPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background">
          <main className="container mx-auto px-3 py-3 pb-24">
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <Skeleton className="h-8 w-48 mb-4" />
                <Skeleton className="h-64" />
              </CardContent>
            </Card>
          </main>
          <BottomNavbar />
        </div>
      }
    >
      <NewFlightContent />
    </Suspense>
  )
}
