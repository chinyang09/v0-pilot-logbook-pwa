"use client"

/**
 * One destination as a PICTURE (the owner, Nov 2026: "picture tells a
 * thousand words"), after a station weather widget:
 *
 * ```
 * BANGKOK                                   ● MVFR
 * VTBS · 14:05 UTC+7 ☾ · 765nm
 * ─────────────────────────────────────────────
 * ┌──┐  220°/15kt  ≋ 25kt
 * │╲ │  28°/24° · Q1009
 * └──┘  [ 12kt ↓   6kt →     Landing 19L · 3 arr ]
 * Rwys   01R/19L 13,123' · 01L/19R 12,139'
 * Near   VTBD 16nm · VTBU 59nm IFR
 * Last there 30 Oct · 3× this year                 ›
 * ```
 *
 * The airport card's top half (the owner, Nov 2026: wind, temperature and
 * QNH only — visibility, ceiling and the frequencies went; the METAR and TAF
 * under it say the rest). Its code, time, category, wind, QNH and runway fly
 * from the tile (`ap-*` morph keys).
 *
 * Dark cockpit: VFR, no gust, no hazard light nothing; a category below VFR
 * is a coloured dot, a gust or a tailwind amber. The runways are the airport
 * data's (`useAirportInfo`, aviationweather.gov) with their TRUE headings, so
 * the wind a METAR gives resolves onto them exactly; the favoured one is the
 * most headwind. Without the data the wind is drawn alone.
 */

import * as React from "react"
import { usePreferences } from "@/components/providers/preferences-provider"
import { formatRunwayLength } from "@/lib/utils/runway-length"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Moon, PlaneLanding, PlaneTakeoff, Sun, Wind } from "lucide-react"
import type { Airport } from "@/types/entities/airport.types"
import type { AirportInfo } from "@/lib/weather/airport-info"
import { metarConditions, metarReadings, type FlightCategory } from "@/lib/weather/brief"
import type { WindOnRunway } from "@/lib/weather/runway-wind"
import type { RunwayUse } from "@/lib/weather/runway-in-use"
import { fallbackRunway, type AirportRunwayState } from "./runway-state"
import { RunwayDiagram, windWords } from "./runway-diagram"
import { isNight } from "@/lib/utils/night-time"
import { hasCoordinates } from "@/lib/utils/flight-calculations"
import { getAirportLocalTime, getAirportTimeInfo } from "@/lib/db/stores/reference/airports.store"
import { formatTimezoneOffset } from "@/lib/utils/time"
import { cn } from "@/lib/utils"
import { AlternateChip, type AlternateBrief } from "./alternates"

/** A category below VFR — VFR is nominal and lights nothing. */
const CATEGORY_DOT: Record<Exclude<FlightCategory, "VFR">, string> = {
  MVFR: "bg-sky-500",
  IFR: "bg-destructive",
  LIFR: "bg-fuchsia-500",
}


/** The wind's head (tail, amber) and cross components on one runway: "12kt↓ 6kt→". */
function Components({ wind }: { wind: WindOnRunway }) {
  return (
    <>
      <span className={cn("inline-flex items-center gap-0.5", wind.headKt < 0 && "text-status-warning")}>
        {Math.abs(wind.headKt)}kt
        {wind.headKt < 0 ? <ArrowUp className="h-3.5 w-3.5" aria-label="tailwind" /> : <ArrowDown className="h-3.5 w-3.5" aria-label="headwind" />}
      </span>
      {wind.crossKt > 0 && (
        <span className="inline-flex items-center gap-0.5">
          {wind.crossKt}kt
          {wind.crossFrom === "L" ? (
            <ArrowRight className="h-3.5 w-3.5" aria-label="crosswind from the left" />
          ) : (
            <ArrowLeft className="h-3.5 w-3.5" aria-label="crosswind from the right" />
          )}
        </span>
      )}
    </>
  )
}

