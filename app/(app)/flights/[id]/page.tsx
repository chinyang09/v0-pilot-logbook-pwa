"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { getFlightById, type FlightLog } from "@/lib/db"
import { FlightForm } from "@/components/flight-form"
import { Loader2 } from "lucide-react"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"
import { syncService } from "@/lib/sync"

export default function FlightDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string

  const [flight, setFlight] = useState<FlightLog | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Get picker selection params to pass to FlightForm
  const selectedField = searchParams.get("field")
  const selectedAirport = searchParams.get("airport")
  const selectedAircraftReg = searchParams.get("aircraftReg")
  const selectedAircraftType = searchParams.get("aircraftType")
  const selectedCrewId = searchParams.get("crewId")
  const selectedCrewName = searchParams.get("crewName")

  // Determine which field types we have for picker selections
  const isAirportField = selectedField === "departureIcao" || selectedField === "arrivalIcao"
  const isAircraftField = selectedField === "aircraftReg"
  const isCrewField = selectedField === "pic" || selectedField === "sic" ||
                      selectedField === "picId" || selectedField === "sicId"
  const crewFieldMapped = selectedField === "pic" ? "picId" :
                          selectedField === "sic" ? "sicId" : selectedField

  useEffect(() => {
    const loadFlight = async () => {
      setIsLoading(true)
      try {
        const loadedFlight = await getFlightById(id)
        if (loadedFlight) {
          setFlight(loadedFlight)
        }
      } catch (error) {
        console.error("Failed to load flight:", error)
      } finally {
        setIsLoading(false)
      }
    }
    loadFlight()
  }, [id])

  const handleFlightSaved = async (savedFlight: FlightLog) => {
    await mutate(CACHE_KEYS.flights)
    if (navigator.onLine) {
      syncService.fullSync()
    }
    // Navigate back to logbook
    router.push("/logbook")
  }

  const handleClose = () => {
    router.push("/logbook")
  }

  if (isLoading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!flight) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-background text-muted-foreground">
        <p>Flight not found</p>
        <button
          onClick={() => router.push("/logbook")}
          className="mt-4 text-primary"
        >
          Back to Logbook
        </button>
      </div>
    )
  }

  return (
    <FlightForm
      editingFlight={flight}
      onFlightAdded={handleFlightSaved}
      onClose={handleClose}
      selectedAirportField={isAirportField ? selectedField : null}
      selectedAirportCode={isAirportField ? selectedAirport : null}
      selectedAircraftReg={isAircraftField ? selectedAircraftReg : null}
      selectedAircraftType={isAircraftField ? selectedAircraftType : null}
      selectedCrewField={isCrewField ? crewFieldMapped : null}
      selectedCrewId={isCrewField ? selectedCrewId : null}
      selectedCrewName={isCrewField ? selectedCrewName : null}
    />
  )
}
