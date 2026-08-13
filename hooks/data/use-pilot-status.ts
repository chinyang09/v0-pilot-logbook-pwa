"use client"

import { useMemo } from "react"

import { useFDPData } from "./use-fdp-data"
import { useCurrencies } from "./use-currencies"
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
    isLoading: fdpLoading,
  } = useFDPData()
  const { currencies, isLoading: currenciesLoading } = useCurrencies()

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
    return buildPilotStatus({
      legality: buildLegalityModel({
        rest: restUntilLegal
          ? {
              isLegalNow: restUntilLegal.isLegalNow,
              restElapsedMinutes: restUntilLegal.restElapsedMinutes,
              requiredRestMinutes: restUntilLegal.requiredRestMinutes,
              legalAtUtc: restUntilLegal.legalAtUtc,
            }
          : null,
        recency,
        capacity,
        forecastBreaches,
        currencies,
        now: at,
      }),
      duty: deriveDutyStatus(allDutyPeriods, at),
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
  ])

  return { status, isLoading: fdpLoading || currenciesLoading }
}
