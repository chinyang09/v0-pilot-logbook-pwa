"use client"

/**
 * One destination as a PICTURE (the owner, Nov 2026: "provide more details for
 * airport… picture tells a thousand words"), after a station weather widget:
 *
 * ```
 * JAKARTA                         ● MVFR
 * 14:05 local · ☾
 * ─────────────────────────────────────────
 * ┌──┐  050°/14kt  ≋ 20kt
 * │╲ │  C 1,100' · Vis 6 km
 * └──┘  [ 19kt ↓   7kt →          34 ≡ ]
 * Last there 30 Oct · 3× this year       ›
 * ```
 *
 * Dark cockpit: VFR, no gust, no ceiling light nothing; a category below VFR
 * is a coloured dot and word, a gust amber, a tailwind amber. The runway is
 * the one the wind favours (`favouredRunway`), read off its designator — an
 * approximation of the magnetic heading, said as "favoured", never as a
 * performance figure. Runways are asked only while this panel is up
 * (`useRunways`); without them the wind is drawn alone.
 */

import * as React from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Moon, Sun, Wind } from "lucide-react"
import type { Airport } from "@/types/entities/airport.types"
import { ceilingFt, metarConditions, type FlightCategory } from "@/lib/weather/brief"
import { favouredRunway, runwayEnds, type WindOnRunway } from "@/lib/weather/runway-wind"
import { useRunways } from "@/hooks/use-runways"
import { isNight } from "@/lib/utils/night-time"
import { hasCoordinates } from "@/lib/utils/flight-calculations"
import { getAirportLocalTime } from "@/lib/db/stores/reference/airports.store"
import { cn } from "@/lib/utils"

/** A category below VFR — VFR is nominal and lights nothing. */
const CATEGORY_DOT: Record<Exclude<FlightCategory, "VFR">, string> = {
  MVFR: "bg-sky-500",
  IFR: "bg-destructive",
  LIFR: "bg-fuchsia-500",
}

const fmtFt = (n: number) => `${n.toLocaleString("en-US")}'`
const fmtVis = (m: number) => (m >= 9999 ? "10 km+" : m >= 5000 ? `${Math.round(m / 1000)} km` : `${m} m`)

/** The runway and the wind on it, as a picture: north up, the wind's arrow pointing where it blows. */
function RunwayPicture({ favoured, windDir }: { favoured: WindOnRunway | null; windDir: number | null }) {
  const S = 60
  const c = S / 2
  const at = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180
    return [c + r * Math.sin(rad), c - r * Math.cos(rad)] as const
  }
  const h = favoured?.end.headingDeg
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="shrink-0 rounded-xl bg-muted" aria-hidden>
      {h !== undefined && (
        <>
          {/* The runway the wind favours (its number is in the bar beside). */}
          <line
            x1={at(h + 180, 21)[0]}
            y1={at(h + 180, 21)[1]}
            x2={at(h, 21)[0]}
            y2={at(h, 21)[1]}
            stroke="currentColor"
            strokeOpacity={0.75}
            strokeWidth={5}
            strokeLinecap="round"
          />
        </>
      )}
      {windDir !== null && (
        <g className="text-primary">
          {/* From where it comes, toward the centre. */}
          <line
            x1={at(windDir, 27)[0]}
            y1={at(windDir, 27)[1]}
            x2={at(windDir, 9)[0]}
            y2={at(windDir, 9)[1]}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <polygon
            points={[at(windDir, 6), at(windDir + 22, 13), at(windDir - 22, 13)].map(([x, y]) => `${x},${y}`).join(" ")}
            fill="currentColor"
          />
        </g>
      )}
    </svg>
  )
}

