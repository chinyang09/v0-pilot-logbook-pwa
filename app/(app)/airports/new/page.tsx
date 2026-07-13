"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AirportNewForm } from "@/components/airport-new-form"
import { useIsDesktop } from "@/hooks/use-is-desktop"

export default function NewAirportPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const prefilledCode = searchParams.get("code") || ""
  const fieldType = searchParams.get("field")
  const flightId = searchParams.get("flightId")

  // Desktop (non-picker): the create form belongs in the airports page's
  // detail panel, not a full main-panel page (deep links + mobile→desktop
  // resize mid-create).
  useEffect(() => {
    if (isDesktop && !fieldType) {
      router.replace("/airports?new=1")
    }
  }, [isDesktop, fieldType, router])

  return (
    <AirportNewForm
      prefilledCode={prefilledCode}
      fieldType={fieldType}
      flightId={flightId}
    />
  )
}
