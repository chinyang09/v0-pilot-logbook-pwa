"use client"

import { useState, useEffect, useMemo, memo } from "react"
import { PickerSheet } from "./picker-sheet"
import { useAirportDatabase } from "@/hooks/data"
import { getRecentlyUsedAirports, addRecentlyUsedAirport } from "@/lib/db"
import type { Airport } from "@/lib/db"

interface AirportPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (icao: string) => void
}

export function AirportPicker({ open, onClose, onSelect }: AirportPickerProps) {
  const [search, setSearch] = useState("")
  const { airports, isLoading } = useAirportDatabase()
  const [recentIcaos, setRecentIcaos] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setSearch("")
      getRecentlyUsedAirports().then(setRecentIcaos)
    }
  }, [open])

  const recentAirports = useMemo(() => {
    if (!recentIcaos.length || !airports.length) return []
    return recentIcaos
      .map(icao => airports.find(a => a.icao === icao))
      .filter((a): a is Airport => !!a)
  }, [recentIcaos, airports])

  const filteredAirports = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return airports
      .filter(a =>
        a.icao?.toLowerCase().includes(q) ||
        a.iata?.toLowerCase().includes(q) ||
        a.name?.toLowerCase().includes(q) ||
        a.city?.toLowerCase().includes(q)
      )
      .slice(0, 50)
  }, [search, airports])

  const handleSelect = async (icao: string) => {
    await addRecentlyUsedAirport(icao)
    onSelect(icao)
    onClose()
  }

  return (
    <PickerSheet
      open={open}
      onClose={onClose}
      title="Select Airport"
      searchPlaceholder="Search ICAO, name, or city..."
      searchValue={search}
      onSearchChange={setSearch}
    >
      <div className="px-4 pb-6">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {/* Recently Used */}
        {!search && !isLoading && recentAirports.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1.5 px-1">
              Recently Used
            </p>
            <div className="rounded-xl bg-card/50 border border-border/50 overflow-hidden divide-y divide-border/30">
              {recentAirports.map(airport => (
                <AirportRow key={airport.icao} airport={airport} onSelect={handleSelect} />
              ))}
            </div>
          </div>
        )}

        {/* Search Results */}
        {search && !isLoading && (
          <>
            {filteredAirports.length > 0 ? (
              <div className="rounded-xl bg-card/50 border border-border/50 overflow-hidden divide-y divide-border/30">
                {filteredAirports.map(airport => (
                  <AirportRow key={airport.icao} airport={airport} onSelect={handleSelect} />
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground/60 text-sm py-12">
                No airports found
              </p>
            )}
          </>
        )}

        {/* Empty state */}
        {!search && !isLoading && recentAirports.length === 0 && (
          <p className="text-center text-muted-foreground/50 text-sm py-12">
            Search for an airport
          </p>
        )}

        {/* Hint */}
        {!search && !isLoading && recentAirports.length > 0 && (
          <p className="text-center text-muted-foreground/30 text-xs py-3">
            Type to search all airports
          </p>
        )}
      </div>
    </PickerSheet>
  )
}

const AirportRow = memo(function AirportRow({
  airport,
  onSelect,
}: {
  airport: Airport
  onSelect: (icao: string) => void
}) {
  return (
    <button
      onClick={() => onSelect(airport.icao)}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 active:bg-muted/50 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-primary">{airport.icao}</span>
          {airport.iata && (
            <span className="text-xs text-muted-foreground/60">{airport.iata}</span>
          )}
          <span className="text-xs text-foreground/70 truncate">{airport.name}</span>
        </div>
        {(airport.city || airport.country) && (
          <p className="text-xs text-muted-foreground/50 truncate">
            {[airport.city, airport.state, airport.country].filter(Boolean).join(", ")}
          </p>
        )}
      </div>
    </button>
  )
})
