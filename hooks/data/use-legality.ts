"use client"

import { useMemo } from "react"

import { useFDPData } from "./use-fdp-data"
import { useCurrencies } from "./use-currencies"
import {
  buildLegalityModel,
  type LegalityModel,
} from "@/lib/utils/dashboard/legality"
import type { NinetyDayCurrency } from "@/lib/utils/dashboard-aggregate"

/**
 * The legality model, assembled from the three places its inputs live: the FDP
 * pipeline (rest + rolling limits + forecast), the currencies table (documents)
 * and the logbook (recency).
 *
 * Recency is passed IN rather than read here. It comes off the dashboard
 * aggregate, which the page has already computed — recomputing it would mean a
 * second full walk of every flight the pilot has ever logged, on a page that is
 * keep-alive and therefore pays that cost for the rest of the session.
 */
export function useLegality(recency: NinetyDayCurrency): {
  legality: LegalityModel
  isLoading: boolean
} {
  const { capacity, restUntilLegal, forecast, isLoading: fdpLoading } = useFDPData()
  const { currencies, isLoading: currenciesLoading } = useCurrencies()

  const forecastBreaches = useMemo(
    () => forecast.exceedances.map((e) => e.limitName),
    [forecast],
  )

  const legality = useMemo(
    () =>
      buildLegalityModel({
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
      }),
    [restUntilLegal, recency, capacity, forecastBreaches, currencies],
  )

  return { legality, isLoading: fdpLoading || currenciesLoading }
}
