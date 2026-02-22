"use client"

import { useSearchParams } from "next/navigation"
import { AircraftNewForm } from "@/components/aircraft-new-form"

export default function NewAircraftPage() {
  const searchParams = useSearchParams()
  const prefilledReg = searchParams.get("reg") || ""
  const selectMode = searchParams.get("select") === "true"
  const flightId = searchParams.get("flightId")

  return (
    <AircraftNewForm
      prefilledReg={prefilledReg}
      selectMode={selectMode}
      flightId={flightId}
    />
  )
}
