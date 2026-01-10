"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { getAllPersonnel, type Personnel } from "@/lib/db"
import { useDBReady, CACHE_KEYS, checkDBReady } from "./use-db"

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
    isValidating,
    mutate: mutatePersonnel,
  } = useSWR(isReady ? CACHE_KEYS.personnel : null, fetchPersonnel, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[Crew] Refreshing...")
    return mutatePersonnel(undefined, { revalidate: true })
  }, [mutatePersonnel])

  return {
    personnel: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}
