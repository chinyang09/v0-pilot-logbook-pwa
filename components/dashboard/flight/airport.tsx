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
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Moon, PlaneLanding, PlaneTakeoff, Sun, Wind } from "lucide-react"
import type { Airport } from "@/types/entities/airport.types"
import type { AirportInfo } from "@/lib/weather/airport-info"
import { metarConditions, metarReadings, type FlightCategory } from "@/lib/weather/brief"
import type { WindOnRunway } from "@/lib/weather/runway-wind"
import type { RunwayUse } from "@/lib/weather/runway-in-use"
import type { RunwayGeo } from "@/lib/runways/parse"
import type { AirportRunwayState } from "./runway-state"
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

const fmtFt = (n: number) => `${Math.round(n).toLocaleString("en-US")}'`

/**
 * The airport's runways as a picture, to scale and north up, off their real
 * thresholds: the one landing on in the accent, the one departing from in
 * ink, the rest muted, and the wind's arrow pointing where it blows. Without
 * the geometry, the one runway shown is drawn through the middle.
 */
function RunwayPicture({
  geometry,
  heading,
  landing,
  departing,
  windDir,
}: {
  geometry: RunwayGeo[] | null | undefined
  /** Without geometry: the heading of the runway shown. */
  heading: number | undefined
  landing: string | null
  departing: string | null
  windDir: number | null
}) {
  const S = 64
  const c = S / 2
  const at = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180
    return [c + r * Math.sin(rad), c - r * Math.cos(rad)] as const
  }
  // Every placed runway, in nm east / north of their middle, scaled to fit.
  const lines = React.useMemo(() => {
    const placed = (geometry ?? []).flatMap((r) => {
      const [a, b] = r.ends
      return a && b && a.lat !== null && a.lon !== null && b.lat !== null && b.lon !== null
        ? [{ ends: [a.ident, b.ident], pts: [a, b].map((e) => [e.lon!, e.lat!] as const) }]
        : []
    })
    if (placed.length === 0) return null
    const lat0 = placed.reduce((s, p) => s + p.pts[0][1] + p.pts[1][1], 0) / (placed.length * 2)
    const lon0 = placed.reduce((s, p) => s + p.pts[0][0] + p.pts[1][0], 0) / (placed.length * 2)
    const k = Math.cos((lat0 * Math.PI) / 180)
    const xy = placed.map((p) => ({ ends: p.ends, pts: p.pts.map(([lon, lat]) => [(lon - lon0) * 60 * k, (lat - lat0) * 60] as const) }))
    const span = Math.max(0.5, ...xy.flatMap((p) => p.pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))))
    const scale = (S / 2 - 10) / span
    return xy.map((p) => ({ ends: p.ends, pts: p.pts.map(([x, y]) => [c + x * scale, c - y * scale] as const) }))
  }, [geometry, c])
  const tone = (ends: string[]) =>
    landing && ends.includes(landing) ? "text-primary" : departing && ends.includes(departing) ? "text-foreground" : "text-muted-foreground/60"
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="shrink-0 rounded-xl bg-muted" aria-hidden>
      {lines
        ? lines.map((l) => (
            <line
              key={l.ends.join()}
              x1={l.pts[0][0]}
              y1={l.pts[0][1]}
              x2={l.pts[1][0]}
              y2={l.pts[1][1]}
              stroke="currentColor"
              className={tone(l.ends)}
              strokeWidth={4}
              strokeLinecap="round"
            />
          ))
        : heading !== undefined && (
            <line
              x1={at(heading + 180, 22)[0]}
              y1={at(heading + 180, 22)[1]}
              x2={at(heading, 22)[0]}
              y2={at(heading, 22)[1]}
              stroke="currentColor"
              strokeOpacity={0.75}
              strokeWidth={5}
              strokeLinecap="round"
            />
          )}
      {windDir !== null && (
        <g className="text-primary">
          <line
            x1={at(windDir, 30)[0]}
            y1={at(windDir, 30)[1]}
            x2={at(windDir, 24)[0]}
            y2={at(windDir, 24)[1]}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <polygon
            points={[at(windDir, 19), at(windDir + 16, 25), at(windDir - 16, 25)].map(([x, y]) => `${x},${y}`).join(" ")}
            fill="currentColor"
          />
        </g>
      )}
    </svg>
  )
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
      <span className="ml-auto font-normal text-muted-foreground">
        {use.count} {kind} · 20m
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
  distanceNm,
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
  /** The leg's great-circle distance into it. */
  distanceNm: number | null
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
  const place = airport?.city || airport?.name || ""

  const windText =
    c?.windKt === undefined ? null : c.windKt === 0 ? "Calm" : `${windDir === null ? "VRB" : String(windDir).padStart(3, "0") + "°"}/${c.windKt}kt`
  const temp =
    readings?.tempC !== null && readings?.tempC !== undefined ? `${readings.tempC}°${readings.dewC !== null ? `/${readings.dewC}°` : ""}` : null

  return (
    <div className="py-2">
      {/* Where, the time there, and how far. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold uppercase leading-tight tracking-tight text-foreground" data-morph={place ? mk("place") : mk("code")}>
            {place || code}
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] tabular-nums text-muted-foreground" suppressHydrationWarning>
            {place && (
              <span className="font-semibold text-foreground" data-morph={mk("code")}>
                {code}
              </span>
            )}
            {local && (
              <span>
                <span data-morph={mk("time")}>{local}</span> {offset}
              </span>
            )}
            {Arrive && <Arrive className="h-3.5 w-3.5" aria-label={night ? "Arrive by night" : "Arrive by day"} />}
            {distanceNm !== null && (
              <span>
                · <span data-morph={mk("dist")}>{Math.round(distanceNm).toLocaleString("en-US")}nm</span>
              </span>
            )}
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
          <RunwayPicture
            geometry={geometry}
            heading={(landing?.wind ?? favoured)?.end.headingDeg}
            landing={landing?.ident ?? null}
            departing={departing?.ident ?? null}
            windDir={windDir}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-semibold tabular-nums text-foreground">
              <span data-morph={mk("wind")}>{windText ?? "Wind —"}</span>
              {c.gustKt ? (
                <span className="inline-flex items-center gap-0.5 text-status-warning">
                  <Wind className="h-3.5 w-3.5" aria-hidden />
                  {c.gustKt}kt
                </span>
              ) : null}
            </p>
            {(temp || readings?.qnhHpa) && (
              <p className="truncate text-[13px] tabular-nums text-muted-foreground">
                {temp && <span data-morph={mk("temp")}>{temp}</span>}
                {temp && readings?.qnhHpa ? " · " : null}
                {readings?.qnhHpa ? <span data-morph={mk("qnh")}>Q{readings.qnhHpa}</span> : null}
              </p>
            )}
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
                {r.lengthFt ? <span className="text-muted-foreground"> {fmtFt(r.lengthFt)}</span> : null}
              </span>
            ))}
          </Line>
        )}
        {nearby.length > 0 && (
          <Line label="Near">
            {nearby.map((a) => (
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
