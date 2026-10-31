"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { PageLoading } from "@/components/ui/page-loading"

/**
 * An old deep link to one airport. Every airport opens in the airports page's
 * DETAIL panel — beside the list on a tablet, the overlay on a phone — so this
 * route only hands the code over as `?selected=`. It used to draw its own copy
 * of the panel on a phone, with its own cards and a "Mark as Favourite" button.
 */
export default function AirportDetailRedirect() {
  const params = useParams()
  const router = useRouter()
  const icao = ((params.icao as string) || "").toUpperCase()

  useEffect(() => {
    router.replace(icao ? `/airports?selected=${encodeURIComponent(icao)}` : "/airports")
  }, [icao, router])

  return <PageLoading />
}
