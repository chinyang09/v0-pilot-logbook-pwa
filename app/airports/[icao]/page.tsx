"use client"

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { SyncStatus } from "@/components/sync-status"
import { BottomNavbar } from "@/components/bottom-navbar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { useAirportDatabase } from "@/hooks/use-indexed-db"
import { getAirportByICAO } from "@/lib/airport-database"
import { ArrowLeft, MapPin, Globe, Mountain, Clock, Loader2 } from "lucide-react"
import { useRouter, useParams } from "next/navigation"

export default function AirportDetailPage() {
  const params = useParams()
  const icao = params.icao as string
  const router = useRouter()
  const { airports, isLoading } = useAirportDatabase()

  const airport = useMemo(() => {
    if (!airports.length) return null
    return getAirportByICAO(airports, icao)
  }, [airports, icao])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!airport) {
    return (
      <div className="min-h-screen bg-background">
        <div className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => router.back()}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <h1 className="text-lg font-semibold">Airport Not Found</h1>
              </div>
              <SyncStatus />
            </div>
          </div>
        </div>
        <main className="container mx-auto px-3 pt-16 pb-20">
          <p className="text-center text-muted-foreground">Airport {icao.toUpperCase()} not found</p>
        </main>
        <BottomNavbar />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Fixed header */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-3">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-lg font-semibold">{airport.icao}</h1>
            </div>
            <SyncStatus />
          </div>
        </div>
      </div>

      <main className="container mx-auto px-3 pt-16 pb-20">
        <div className="space-y-4">
          {/* Airport header */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl font-bold text-foreground">{airport.icao}</span>
              {airport.iata && <span className="text-lg text-muted-foreground">({airport.iata})</span>}
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-1">{airport.name}</h2>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>
                {airport.city}
                {airport.state && `, ${airport.state}`} - {airport.country}
              </span>
            </div>
          </div>

          {/* Location details */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-foreground mb-2">Location Details</h3>

            <div className="flex items-start gap-2">
              <Globe className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">Coordinates</div>
                <div className="text-sm text-muted-foreground">
                  {airport.lat.toFixed(6)}°, {airport.lon.toFixed(6)}°
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Mountain className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">Elevation</div>
                <div className="text-sm text-muted-foreground">{airport.elevation} ft</div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">Timezone</div>
                <div className="text-sm text-muted-foreground">
                  {airport.tz}
                  {airport.timezone && ` (${airport.timezone})`}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <BottomNavbar />
      <PWAInstallPrompt />
    </div>
  )
}
