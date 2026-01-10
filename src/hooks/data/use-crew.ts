"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { useDBReady } from "./use-db-ready"
import { getAllPersonnel } from "@/lib/db/stores/user/crew.store"
import type { Personnel } from "@/types/entities/crew.types"

export const PERSONNEL_CACHE_KEY = "idb:personnel"

async function fetchPersonnel(): Promise<Personnel[]> {
  const personnel = await getAllPersonnel()
  console.log("[v0] Fetched personnel from IndexedDB:", personnel.length)
  return personnel
}

export function usePersonnel() {
  const { isReady } = useDBReady()

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: mutatePersonnel,
  } = useSWR(isReady ? PERSONNEL_CACHE_KEY : null, fetchPersonnel, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    dedupingInterval: 0,
  })

  const refresh = useCallback(() => {
    console.log("[v0] Refreshing personnel...")
    return mutatePersonnel(undefined, { revalidate: true })
  }, [mutatePersonnel])

  return {
    personnel: data ?? [],
    isLoading: isLoading || isValidating,
    error,
    refresh,
  }
}

// Alias for backwards compatibility
export const useCrew = usePersonnel
