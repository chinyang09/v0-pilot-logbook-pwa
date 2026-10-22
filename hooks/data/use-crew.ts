"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { getAllPersonnel, type Personnel } from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"
import { useHeldWhileHidden } from "@/hooks/use-page-active"

/** One empty list, so "no data yet" is the same reference every render. */
const NONE: never[] = []

/**
 * Fetch personnel/crew from IndexedDB
 */
async function fetchPersonnel(): Promise<Personnel[]> {
  const ready = await checkDBReady()
  if (!ready) return []
  const personnel = await getAllPersonnel()
  console.log("[Crew] Fetched from IndexedDB:", personnel.length)
  return personnel
}

/**
 * Hook for personnel/crew data
 */
export function usePersonnel() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    mutate: mutatePersonnel,
  } = useSWR(isReady ? CACHE_KEYS.personnel : null, fetchPersonnel, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Crew] Refreshing...")
    // Revalidate WITHOUT clearing the cache. Passing `undefined` as data wipes it
    // first, which flips `isLoading` true and flashes this list's skeleton on every
    // background refresh — and hands out a NEW array reference even when nothing
    // changed, so SWR's deep `compare` can't hold the old one and every downstream
    // memo recomputes. `use-flights` has always done it this way; the rest had not.
    return mutatePersonnel()
  }, [mutatePersonnel])

  // Held while this page is behind another tab — see `useHeldWhileHidden`.
  const live = useHeldWhileHidden(data)

  return {
    personnel: live ?? NONE,
    isLoading,
    error,
    refresh,
  }
}
