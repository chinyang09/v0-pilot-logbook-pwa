import { useCallback } from "react"
import { addFlight } from "@/lib/db"
import { createEmptyFlightLog } from "@/lib/utils/flight-calculations"

export function useCreateFlight() {
  return useCallback(async () => {
    const emptyFlight = createEmptyFlightLog()
    return addFlight({
      ...emptyFlight,
      isDraft: true,
      date: new Date().toISOString().split("T")[0],
    })
  }, [])
}
