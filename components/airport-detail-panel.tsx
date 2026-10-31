"use client"

import { useState, useEffect, useMemo } from "react"
import { PanelMessage } from "@/components/ui/page-loading"
import { Star } from "lucide-react"
import { ReadingPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import { usePreferences } from "@/components/providers/preferences-provider"
import { formatClockDisplay } from "@/lib/utils/time"
import { getAirportByIcao, getAirportLocalTime, toggleAirportFavorite, type Airport } from "@/lib/db"

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

  // The airport's clock now, punctuated as every clock in the app is
  // (`clockSeparator`) — "14:05 (GMT+8)".
  const separator = usePreferences().preferences.display.clockSeparator
  const timeInfo = useMemo(() => {
    if (!airport) return null
    return getAirportLocalTime(airport.tz).replace(/^(\d{2}:\d{2})/, (hhmm) => formatClockDisplay(hhmm, separator))
  }, [airport, separator])

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
      <PanelMessage
        title={`${icao.toUpperCase()} Not Found`}
        description="It is not in this device's airport list. Add it with the + button."
      />
    )
  }

  const location = [airport.city, airport.state].filter(Boolean).join(", ")
  return (
    <ReadingPanel title={airport.iata ? `${airport.icao} / ${airport.iata}` : airport.icao}>
      <FormSection>
        <ReadOnlyRow label="Name" value={airport.name} />
        <ReadOnlyRow label="Location" value={[location, airport.country].filter(Boolean).join(" — ")} />
      </FormSection>
      <FormSection title="Time">
        <ReadOnlyRow label="Local Time" value={timeInfo ?? ""} />
        <ReadOnlyRow label="Timezone" value={airport.tz} />
      </FormSection>
      <FormSection title="Position">
        <ReadOnlyRow
          label="Coordinates"
          value={`${airport.latitude.toFixed(4)}, ${airport.longitude.toFixed(4)}`}
        />
        <ReadOnlyRow label="Elevation" value={`${airport.elevation} ft`} />
      </FormSection>
      <ActionStack>
        <ActionRow
          label={airport.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          icon={<Star className={airport.isFavorite ? "fill-current" : undefined} />}
          onClick={handleToggleFavorite}
        />
      </ActionStack>
    </ReadingPanel>
  )
}
