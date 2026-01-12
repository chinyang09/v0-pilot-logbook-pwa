"use client"

import { useCallback } from "react"
import useSWR from "swr"
import {
  getAllCurrenciesWithStatus,
  getExpiringCurrencies,
  type CurrencyWithStatus,
} from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/**
 * Fetch currencies from IndexedDB
 */
async function fetchCurrencies(): Promise<CurrencyWithStatus[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  const currencies = await getAllCurrenciesWithStatus()
  console.log("[Currencies] Fetched from IndexedDB:", currencies.length)
  return currencies
}

/**
 * Fetch expiring currencies
 */
async function fetchExpiringCurrencies(): Promise<CurrencyWithStatus[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  return getExpiringCurrencies()
}

/**
 * Hook for all currencies with status
 */
export function useCurrencies() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateCurrencies,
  } = useSWR(isReady ? CACHE_KEYS.currencies : null, fetchCurrencies, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Currencies] Refreshing...")
    return mutateCurrencies(undefined, { revalidate: true })
  }, [mutateCurrencies])

  return {
    currencies: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}

/**
 * Hook for expiring currencies (warning/critical status)
 */
export function useExpiringCurrencies() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateCurrencies,
  } = useSWR(
    isReady ? `${CACHE_KEYS.currencies}:expiring` : null,
    fetchExpiringCurrencies,
    {
      revalidateOnFocus: false,
      revalidateOnMount: true,
      dedupingInterval: 0,
    }
  )

  const refresh = useCallback(() => {
    return mutateCurrencies(undefined, { revalidate: true })
  }, [mutateCurrencies])

  return {
    expiringCurrencies: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
