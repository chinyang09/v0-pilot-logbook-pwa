"use client"

import { useMemo } from "react"

import { useFlights } from "./use-flights"
import { useAircraft } from "./use-aircraft"
import {
  aggregateDashboard,
  type DashboardAggregates,
} from "@/lib/utils/dashboard-aggregate"

interface UseDashboardAggregatesOptions {
  fromIso: string
  toIso: string
}

export function useDashboardAggregates({
  fromIso,
  toIso,
}: UseDashboardAggregatesOptions): {
  aggregates: DashboardAggregates
  isLoading: boolean
} {
  const { flights, isLoading: flightsLoading } = useFlights()
  const { aircraft, isLoading: aircraftLoading } = useAircraft()

  const aggregates = useMemo(
    () => aggregateDashboard({ flights, aircraft, fromIso, toIso }),
    [flights, aircraft, fromIso, toIso],
  )

  return {
    aggregates,
    isLoading: flightsLoading || aircraftLoading,
  }
}
