"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AircraftNewForm } from "@/components/aircraft-new-form"
import { useIsDesktop } from "@/hooks/use-is-desktop"

export default function NewAircraftPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const prefilledReg = searchParams.get("reg") || ""
  const selectMode = searchParams.get("select") === "true"
  const flightId = searchParams.get("flightId")

  // Desktop (non-picker): the create form belongs in the aircraft page's
  // detail panel, not a full main-panel page. Covers deep links AND a window
  // resized from mobile to desktop mid-create (which otherwise left the form
  // showing in both panels).
  useEffect(() => {
    if (isDesktop && !selectMode) {
      router.replace(
        `/aircraft?new=1${prefilledReg ? `&reg=${encodeURIComponent(prefilledReg)}` : ""}`
      )
    }
  }, [isDesktop, selectMode, prefilledReg, router])

  return (
    <AircraftNewForm
      prefilledReg={prefilledReg}
      selectMode={selectMode}
      flightId={flightId}
    />
  )
}
