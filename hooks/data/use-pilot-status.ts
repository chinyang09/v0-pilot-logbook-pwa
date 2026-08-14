"use client"

import { useMemo } from "react"

import { useFDPData } from "./use-fdp-data"
import { useCurrencies } from "./use-currencies"
import { useFlights } from "./use-flights"
import { hhmmToMinutes } from "@/lib/utils/time"
import { buildLegalityModel } from "@/lib/utils/dashboard/legality"
import { deriveDutyStatus } from "@/lib/utils/dashboard/duty-status"
import { buildPilotStatus, type PilotStatus } from "@/lib/utils/dashboard/pilot-status"
import type { NinetyDayCurrency } from "@/lib/utils/dashboard-aggregate"

/**
 * The legal dashboard's single derived model.
 *
 * Everything the panel renders comes from here, so the panel itself queries
 * nothing and calculates nothing — Dexie stays the source of truth and the
 * dashboard is a projection of it.
 *
 * `now` is a PARAMETER rather than being read inside: the panel already owns a
 * 1Hz clock for the duty countdown, and a second, unsynchronised `Date.now()`
 * in here would let the elapsed figure and the countdown disagree by a second.
 * Recency likewise comes in from the dashboard aggregate the page has already
 * computed, rather than costing a second walk of the whole flight history.
 */
export function usePilotStatus(
  recency: NinetyDayCurrency,
  now: number,
): { status: PilotStatus; isLoading: boolean } {
  const {
    capacity,
    restUntilLegal,
    forecast,
    allDutyPeriods,
    scheduleDutyPeriods,
    isLoading: fdpLoading,
  } = useFDPData()
  const { currencies, isLoading: currenciesLoading } = useCurrencies()
  const { flights } = useFlights()

  /**
   * Flight id → on-blocks instant, so the sector chain can mark which legs of
   * the current duty are already flown. Built from the flights already in
   * cache; the in-time wraps to the next day when it is earlier than the out
   * time, the same rule the duty windows use.
   */
  const flightArrivals = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of flights) {
      if (!f.date || !f.inTime) continue
      const base = Date.parse(`${f.date}T${f.inTime.slice(0, 5)}:00Z`)
      if (!Number.isFinite(base)) continue
      const wraps = f.outTime ? hhmmToMinutes(f.inTime) < hhmmToMinutes(f.outTime) : false
      map.set(f.id, wraps ? base + 86_400_000 : base)
    }
    return map
  }, [flights])

  const forecastBreaches = useMemo(
    () => forecast.exceedances.map((e) => e.limitName),
    [forecast],
  )

  // Bucketed to the MINUTE. The model underneath changes state on minute
  // boundaries (elapsed duty, days remaining), so rebuilding it 60 times a
  // minute would recompute an identical answer 59 times — while the seconds
  // ticking in the countdown are read straight off `now` by the component.
  const nowMinute = Math.floor(now / 60_000)

  const status = useMemo(() => {
    const at = new Date(nowMinute * 60_000)
    // Rest belongs to the DUTY state, not the currency grid — it is a property
    // of the duty just flown rather than a standing qualification.
    const rest = restUntilLegal
      ? {
          isLegalNow: restUntilLegal.isLegalNow,
          elapsedMinutes: restUntilLegal.restElapsedMinutes,
          requiredMinutes: restUntilLegal.requiredRestMinutes,
          legalAtUtc: restUntilLegal.legalAtUtc,
        }
      : null

    return buildPilotStatus({
      legality: buildLegalityModel({
        recency,
        capacity,
        forecastBreaches,
        currencies,
        now: at,
      }),
      duty: deriveDutyStatus(allDutyPeriods, at, rest, flightArrivals, scheduleDutyPeriods),
      now: at,
    })
  }, [
    nowMinute,
    restUntilLegal,
    recency,
    capacity,
    forecastBreaches,
    currencies,
    allDutyPeriods,
    scheduleDutyPeriods,
    flightArrivals,
  ])

  return { status, isLoading: fdpLoading || currenciesLoading }
}
