"use client"

/**
 * A flight's briefing, the NOTAM register and the route / airport notes
 * (`lib/briefing/`), read from IndexedDB through SWR like every other list.
 * Every key carries the `idb:` prefix, so a sync's `refreshAllData` brings
 * them up to date with what another device wrote.
 */

import { useMemo } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import { getAllBriefings, getBriefing, getBriefingNote, getNotamRegister } from "@/lib/db"
import { checkDBReady, useDBReady } from "./use-db"
import { noteId } from "@/lib/briefing/ids"
import type { BriefingNoteRecord, BriefingRecord, NotamRecord } from "@/types/entities/briefing.types"

const OPTS = { revalidateOnFocus: false, revalidateOnMount: true, dedupingInterval: 0 } as const
const EMPTY_REGISTER: ReadonlyMap<string, NotamRecord> = new Map()

export const BRIEFING_KEYS = {
  one: (id: string) => `idb:briefing:${id}`,
  all: "idb:briefings",
  register: "idb:notams",
  note: (scope: "route" | "airport", ref: string) => `idb:${noteId(scope, ref)}`,
}

/** A briefing by id; `null` once IndexedDB has answered that there is none. */
export function useBriefing(id: string | null) {
  const { isReady } = useDBReady()
  const { data, isLoading, mutate } = useSWR(
    isReady && id ? BRIEFING_KEYS.one(id) : null,
    async () => ((await checkDBReady()) && id ? ((await getBriefing(id)) ?? null) : null),
    OPTS,
  )
  return { briefing: data as BriefingRecord | null | undefined, isLoading, refresh: () => mutate() }
}

/**
 * The briefings of several flights by id — the dashboard's duty, for the
 * alternates its OFPs plan. Read by key, never the whole table (each is ~65KB).
 */
export function useBriefingsByIds(ids: readonly string[]): BriefingRecord[] {
  const { isReady } = useDBReady()
  const { data } = useSWR(
    isReady && ids.length > 0 ? `idb:briefing:some:${ids.join("|")}` : null,
    async () => {
      if (!(await checkDBReady())) return []
      const found = await Promise.all(ids.map((id) => getBriefing(id)))
      return found.filter((r): r is BriefingRecord => !!r)
    },
    OPTS,
  )
  return data ?? NO_BRIEFINGS
}
const NO_BRIEFINGS: BriefingRecord[] = []

export function useAllBriefings() {
  const { isReady } = useDBReady()
  const { data } = useSWR(isReady ? BRIEFING_KEYS.all : null, async () => ((await checkDBReady()) ? getAllBriefings() : []), OPTS)
  return data
}

/**
 * The register, by record id. Fetched as an ARRAY and indexed here: SWR
 * compares a new answer with `dequal/lite`, which sees no keys on a `Map` and
 * calls any two equal — so a flag set and re-read was dropped as "unchanged".
 */
export function useNotamRegister(): ReadonlyMap<string, NotamRecord> {
  const { isReady } = useDBReady()
  const { data } = useSWR(
    isReady ? BRIEFING_KEYS.register : null,
    async () => ((await checkDBReady()) ? [...(await getNotamRegister()).values()] : []),
    OPTS,
  )
  return useMemo(() => (data ? new Map(data.map((r) => [r.id, r])) : EMPTY_REGISTER), [data])
}

export function useBriefingNote(scope: "route" | "airport", ref: string | null) {
  const { isReady } = useDBReady()
  const { data } = useSWR(
    isReady && ref ? BRIEFING_KEYS.note(scope, ref) : null,
    async () => ((await checkDBReady()) && ref ? ((await getBriefingNote(scope, ref)) ?? null) : null),
    OPTS,
  )
  return data as BriefingNoteRecord | null | undefined
}

/** Re-read every briefing cache after a write. */
export function refreshBriefingCaches() {
  return globalMutate((key) => typeof key === "string" && (key.startsWith("idb:briefing") || key === BRIEFING_KEYS.register || key.startsWith("idb:note:")))
}
