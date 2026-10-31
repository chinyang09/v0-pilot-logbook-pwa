"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { PageLoading } from "@/components/ui/page-loading"

/**
 * An old deep link to one aircraft. Every aircraft opens in the aircraft
 * page's DETAIL panel — beside the list on a tablet, the overlay on a phone —
 * so this route only hands the registration over as `?selected=`. It used to
 * draw its own copy of the panel on a phone: a read-only view behind an Edit
 * button, after the panel itself had become edited in place.
 */
export default function AircraftDetailRedirect() {
  const params = useParams()
  const router = useRouter()
  const registration = decodeURIComponent((params.registration as string) || "")

  useEffect(() => {
    router.replace(registration ? `/aircraft?selected=${encodeURIComponent(registration)}` : "/aircraft")
  }, [registration, router])

  return <PageLoading />
}
