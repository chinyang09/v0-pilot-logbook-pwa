"use client"

/**
 * The pilot's airline, as the IATA designator a flight number starts with
 * ("TR"): Settings › Logging › Airline when set, else the company on the
 * pilot's own crew card ("Scoot" → TR) through the airline list. Null when
 * neither names one.
 */

import { useMemo } from "react"
import { usePreferences } from "@/components/providers/preferences-provider"
import { usePersonnel } from "@/hooks/data"
import { useAirlines } from "@/hooks/use-airlines"
import { resolveAirline } from "@/lib/airlines/airlines"
import { pickSelfCard } from "@/lib/utils/self-card"

export function useAirlineCode(): string | null {
  const { preferences } = usePreferences()
  const set = preferences.logging.airline?.trim().toUpperCase() || null
  const { personnel } = usePersonnel()
  const company = useMemo(() => (set ? null : pickSelfCard(personnel ?? [])?.organization?.trim() || null), [set, personnel])
  const rows = useAirlines(!!company)
  return useMemo(() => {
    if (set) return set
    if (!company) return null
    const airline = resolveAirline(rows, company)
    return airline?.iata || null
  }, [set, company, rows])
}
