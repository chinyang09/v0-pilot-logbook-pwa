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
    mutate: mutateDiscrepancies,
  } = useSWR(isReady ? CACHE_KEYS.discrepancies : null, fetchDiscrepancies, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Discrepancies] Refreshing...")
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateDiscrepancies()
  }, [mutateDiscrepancies])

  return {
    discrepancies: data ?? [],
    isLoading,
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
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateDiscrepancies()
  }, [mutateDiscrepancies])

  return {
    unresolvedDiscrepancies: data ?? [],
    isLoading,
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
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateCounts()
  }, [mutateCounts])

  return {
    counts: data ?? { total: 0, unresolved: 0, resolved: 0 },
    isLoading,
    error,
    refresh,
  }
}
