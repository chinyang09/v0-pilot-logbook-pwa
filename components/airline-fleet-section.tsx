"use client"

/**
 * Add an airline's fleet a TYPE at a time, instead of one registration at a
 * time: the airline's code → the types it flies, each with its count → "Add"
 * writes every airframe of that type to the aircraft list
 * (`addFleetAircraftToDatabase` — one write, and a registration already here
 * is left as it is). Type data (DOC 8643) is read once per type.
 *
 * Lives under the add-aircraft form, so it is reached the same way on a phone
 * and in the detail panel.
 */

import { useCallback, useEffect, useState } from "react"
import { mutate } from "swr"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormSection } from "@/components/ui/form-section"
import { SettingsRow } from "@/components/ui/settings-row"
import { lookup } from "@/lib/lookup/client"
import type { Fr24Fleet } from "@/lib/fr24/types"
import { addFleetAircraftToDatabase, batchGetAircraftByRegistrations } from "@/lib/db"
import { getAircraftType } from "@/lib/db/stores/reference/aircraft-types.store"
import { CACHE_KEYS } from "@/hooks/data"
import { normalizeRegistration } from "@/lib/utils/string"
import { usePreferences } from "@/components/providers/preferences-provider"

const SETTLE_MS = 500

type FleetState =
  | { status: "done"; fleet: Fr24Fleet; onDevice: Set<string> }
  | { status: "missing" }
  | { status: "failed" }

export function AirlineFleetSection({ onAdded }: { onAdded?: (count: number) => void }) {
  // Starts at the pilot's own airline (Settings › Logging), when one is set.
  const { preferences } = usePreferences()
  const [code, setCode] = useState(preferences.logging.airline ?? "")
  const key = /^[A-Z0-9]{2,3}$/.test(code.trim().toUpperCase()) ? code.trim().toUpperCase() : null
  const [result, setResult] = useState<{ key: string; value: FleetState } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const answer = await lookup.airlineFleet(key)
      if (cancelled) return
      if (!answer.ok) {
        setResult({ key, value: answer.status === 404 ? { status: "missing" } : { status: "failed" } })
        return
      }
      const regs = answer.data.types.flatMap((t) => t.aircraft.map((a) => a.registration))
      const held = await batchGetAircraftByRegistrations(regs)
      if (cancelled) return
      const onDevice = new Set([...held.values()].map((a) => normalizeRegistration(a.registration)))
      setResult({ key, value: { status: "done", fleet: answer.data, onDevice } })
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key])

  const state = key && result?.key === key ? result.value : null
  const loading = !!key && !state

  const addType = useCallback(
    async (fleet: Fr24Fleet, typecode: string) => {
      const type = fleet.types.find((t) => t.typecode === typecode)
      if (!type || !key) return
      setAdding(typecode)
      try {
        const info = await getAircraftType(typecode)
        const written = await addFleetAircraftToDatabase(
          type.aircraft.map((a) => ({
            registration: a.registration,
            icao24: "",
            typecode,
            operator: fleet.airline.icao || fleet.airline.iata,
            shortDescription: info?.description,
            wtc: info?.wtc,
            wtg: info?.wtg,
            manufacturerCode: info?.manufacturer,
            source: "fr24" as const,
          }))
        )
        await Promise.all([mutate(CACHE_KEYS.referenceAircraft), mutate("idb:aircraft-reference:type-index")])
        setResult((prev) =>
          prev?.key === key && prev.value.status === "done"
            ? {
                key,
                value: {
                  ...prev.value,
                  onDevice: new Set([...prev.value.onDevice, ...type.aircraft.map((a) => normalizeRegistration(a.registration))]),
                },
              }
            : prev
        )
        onAdded?.(written)
      } finally {
        setAdding(null)
      }
    },
    [key, onAdded]
  )

  return (
    <FormSection title="Add a fleet" className="mb-6">
      <SettingsRow label="Airline" value={code} onChange={setCode} placeholder="e.g. TR or TGW" uppercase />
      {loading && (
        <div className="flex items-center gap-2 px-4 py-2.5 row-divider text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Finding the fleet…
        </div>
      )}
      {state?.status === "missing" && (
        <p className="px-4 py-2.5 row-divider text-xs text-muted-foreground">No fleet found for {key}.</p>
      )}
      {state?.status === "failed" && (
        <p className="px-4 py-2.5 row-divider text-xs text-muted-foreground">The fleet could not be loaded. Try again later.</p>
      )}
      {state?.status === "done" &&
        state.fleet.types.map((type) => {
          const missing = type.aircraft.filter((a) => !state.onDevice.has(normalizeRegistration(a.registration))).length
          const model = type.aircraft[0]?.model
          return (
            <div key={type.typecode} className="flex items-center justify-between gap-3 px-4 py-2.5 row-divider">
              <div className="min-w-0">
                <p className="text-foreground">
                  {type.typecode} <span className="text-muted-foreground">· {type.aircraft.length}</span>
                </p>
                {model && <p className="truncate text-xs text-muted-foreground">{model}</p>}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={missing === 0 || adding !== null}
                onClick={() => void addType(state.fleet, type.typecode)}
                aria-label={missing === 0 ? `${type.typecode}: all added` : `Add ${missing} ${type.typecode}`}
              >
                {adding === type.typecode ? <Loader2 className="h-4 w-4 animate-spin" /> : missing === 0 ? "Added" : `Add ${missing}`}
              </Button>
            </div>
          )
        })}
    </FormSection>
  )
}
