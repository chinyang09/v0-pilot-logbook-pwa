"use client"

/**
 * The aircraft database's own record for each of a few registrations — the
 * registration as it spells it and its type — so a screen names an aeroplane
 * the way the Aircraft page does (the owner, Nov 2026: "uniform naming
 * convention for aircraft and airport"), whatever spelling the logbook row or
 * a live source used. A primary-key lookup of those few, never the table.
 */

import * as React from "react"
import useSWR from "swr"
import { useDBReady } from "@/hooks/data/use-db"
import { batchGetAircraftByRegistrations } from "@/lib/db/stores/reference/aircraft.store"
import { normalizeRegistration } from "@/lib/utils/string"

export interface AircraftName {
  registration: string
  typecode: string
}

const NONE: ReadonlyMap<string, AircraftName> = new Map()

/** By `normalizeRegistration`; a registration the database does not hold is absent. */
export function useAircraftRecords(registrations: readonly string[]): ReadonlyMap<string, AircraftName> {
  const { isReady } = useDBReady()
  const regs = React.useMemo(
    () => [...new Set(registrations.map((r) => r.trim().toUpperCase()).filter(Boolean))].sort(),
    [registrations],
  )
  // An array, not the Map: SWR's compare sees no keys on a Map and would call
  // every re-read "unchanged".
  const { data } = useSWR(
    isReady && regs.length ? `idb:aircraft-records:${regs.join(",")}` : null,
    async () => {
      const found = await batchGetAircraftByRegistrations(regs)
      return [...found.values()].map((a) => ({ registration: a.registration, typecode: a.typecode }))
    },
    { revalidateOnFocus: false },
  )
  return React.useMemo(() => (data ? new Map(data.map((a) => [normalizeRegistration(a.registration), a])) : NONE), [data])
}
