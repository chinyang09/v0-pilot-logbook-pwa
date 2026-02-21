"use client"

import { useSearchParams } from "next/navigation"
import { AirportNewForm } from "@/components/airport-new-form"

export default function NewAirportPage() {
  const searchParams = useSearchParams()
  const prefilledCode = searchParams.get("code") || ""
  const fieldType = searchParams.get("field")
  const flightId = searchParams.get("flightId")

  return (
    <AirportNewForm
      prefilledCode={prefilledCode}
      fieldType={fieldType}
      flightId={flightId}
    />
  )
}
