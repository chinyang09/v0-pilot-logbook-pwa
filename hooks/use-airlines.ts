"use client"

/**
 * The airline list (`lib/airlines/airlines.ts`), loaded only while `enabled`
 * — a crew card's company field, or a pilot with no airline set whose own
 * card names a company. The key carries no `idb:` prefix: a sync refresh has
 * nothing to re-read here.
 */

import useSWR from "swr"
import { loadAirlines } from "@/lib/airlines/airlines"
import type { Fr24Airline } from "@/lib/fr24/types"

const NONE: Fr24Airline[] = []

export function useAirlines(enabled = true): Fr24Airline[] {
  const { data } = useSWR(enabled ? "lookup:airlines" : null, () => loadAirlines(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  })
  return data ?? NONE
}