export function AirportPanel({
  icao,
  code,
  airport,
  metar,
  arrivalMs,
  weatherAsked,
  lastLine,
  onLast,
}: {
  icao: string
  /** How the pilot reads the code (Settings › Display). */
  code: string
  airport: Airport | undefined
  metar: { raw: string; category: FlightCategory | null } | null
  /** When the duty arrives there, for day or night on arrival. */
  arrivalMs: number | null
  /** Whether the weather is asked at all — the duty is within a TAF's reach. */
  weatherAsked: boolean
  /** "Last there 30 Oct · 3× this year". */
  lastLine: string
  onLast?: () => void
}) {
  const { names } = useRunways(icao, true)
  const c = React.useMemo(() => (metar ? metarConditions(metar.raw) : null), [metar])
  const ends = React.useMemo(() => runwayEnds(names), [names])
  const windDir = c?.windDir ?? null
  const favoured = c ? favouredRunway(ends, windDir, c.windKt) : null
  const ceiling = c ? ceilingFt(c) : null
  const category = metar?.category ?? null
  const night =
    arrivalMs !== null && airport && hasCoordinates(airport) ? isNight(new Date(arrivalMs), airport.latitude, airport.longitude) : null
  const Arrive = night === null ? null : night ? Moon : Sun

  const windText =
    c?.windKt === undefined ? null : c.windKt === 0 ? "Calm" : `${windDir === null ? "VRB" : String(windDir).padStart(3, "0") + "°"}/${c.windKt}kt`

  return (
    <div className="py-2">
      {/* Where, and the time there. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold uppercase leading-tight tracking-tight text-foreground">
            {airport?.city || airport?.name || code}
          </p>
          <p className="flex items-center gap-1.5 text-[13px] tabular-nums text-muted-foreground" suppressHydrationWarning>
            {/* The code under the place — not when the place IS the code. */}
            {(airport?.city || airport?.name) && <span>{code}</span>}
            {airport?.tz && <span>{airport.city || airport.name ? "· " : ""}{getAirportLocalTime(airport.tz)}</span>}
            {Arrive && <Arrive className="h-3.5 w-3.5" aria-label={night ? "Arrive by night" : "Arrive by day"} />}
          </p>
        </div>
        {category && category !== "VFR" && (
          <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            <span className={cn("h-3 w-3 rounded-full", CATEGORY_DOT[category])} aria-hidden />
            <span className="text-xs font-semibold text-foreground">{category}</span>
          </span>
        )}
      </div>

      {/* The weather there, as a picture. */}
      {c ? (
        <div className="mt-2 flex items-center gap-3 border-t border-border/70 pt-2.5">
          <RunwayPicture favoured={favoured} windDir={windDir} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-semibold tabular-nums text-foreground">
              <span>{windText ?? "Wind —"}</span>
              {c.gustKt ? (
                <span className="inline-flex items-center gap-0.5 text-status-warning">
                  <Wind className="h-3.5 w-3.5" aria-hidden />
                  {c.gustKt}kt
                </span>
              ) : null}
            </p>
            <p className="truncate text-[13px] tabular-nums text-muted-foreground">
              {ceiling !== null ? (
                <>
                  Ceiling <span className="font-semibold text-foreground">{fmtFt(ceiling)}</span>
                </>
              ) : (
                "No ceiling"
              )}
              {c.visM !== undefined && <> · Vis {fmtVis(c.visM)}</>}
            </p>
            {favoured && (
              <p className="flex items-center gap-3 rounded-lg bg-muted px-2.5 py-1 text-[13px] font-semibold tabular-nums text-foreground">
                <span className={cn("inline-flex items-center gap-0.5", favoured.headKt < 0 && "text-status-warning")}>
                  {Math.abs(favoured.headKt)}kt
                  {favoured.headKt < 0 ? <ArrowUp className="h-3.5 w-3.5" aria-label="tailwind" /> : <ArrowDown className="h-3.5 w-3.5" aria-label="headwind" />}
                </span>
                {favoured.crossKt > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    {favoured.crossKt}kt
                    {favoured.crossFrom === "L" ? (
                      <ArrowRight className="h-3.5 w-3.5" aria-label="crosswind from the left" />
                    ) : (
                      <ArrowLeft className="h-3.5 w-3.5" aria-label="crosswind from the right" />
                    )}
                  </span>
                )}
                <span className="ml-auto text-muted-foreground">Rwy {favoured.end.ident}</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 border-t border-border/70 pt-2 text-[13px] text-muted-foreground">
          {weatherAsked ? "No report from here yet" : "Weather from 30 hours before"}
        </p>
      )}

      {/* When last there — a tap opens that flight. */}
      {onLast ? (
        <button
          type="button"
          onClick={onLast}
          className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg text-left text-[13px] text-muted-foreground active:bg-muted/60"
        >
          <span className="truncate">{lastLine}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      ) : (
        <p className="mt-2 truncate text-[13px] text-muted-foreground">{lastLine}</p>
      )}
    </div>
  )
}
