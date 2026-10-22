"use client"

import { useCallback } from "react"
import useSWR from "swr"
import {
  getAllScheduleEntries,
  getScheduleEntriesByDateRange,
  type ScheduleEntry,
} from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"
import { useHeldWhileHidden } from "@/hooks/use-page-active"

/** One empty list, so "no data yet" is the same reference every render. */
const NONE: never[] = []

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
    mutate: mutateEntries,
  } = useSWR(isReady ? CACHE_KEYS.schedule : null, fetchScheduleEntries, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Schedule] Refreshing...")
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateEntries()
  }, [mutateEntries])

  // Held while this page is behind another tab — see `useHeldWhileHidden`.
  const live = useHeldWhileHidden(data)

  return {
    scheduleEntries: live ?? NONE,
    isLoading,
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
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutateEntries()
  }, [mutateEntries])

  return {
    scheduleEntries: data ?? [],
    isLoading,
    error,
    refresh,
  }
}
