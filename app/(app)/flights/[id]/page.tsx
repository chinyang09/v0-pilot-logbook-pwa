"use client"

import { useParams, usePathname, useRouter } from "next/navigation"
import { FlightForm } from "@/components/flight-form"
import { mutate } from "swr"
import { CACHE_KEYS } from "@/hooks/data"
import { syncService } from "@/lib/sync"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useEffect } from "react"
import type { FlightLog } from "@/lib/db"

export default function FlightDetailPage() {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  // Derive ID from URL pathname (always correct) with useParams() fallback.
  // Safety net: if SW serves a cached shell with stale params, pathname still has the real ID.
  const id = pathname?.split("/").pop() || (params.id as string)
  const isDesktop = useIsDesktop()

  // When switching to desktop view, redirect to logbook with the flight selected
  useEffect(() => {
    if (isDesktop && id) {
      router.replace(`/logbook?selected=${id}`)
    }
  }, [isDesktop, id, router])

  const handleFlightSaved = async (savedFlight: FlightLog) => {
    // Optimistic: upsert the saved flight in the SWR cache before navigating.
    // The logbook list will reflect the change instantly with no skeleton flash.
    // revalidate: true runs a background confirm from Dexie.
    mutate(
      CACHE_KEYS.flights,
      (prev: FlightLog[] | undefined) => {
        const existing = prev ?? []
        const idx = existing.findIndex((f) => f.id === savedFlight.id)
        const updated =
          idx >= 0
            ? existing.map((f) => (f.id === savedFlight.id ? savedFlight : f))
            : [savedFlight, ...existing]
        // Re-sort: newest date first, then latest outTime within the same date
        return [...updated].sort((a, b) => {
          const d = b.date.localeCompare(a.date)
          return d !== 0 ? d : (b.outTime ?? "").localeCompare(a.outTime ?? "")
        })
      },
      { revalidate: true }
    )
    if (navigator.onLine) {
      syncService.fullSync()
    }
    router.push("/logbook")
  }

  const handleClose = () => {
    router.push("/logbook")
  }

  return (
    <FlightForm
      flightId={id}
      onFlightAdded={handleFlightSaved}
      onClose={handleClose}
    />
  )
}
