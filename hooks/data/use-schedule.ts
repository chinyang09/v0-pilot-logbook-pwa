"use client"

import { useCallback } from "react"
import useSWR from "swr"
import {
  getAllScheduleEntries,
  getScheduleEntriesByDateRange,
  type ScheduleEntry,
} from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

/**
 * Fetch schedule entries from IndexedDB
 */
async function fetchScheduleEntries(): Promise<ScheduleEntry[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  const entries = await getAllScheduleEntries()
  console.log("[Schedule] Fetched from IndexedDB:", entries.length)
  return entries
}

/**
 * Hook for schedule entries data
 */
export function useScheduleEntries() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateEntries,
  } = useSWR(isReady ? CACHE_KEYS.schedule : null, fetchScheduleEntries, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Schedule] Refreshing...")
    return mutateEntries(undefined, { revalidate: true })
  }, [mutateEntries])

  return {
    scheduleEntries: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}

/**
 * Hook for schedule entries by date range
 */
export function useScheduleEntriesByDateRange(startDate: string, endDate: string) {
  const { isReady } = useDBReady()

  const fetcher = async () => {
    const ready = await checkDBReady()
    if (!ready) return []
    return getScheduleEntriesByDateRange(startDate, endDate)
  }

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutateEntries,
  } = useSWR(
    isReady && startDate && endDate
      ? `${CACHE_KEYS.schedule}:${startDate}:${endDate}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnMount: true,
      dedupingInterval: 0,
    }
  )

  const refresh = useCallback(() => {
    return mutateEntries(undefined, { revalidate: true })
  }, [mutateEntries])

  return {
    scheduleEntries: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
