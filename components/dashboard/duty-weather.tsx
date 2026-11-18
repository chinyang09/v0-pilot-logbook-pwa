"use client"

/**
 * The duty's weather, in its detail panel: each airport it touches, in the
 * order flown, with its latest METAR and TAF as the pilot reads them — raw,
 * the TAF broken at its change groups. Asked when the panel opens
 * (`useAirportWeather`), never in the background.
 */

import { useMemo, useState } from "react"
import { CloudSun } from "lucide-react"
import { FormSection } from "@/components/ui/form-section"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import { useAirportWeather } from "@/hooks/use-airport-weather"
import { ageText, tafLines } from "@/lib/weather/format"
import { formatInstant } from "@/lib/utils/tz-format"
import { usePreferences } from "@/components/providers/preferences-provider"
import type { FlightLog } from "@/types/entities/flight.types"

/** Every airport the legs touch, in the order flown, each once. */
export function dutyStations(legs: readonly Pick<FlightLog, "departureIcao" | "arrivalIcao">[]): string[] {
  const out: string[] = []
  for (const l of legs) {
    for (const code of [l.departureIcao, l.arrivalIcao]) {
      const c = (code || "").toUpperCase()
      if (/^[A-Z0-9]{4}$/.test(c) && !out.includes(c)) out.push(c)
    }
  }
  return out
}

export function DutyWeather({ legs }: { legs: readonly Pick<FlightLog, "departureIcao" | "arrivalIcao">[] }) {
  const stations = useMemo(() => dutyStations(legs), [legs])
  const { weather, failed, loading, refresh } = useAirportWeather(stations, true)
  const { preferences } = usePreferences()
  // Read once per render of an answer: ages are minutes, not a ticking clock.
  const [now, setNow] = useState(() => Date.now())
  const clock = (ms: number) => formatInstant(ms, { ...preferences.display, useZuluTime: true }, "UTC")

  if (stations.length === 0) return null

  const fetched = weather ? Math.max(weather.fetchedAt.metar, weather.fetchedAt.taf) : 0
  const caption = failed
    ? "Weather unavailable — check your connection and try again."
    : !weather
      ? "Fetching…"
      : weather.stale
        ? `The weather source did not answer; this is from ${ageText(fetched, now)}.`
        : null

  return (
    <>
      <FormSection title="Weather">
        {caption && <p className="row-divider relative px-4 py-3 text-sm text-muted-foreground">{caption}</p>}
        {weather &&
          stations.map((id) => {
            const metar = weather.metar[id]
            const taf = weather.taf[id]
            return (
              <div key={id} className="row-divider relative space-y-1.5 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-foreground">{id}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {metar ? `${clock(metar.at)} · ${ageText(metar.at, now)}${metar.category ? ` · ${metar.category}` : ""}` : "No METAR"}
                  </span>
                </div>
                {metar && <p className="break-words text-[13px] leading-snug text-foreground tabular-nums">{metar.raw}</p>}
                {taf ? (
                  <div className="space-y-0.5 text-[13px] leading-snug text-muted-foreground tabular-nums">
                    {tafLines(taf.raw).map((line, i) => (
                      <p key={i} className={i > 0 ? "break-words pl-3" : "break-words"}>
                        {line}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No TAF</p>
                )}
              </div>
            )
          })}
      </FormSection>
      <ActionStack>
        <ActionRow
          label={loading ? "Fetching Weather…" : "Refresh Weather"}
          icon={<CloudSun />}
          disabled={loading}
          onClick={() => {
            setNow(Date.now())
            refresh()
          }}
        />
      </ActionStack>
    </>
  )
}
