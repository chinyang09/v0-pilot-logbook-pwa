"use client"

import { useMemo } from "react"
import useSWR from "swr"

import { useFlights } from "./use-flights"
import { useAircraft } from "./use-aircraft"
import { useDBReady } from "./use-db"
import { getAircraftTypeIndex } from "@/lib/db/stores/reference/aircraft.store"
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
  const { isReady } = useDBReady()

  // The reference fleet's registration → type index. Keyed with the `idb:`
  // prefix every hook in this directory uses, so `refreshAllData` revalidates
  // it after a sync like everything else. It changes only when a tail is
  // resolved or added, so it does not need to revalidate on focus.
  const { data: referenceTypes } = useSWR(
    isReady ? "idb:aircraft-reference:type-index" : null,
    getAircraftTypeIndex,
    { revalidateOnFocus: false },
  )

  const aggregates = useMemo(
    () => aggregateDashboard({ flights, aircraft, referenceTypes, fromIso, toIso }),
    [flights, aircraft, referenceTypes, fromIso, toIso],
  )

  return {
    aggregates,
    // The reference index is deliberately NOT part of the loading gate: it only
    // fills gaps the user's own aircraft list leaves, so the dashboard should
    // paint as soon as flights and aircraft are in rather than waiting on it.
    isLoading: flightsLoading || aircraftLoading,
  }
}
