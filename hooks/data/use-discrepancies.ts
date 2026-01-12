"use client"

import { useCallback } from "react"
import useSWR from "swr"
import {
  getAllDiscrepancies,
  getUnresolvedDiscrepancies,
  getDiscrepanciesCount,
  type Discrepancy,
} from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/**
 * Fetch all discrepancies from IndexedDB
 */
async function fetchDiscrepancies(): Promise<Discrepancy[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  const discrepancies = await getAllDiscrepancies()
  console.log("[Discrepancies] Fetched from IndexedDB:", discrepancies.length)
  return discrepancies
}

/**
 * Fetch unresolved discrepancies
 */
async function fetchUnresolvedDiscrepancies(): Promise<Discrepancy[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  return getUnresolvedDiscrepancies()
}

/**
 * Fetch discrepancy counts
 */
async function fetchDiscrepancyCounts(): Promise<{
  total: number
  unresolved: number
  resolved: number
}> {
  const ready = await checkDBReady()
  if (!ready) return { total: 0, unresolved: 0, resolved: 0 }
  return getDiscrepanciesCount()
}

/**
 * Hook for all discrepancies
 */
export function useDiscrepancies() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateDiscrepancies,
  } = useSWR(isReady ? CACHE_KEYS.discrepancies : null, fetchDiscrepancies, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Discrepancies] Refreshing...")
    return mutateDiscrepancies(undefined, { revalidate: true })
  }, [mutateDiscrepancies])

  return {
    discrepancies: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}

/**
 * Hook for unresolved discrepancies only
 */
export function useUnresolvedDiscrepancies() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateDiscrepancies,
  } = useSWR(
    isReady ? `${CACHE_KEYS.discrepancies}:unresolved` : null,
    fetchUnresolvedDiscrepancies,
    {
      revalidateOnFocus: false,
      revalidateOnMount: true,
      dedupingInterval: 0,
    }
  )

  const refresh = useCallback(() => {
    return mutateDiscrepancies(undefined, { revalidate: true })
  }, [mutateDiscrepancies])

  return {
    unresolvedDiscrepancies: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}

/**
 * Hook for discrepancy counts
 */
export function useDiscrepancyCounts() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateCounts,
  } = useSWR(
    isReady ? `${CACHE_KEYS.discrepancies}:counts` : null,
    fetchDiscrepancyCounts,
    {
      revalidateOnFocus: false,
      revalidateOnMount: true,
      dedupingInterval: 0,
    }
  )

  const refresh = useCallback(() => {
    return mutateCounts(undefined, { revalidate: true })
  }, [mutateCounts])

  return {
    counts: data ?? { total: 0, unresolved: 0, resolved: 0 },
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
