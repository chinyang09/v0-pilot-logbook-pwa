"use client"

import { useState, useEffect, useMemo } from "react"
import { ScrollIndicator } from "@/components/ui/scroll-indicator"
import { Button } from "@/components/ui/button"
import { getAirportByIcao, getAirportLocalTime, toggleAirportFavorite, type Airport } from "@/lib/db"
import {
  MapPin,
  Globe,
  Mountain,
  Clock,
  Star,
} from "lucide-react"

interface AirportDetailPanelProps {
  icao: string
  /** Called when back button is pressed (mobile overlay dismiss) */
  onBack?: () => void
  /** Lets the parent list keep its own favorite state in sync after a toggle. */
  onToggleFavorite?: (icao: string) => void
}

export function AirportDetailPanel({ icao, onBack, onToggleFavorite }: AirportDetailPanelProps) {
  const [airport, setAirport] = useState<Airport | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Direct IndexedDB lookup by primary key (O(1), always fresh)
  useEffect(() => {
    let mounted = true
    // Only show loading on first mount, not on subsequent icao changes
    if (!airport) setIsLoading(true)
    getAirportByIcao(icao).then((found) => {
      if (mounted) {
        setAirport(found ?? null)
        setIsLoading(false)
      }
    })
    return () => { mounted = false }
    // Re-fetch only when icao changes. `airport` is read solely to gate the
    // first-mount spinner; adding it would retrigger the fetch on every result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icao])

  // Dynamic local time calculation
  const timeInfo = useMemo(() => {
    if (!airport) return null
    return getAirportLocalTime(airport.tz)
  }, [airport])

  const handleToggleFavorite = async () => {
    if (!airport) return
    const next = !airport.isFavorite
    setAirport((a) => (a ? { ...a, isFavorite: next } : a)) // optimistic
    try {
      await toggleAirportFavorite(airport.icao)
      onToggleFavorite?.(airport.icao)
    } catch {
      setAirport((a) => (a ? { ...a, isFavorite: !next } : a)) // revert on failure
    }
  }

  // Silent wait: return null to keep previous panel content visible (no flash)
  if (isLoading && !airport) {
    return null
  }

  if (!airport) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Airport {icao.toUpperCase()} not found
      </div>
    )
  }

  return (
    <div className="h-full relative flex flex-col">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto scrollbar-hide">
        <ScrollIndicator />
        <div className="h-chrome-top" />
        <div className="px-4 pt-4">
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

          {/* Information Grid */}
          <div className="grid grid-cols-1 gap-4 mt-4">
            {/* Local Time Card */}
            <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                <Clock className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Current Local Time
                </div>
                <div className="text-lg font-bold text-foreground">
                  {timeInfo}
                </div>
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
                  <div className="text-sm bg-muted/50 p-1.5 rounded text-center">
                    {airport.latitude.toFixed(4)}, {airport.longitude.toFixed(4)}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Mountain className="h-3 w-3" /> Elevation
                  </div>
                  <div className="text-sm bg-muted/50 p-1.5 rounded text-center">
                    {airport.elevation} FT
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="pt-4 flex gap-2">
            <Button
              className="flex-1 gap-2"
              variant={airport.isFavorite ? "default" : "outline"}
              onClick={handleToggleFavorite}
              aria-pressed={!!airport.isFavorite}
            >
              <Star className={`h-4 w-4 ${airport.isFavorite ? "fill-current" : ""}`} />
              {airport.isFavorite ? "Favourited" : "Mark as Favourite"}
            </Button>
          </div>
        </div>
        <div className="h-chrome-bottom" />
      </div>
    </div>
  )
}
