"use client"

/**
 * Add an airline's fleet a TYPE at a time, instead of one registration at a
 * time: the airline's code → the types it flies, each with its count → "Add"
 * writes every airframe of that type to the aircraft list
 * (`addFleetAircraftToDatabase` — one write, and a registration already here
 * is left as it is). Type data (DOC 8643) is read once per type.
 *
 * The add-aircraft form's "By fleet" mode. The fleet is fetched when the mode
 * opens with the pilot's airline already filled in (opening it IS the
 * request), and otherwise only on Find or Enter — never per keystroke.
 */

import { useCallback, useEffect, useState } from "react"
import { mutate } from "swr"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormSection } from "@/components/ui/form-section"
import { lookup } from "@/lib/lookup/client"
import type { Fr24Fleet } from "@/lib/fr24/types"
import { addFleetAircraftToDatabase, batchGetAircraftByRegistrations } from "@/lib/db"
import { getAircraftType } from "@/lib/db/stores/reference/aircraft-types.store"
import { CACHE_KEYS } from "@/hooks/data"
import { normalizeRegistration } from "@/lib/utils/string"
import { useAirlineCode } from "@/hooks/use-airline-code"

type FleetState =
  | { status: "done"; fleet: Fr24Fleet; onDevice: Set<string> }
  | { status: "missing" }
  | { status: "failed" }

export function AirlineFleetSection({ onAdded }: { onAdded?: (count: number) => void }) {
  // Starts at the pilot's own airline (Settings › Logging, or their card's company).
  const airline = useAirlineCode()
  const [typed, setTyped] = useState<string | null>(null)
  const code = typed ?? airline ?? ""
  const valid = (c: string) => (/^[A-Z0-9]{2,3}$/.test(c.trim().toUpperCase()) ? c.trim().toUpperCase() : null)
  // The code last asked for (Find or Enter) — until then, the airline the
  // mode opened with: opening "By fleet" is the request for it. Each Find is
  // its own request (`n`): keyed on the code alone, Find after a failure
  // asked nothing, so a fleet that could not be loaded could not be retried.
  const [asked, setAsked] = useState<{ code: string; n: number } | null>(null)
  const askedCode = asked?.code ?? (typed === null && airline ? valid(airline) : null)
  const key = askedCode ? `${askedCode}#${asked?.n ?? 0}` : null
  const [result, setResult] = useState<{ key: string; value: FleetState } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const find = () => {
    const c = valid(code)
    if (c) setAsked((prev) => ({ code: c, n: (prev?.n ?? 0) + 1 }))
  }

  useEffect(() => {
    if (!key || !askedCode) return
    let cancelled = false
    void (async () => {
      const answer = await lookup.airlineFleet(askedCode)
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
    })()
    return () => {
      cancelled = true
    }
  }, [key, askedCode])

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
    <FormSection title="Fleet" className="mb-6">
      <div className="flex items-center justify-between gap-3 px-4 py-2 row-divider">
        <label htmlFor="fleet-airline" className="shrink-0 text-foreground">
          Airline
        </label>
        <div className="flex min-w-0 items-center gap-1">
          <input
            id="fleet-airline"
            value={code}
            onChange={(e) => setTyped(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                find()
              }
            }}
            placeholder="e.g. TR or TGW"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-28 min-w-0 bg-transparent text-right uppercase text-muted-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 p-0 text-primary"
            aria-label="Find this airline's fleet"
            disabled={!valid(code) || loading}
            onClick={find}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {!key && !loading && (
        <p className="px-4 py-2.5 row-divider text-xs text-muted-foreground">
          Enter an airline code, then Find.
        </p>
      )}
      {state?.status === "missing" && (
        <p className="px-4 py-2.5 row-divider text-xs text-muted-foreground">No fleet found for {askedCode}.</p>
      )}
      {state?.status === "failed" && (
        <p className="px-4 py-2.5 row-divider text-xs text-muted-foreground">The fleet could not be loaded. Find to try again.</p>
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
