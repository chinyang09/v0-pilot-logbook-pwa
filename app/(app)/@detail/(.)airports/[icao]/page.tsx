"use client"

import { useMemo } from "react"
import { useParams } from "next/navigation"
import { useAirportDatabase } from "@/hooks/data"
import { getAirportByICAO, getAirportLocalTime } from "@/lib/db"
import { MapPin, Globe, Mountain, Clock, Loader2 } from "lucide-react"

export default function AirportDetailPanel() {
  const params = useParams()
  const icao = params.icao as string
  const { airports, isLoading } = useAirportDatabase()

  const airport = useMemo(() => {
    if (!airports.length) return null
    return getAirportByICAO(airports, icao)
  }, [airports, icao])

  const timeInfo = useMemo(() => {
    if (!airport) return null
    return getAirportLocalTime(airport.tz)
  }, [airport])

  if (isLoading) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-auto">
      {/* Header */}
      <header className="flex-none bg-card border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold uppercase">
          {airport ? airport.icao : "Airport"}
        </h1>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {!airport ? (
          <p className="text-center text-muted-foreground py-12">
            Airport {icao.toUpperCase()} not found
          </p>
        ) : (
          <div className="space-y-4">
            {/* Airport header */}
            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold tracking-tighter text-foreground">
                    {airport.icao}
                  </span>
                  {airport.iata && (
                    <span className="text-xl font-medium text-muted-foreground">
                      / {airport.iata}
                    </span>
                  )}
                </div>
              </div>

              <h2 className="text-xl font-semibold text-foreground mb-1 leading-tight">
                {airport.name}
              </h2>

              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                <span>
                  {airport.city}
                  {airport.state ? `, ${airport.state}` : ""} — {airport.country}
                </span>
              </div>
            </div>

            {/* Local Time Card */}
            <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                <Clock className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Current Local Time
                </div>
                <div className="text-lg font-bold text-foreground">{timeInfo}</div>
                <div className="text-xs text-muted-foreground">
                  Timezone: {airport.tz}
                </div>
              </div>
            </div>

            {/* Location details */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Technical Data
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Globe className="h-3 w-3" /> Coordinates
                  </div>
                  <div className="text-sm font-mono bg-muted/50 p-1.5 rounded text-center">
                    {airport.latitude.toFixed(4)}, {airport.longitude.toFixed(4)}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Mountain className="h-3 w-3" /> Elevation
                  </div>
                  <div className="text-sm font-mono bg-muted/50 p-1.5 rounded text-center">
                    {airport.altitude} FT
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
