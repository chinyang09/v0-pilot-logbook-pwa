"use client"

import { useMemo } from "react"
import { useFlights } from "./use-flights"
import { usePersonnel } from "./use-crew"
import { useDayKey } from "@/hooks/use-day-key"
import { crewFlyingHistory, type CrewHistory } from "@/lib/utils/crew-history"

const NONE = new Map<string, CrewHistory>()

/**
 * Every crew card's flying history with the pilot (`crewFlyingHistory`) —
 * one pass over the logbook, re-run when the flights or the cards change and
 * when the UTC date turns (what counts as "next" moves with it).
 */
export function useCrewHistory(): Map<string, CrewHistory> {
  const { flights } = useFlights()
  const { personnel } = usePersonnel()
  const dayKey = useDayKey()
  const today = dayKey.split("|")[1] || ""
  return useMemo(() => {
    if (!today || flights.length === 0 || personnel.length === 0) return NONE
    const [y, m, d] = today.split("-").map(Number)
    const iso = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
    return crewFlyingHistory(flights, personnel, iso)
  }, [flights, personnel, today])
}