/** One runway in use: "✈↓ 20C  12kt↓ 6kt→  3 arr". */
function UseRow({ kind, use, morph }: { kind: "arr" | "dep"; use: RunwayUse; morph?: string }) {
  const Icon = kind === "arr" ? PlaneLanding : PlaneTakeoff
  return (
    <p className="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-1 text-[13px] font-semibold tabular-nums text-foreground">
      <span className="inline-flex items-center gap-1">
        <Icon className={cn("h-3.5 w-3.5", kind === "arr" ? "text-primary" : "text-foreground")} aria-label={kind === "arr" ? "Landing" : "Departing"} />
        <span data-morph={morph}>{use.ident}</span>
      </span>
      {use.wind && <Components wind={use.wind} />}
      <span className="ml-auto whitespace-nowrap font-normal text-muted-foreground" title="Aeroplanes seen using it over the last 20 minutes">
        {use.count} {kind}
      </span>
    </p>
  )
}

/** A labelled line: "Rwys  01R/19L 13,123' · …". */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex items-baseline gap-2 text-[13px] tabular-nums">
      <span className="w-9 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap gap-x-2.5 gap-y-0.5">{children}</span>
    </p>
  )
}

export function AirportPanel({
  icao,
  code,
  airport,
  info,
  metar,
  arrivalMs,
  weatherAsked,
  nearby,
  codeOf,
  lastLine,
  onLast,
  rwy,
  morph = true,
}: {
  /** Whether this is the airport on show — the shared morph's keys go on it only. */
  morph?: boolean
  /** Its runways and which are in use (`useAirportRunways`, shared with the tile). */
  rwy: AirportRunwayState
  icao: string
  code: string
  airport: Airport | undefined
  /** Runways (and frequencies, no longer shown); undefined while asked, null when the source has none. */
  info: AirportInfo | null | undefined
  metar: { raw: string; category: FlightCategory | null } | null
  /** When the duty arrives there, for day or night on arrival. */
  arrivalMs: number | null
  /** Whether the weather is asked at all — the duty is within a TAF's reach. */
  weatherAsked: boolean
  /** The aerodromes near it, for a diversion. */
  nearby: AlternateBrief[]
  codeOf: (icao: string) => string
  /** "Last there 30 Oct · 3× this year". */
  lastLine: string
  onLast?: () => void
}) {
  const mk = (k: string) => (morph ? `ap-${k}-${icao}` : undefined)
  // Feet or metres, as Settings › Display says.
  const unit = usePreferences().preferences?.display?.runwayLength
  const c = React.useMemo(() => (metar ? metarConditions(metar.raw) : null), [metar])
  const readings = React.useMemo(() => (metar ? metarReadings(metar.raw) : null), [metar])
  const windDir = c?.windDir ?? null
  // The runways the traffic is landing on and departing from, else the one the wind favours.
  const { landing, departing, favoured, geometry } = rwy
  // The runways listed: the geometry's where there is one, else the airport data's.
  const listed = geometry?.length
    ? geometry.map((r) => ({ id: r.id, lengthFt: r.lengthFt }))
    : (info?.runways ?? []).map((r) => ({ id: r.id, lengthFt: r.lengthFt }))
  const category = metar?.category ?? null
  const night =
    arrivalMs !== null && airport && hasCoordinates(airport) ? isNight(new Date(arrivalMs), airport.latitude, airport.longitude) : null
  const Arrive = night === null ? null : night ? Moon : Sun
  const local = airport?.tz ? getAirportLocalTime(airport.tz).split(" ")[0] : null
  const offset = airport?.tz ? formatTimezoneOffset(getAirportTimeInfo(airport.tz).offset) : null
  // The airport database's NAME — what the Airports page and the briefing
  // call it (the owner, Nov 2026: one name everywhere, not the city here).
  const place = airport?.name || airport?.city || ""

  const windText = windWords(windDir, c?.windKt)
  const temp =
    readings?.tempC !== null && readings?.tempC !== undefined ? `${readings.tempC}°${readings.dewC !== null ? `/${readings.dewC}°` : ""}` : null

  return (
    <div className="py-2">
      {/* Where and the time there: the CODE large (the tile's, flying in),
          the airport's full name under it in smaller type — wrapping onto a
          second line rather than cut short (the owner, Nov 2026: swap them,
          "else the full airport name will always be truncated"). */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight tracking-tight text-foreground" data-morph={mk("code")}>
            {code}
          </p>
          {place && (
            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground" data-morph={mk("place")}>
              {place}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] tabular-nums text-muted-foreground" suppressHydrationWarning>
            {local && (
              <span>
                <span data-morph={mk("time")}>{local}</span> {offset}
              </span>
            )}
            {Arrive && <Arrive className="h-3.5 w-3.5" aria-label={night ? "Arrive by night" : "Arrive by day"} />}
          </p>
        </div>
        {category && category !== "VFR" && (
          <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            <span className={cn("h-3 w-3 rounded-full", CATEGORY_DOT[category])} aria-hidden />
            <span className="text-xs font-semibold text-foreground" data-morph={mk("cat")}>
              {category}
            </span>
          </span>
        )}
      </div>

      {/* The weather there, as a picture. */}
      {c ? (
        <div className="mt-2 flex items-center gap-3 border-t border-border/70 pt-2.5">
          <RunwayDiagram
            geometry={geometry}
            fallback={fallbackRunway(rwy)}
            landing={landing?.ident ?? null}
            departing={departing?.ident ?? null}
            favoured={favoured?.end.ident ?? null}
            windDir={windDir}
            windKt={c.windKt}
            gust={c.gustKt}
            size={88}
            morph={mk("rwys")}
          />
          <div className="min-w-0 flex-1 space-y-1">
            {/* Wind • temperature • QNH on one line (the owner, Nov 2026). */}
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-[15px] font-semibold tabular-nums text-foreground">
              <span data-morph={mk("wind")}>{windText ?? "Wind —"}</span>
              {c.gustKt ? <span className="text-status-warning">G{c.gustKt}</span> : null}
              {temp && (
                <>
                  <span className="font-normal text-muted-foreground">•</span>
                  <span data-morph={mk("temp")}>{temp}</span>
                </>
              )}
              {readings?.qnhHpa ? (
                <>
                  <span className="font-normal text-muted-foreground">•</span>
                  <span data-morph={mk("qnh")}>Q{readings.qnhHpa}</span>
                </>
              ) : null}
            </p>
            {landing && <UseRow kind="arr" use={landing} morph={mk("land")} />}
            {departing && <UseRow kind="dep" use={departing} morph={mk("dep")} />}
            {favoured && (
              <p className="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-1 text-[13px] font-semibold tabular-nums text-foreground">
                <span className="inline-flex items-center gap-1">
                  <Wind className="h-3.5 w-3.5 text-muted-foreground" aria-label="Favoured by the wind" />
                  <span data-morph={mk("fav")}>{favoured.end.ident}</span>
                </span>
                <Components wind={favoured} />
                <span className="ml-auto font-normal text-muted-foreground">by wind</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 border-t border-border/70 pt-2 text-[13px] text-muted-foreground">
          {weatherAsked ? "No report from here yet" : "Weather from 30 hours before"}
        </p>
      )}

      {/* The airport itself: its runways and what is near. */}
      <div className="mt-2 space-y-1">
        {listed.length > 0 && (
          <Line label="Rwys">
            {listed.map((r) => (
              <span key={r.id} className="whitespace-nowrap">
                <span className="font-semibold text-foreground">{r.id}</span>
                {r.lengthFt ? <span className="text-muted-foreground"> {formatRunwayLength(r.lengthFt, unit)}</span> : null}
              </span>
            ))}
          </Line>
        )}
        {nearby.some((a) => a.planned) && (
          <Line label="Altn">
            {nearby
              .filter((a) => a.planned)
              .map((a) => (
                <AlternateChip key={a.alt.icao} a={a} code={codeOf} showWeather={weatherAsked} />
              ))}
          </Line>
        )}
        {nearby.some((a) => !a.planned) && (
          <Line label="Near">
            {nearby.filter((a) => !a.planned).map((a) => (
              <AlternateChip key={a.alt.icao} a={a} code={codeOf} showWeather={weatherAsked} />
            ))}
          </Line>
        )}
      </div>

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
      ) : lastLine ? (
        <p className="mt-2 truncate text-[13px] text-muted-foreground">{lastLine}</p>
      ) : null}
    </div>
  )
}
