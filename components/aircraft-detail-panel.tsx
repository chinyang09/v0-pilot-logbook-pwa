"use client"

import { useState, useEffect } from "react"
import { Plane, Loader2, Hash, Tag } from "lucide-react"
import {
  getAircraftDatabase,
  getAircraftByRegistration,
  getAircraftByIcao24,
  type NormalizedAircraft,
} from "@/lib/db"

interface AircraftDetailPanelProps {
  registration: string
}

export function AircraftDetailPanel({ registration }: AircraftDetailPanelProps) {
  const [aircraft, setAircraft] = useState<NormalizedAircraft | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadAircraft() {
      setIsLoading(true)
      try {
        const database = await getAircraftDatabase()
        let found = getAircraftByRegistration(database, registration)
        if (!found) {
          found = getAircraftByIcao24(database, registration)
        }
        setAircraft(found || null)
      } catch (error) {
        console.error("[Aircraft Detail Panel] Failed to load:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadAircraft()
  }, [registration])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!aircraft) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Aircraft not found: {registration}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-none bg-background/30 backdrop-blur-lg border-b border-border">
        <div className="px-4 h-12 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-lg font-semibold">
              {aircraft.registration || aircraft.icao24}
            </h1>
            {aircraft.typecode && (
              <p className="text-xs text-muted-foreground">{aircraft.typecode}</p>
            )}
          </div>
        </div>
      </header>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-4 pb-safe space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Plane className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold">
                  {aircraft.registration || "No Registration"}
                </h2>
                {aircraft.typecode && (
                  <span className="text-sm font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                    {aircraft.typecode}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {aircraft.icao24 && (
                <div className="flex items-start gap-3">
                  <Hash className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      ICAO24 (Mode S)
                    </p>
                    <p className="font-mono font-medium">
                      {aircraft.icao24.toUpperCase()}
                    </p>
                  </div>
                </div>
              )}
              {aircraft.typecode && (
                <div className="flex items-start gap-3">
                  <Tag className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      ICAO Type Designator
                    </p>
                    <p className="font-medium">{aircraft.typecode}</p>
                  </div>
                </div>
              )}
              {aircraft.shortType && (
                <div className="flex items-start gap-3">
                  <Tag className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Type Category (ICAO Doc 8643)
                    </p>
                    <p className="font-medium">{aircraft.shortType}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
