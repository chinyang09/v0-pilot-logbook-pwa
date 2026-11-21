"use client"

/**
 * The duty's weather — on the tile, each airport's worst category over the
 * duty's times there and whether anything is worth a second look; in the
 * detail, the METAR read and the TAF with every period that covers one of the
 * duty's times there LIT, and which leg it covers.
 *
 * Read by `lib/weather/brief.ts` (`briefStations`): the raw text stays the
 * record, this is the highlighting over it. Category colours are aviation's
 * own (VFR green, MVFR blue, IFR red, LIFR magenta), not the status ramp.
 */

import type * as React from "react"
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Sun, Thermometer, TriangleAlert } from "lucide-react"
import { ageText } from "@/lib/weather/format"
import { categoryOf, hazardLine, hazardsOf, metarConditions, metarReadings, type FlightCategory, type StationBrief, type StationWindow } from "@/lib/weather/brief"
import { cn } from "@/lib/utils"
import { Pager, useRememberedPage } from "./pager"

export const CATEGORY_TEXT: Record<FlightCategory, string> = {
  // Dark cockpit: VFR is the nominal state and lights nothing.
  VFR: "text-muted-foreground",
  MVFR: "text-sky-600 dark:text-sky-400",
  IFR: "text-destructive",
  LIFR: "text-fuchsia-600 dark:text-fuchsia-400",
}

export interface WeatherState {
  briefs: StationBrief[]
  /** Asked at all — the duty is close enough for a TAF to cover it. */
  asked: boolean
  loading: boolean
  refreshing: boolean
  failed: boolean
  refreshFailed: boolean
  checkedAt: number | null
  /** When the snapshot the answer came from was pulled from the source. */
  sourceAt: number | null
  stale: boolean
  refresh: () => void
}


/** The sky as one word and an icon: a hazard first, else the ceiling, else the cloud, else clear. */
export function skyOf(c: ReturnType<typeof metarConditions> | null, hazard: string | undefined) {
  if (hazard) {
    const word = hazard.replace(/^(TEMPO|PROB\d+) /, "")
    return { Icon: /TS|CB/.test(word) ? CloudLightning : TriangleAlert, text: word, warn: true }
  }
  if (!c) return null
  const ceil = (c.clouds ?? []).filter((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "VV")
  if (ceil.length) {
    const low = ceil.reduce((m, l) => (l.baseFt < m.baseFt ? l : m))
    return { Icon: Cloud, text: `${low.cover} ${low.baseFt.toLocaleString("en-US")}'`, warn: false }
  }
  if ((c.weather ?? []).some((w) => /RA|DZ|SH/.test(w))) return { Icon: CloudRain, text: "Rain", warn: false }
  if ((c.visM ?? 9999) < 5000) return { Icon: CloudFog, text: `Vis ${c.visM! >= 1000 ? `${Math.round(c.visM! / 1000)} km` : `${c.visM} m`}`, warn: false }
  if ((c.clouds ?? []).length) {
    const low = c.clouds!.reduce((m, l) => (l.baseFt < m.baseFt ? l : m))
    return { Icon: CloudSun, text: `${low.cover} ${low.baseFt.toLocaleString("en-US")}'`, warn: false }
  }
  return { Icon: Sun, text: "Clear", warn: false }
}

/**
 * The wind as a dial (the owner's station widget): a ring of dots, a wedge on
 * the rim where the wind comes FROM, its direction and speed in the middle.
 * Ink when the wind is ordinary; amber from 25kt or a gust.
 */
export function WindDial({ dir, kt, gust, size = 84 }: { dir: number | null | undefined; kt: number | undefined; gust?: number; size?: number }) {
  const c = size / 2
  const r = c - 4
  const at = (deg: number, rr: number) => {
    const rad = (deg * Math.PI) / 180
    return [c + rr * Math.sin(rad), c - rr * Math.cos(rad)] as const
  }
  const strong = (kt ?? 0) >= 25 || (gust ?? 0) > 0
  const wedge =
    dir !== null && dir !== undefined && kt
      ? (() => {
          const [ox1, oy1] = at(dir - 14, r + 1)
          const [ox2, oy2] = at(dir + 14, r + 1)
          const [ix, iy] = at(dir, r - 12)
          return `M ${ox1} ${oy1} A ${r + 1} ${r + 1} 0 0 1 ${ox2} ${oy2} L ${ix} ${iy} Z`
        })()
      : null
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        {Array.from({ length: 24 }, (_, i) => {
          const [x, y] = at(i * 15, r - 3)
          return <circle key={i} cx={x} cy={y} r={1.1} className="fill-muted-foreground/50" />
        })}
        {wedge && <path d={wedge} className={strong ? "fill-status-warning" : "fill-foreground/70"} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none" data-morph="wx-wind">
        <span className={cn("font-semibold tabular-nums text-foreground", size < 80 ? "text-[13px]" : "text-[15px]")}>
          {kt === undefined ? "—" : kt === 0 ? "Calm" : dir === null || dir === undefined ? "VRB" : `${String(dir).padStart(3, "0")}°`}
        </span>
        {kt ? (
          <span className={cn("mt-1 font-medium tabular-nums text-foreground", size < 80 ? "text-[10px]" : "text-[12px]")}>
            {kt}kt{gust ? <span className="text-status-warning"> G{gust}</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * What the TAF says over the duty's time at a station (± an hour of each
 * time there): the worst category and the first hazard — "IFR · TEMPO TS" —
 * or why there is nothing to say yet.
 */
export function tafSummary(b: StationBrief | null): { text: string; warn: boolean; muted: boolean } {
  if (!b?.taf) return { text: "No TAF", warn: false, muted: true }
  const covered = b.briefs.filter((x) => x.brief.touching.length > 0)
  if (covered.length === 0) return { text: "Not yet in reach", warn: false, muted: true }
  let worst: FlightCategory | null = null
  const hazards: string[] = []
  const rank = (c: FlightCategory | null) => (c ? ["VFR", "MVFR", "IFR", "LIFR"].indexOf(c) : -1)
  for (const { brief } of covered) {
    if (rank(brief.worst) > rank(worst)) worst = brief.worst
    for (const h of brief.hazards) if (!hazards.includes(h)) hazards.push(h)
  }
  return {
    text: [worst, hazards[0]].filter(Boolean).join(" · ") || "—",
    warn: hazards.length > 0 || worst === "IFR" || worst === "LIFR",
    muted: false,
  }
}

/**
 * The duty's airports as STATIONS, one a page (the owner, Nov 2026: "just
 * show METAR info … pagination dots and swipeable for both airports"),
 * opening on where the duty goes next: the code, the category only when it is
 * below VFR, the QNH where the category sat ("Q1011"), a wind dial and the
 * sky and temperature. No captions and no TAF on the tile — the card has the
 * TAF. A ⚠ beside the code when another airport of the duty is worse. A tile
 * two rows tall stacks it; a wide one puts the dial beside the readings.
 */
export function WeatherFace({
  weather,
  code,
  station,
  size,
  memory,
}: {
  weather: WeatherState
  code: (icao: string) => string
  clock?: (ms: number) => string
  station: string | null
  size?: { cols: number; rows: number }
  /** What the page the tile was left on is remembered under (the duty). */
  memory?: string
}) {
  const { briefs } = weather
  const start = Math.max(0, briefs.findIndex((x) => x.station === station))
  const [page, setPage] = useRememberedPage(`wx:${memory ?? ""}:${briefs.map((b) => b.station).join()}`, start, briefs.length)
  const status = weather.failed ? "Unavailable" : weather.loading && !weather.checkedAt ? "Checking…" : briefs.length === 0 ? "No report" : null
  if (status) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <span className="text-[17px] font-bold leading-tight tracking-tight text-foreground">Weather</span>
        <p className="py-5 text-center text-xs text-muted-foreground">{status}</p>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Pager count={briefs.length} page={page} onPage={setPage}>
        {(i) => <StationPage weather={weather} b={briefs[i]} code={code} size={size} lead={i === page} />}
      </Pager>
    </div>
  )
}

/** One airport as the tile has it. `lead`: the page on show — the shared morph's keys go on it only. */
function StationPage({
  weather,
  b,
  code,
  size,
  lead,
}: {
  weather: WeatherState
  b: StationBrief
  code: (icao: string) => string
  size?: { cols: number; rows: number }
  lead: boolean
}) {
  const rank = (cat: FlightCategory | null) => (cat ? ["VFR", "MVFR", "IFR", "LIFR"].indexOf(cat) : -1)
  const elsewhere = weather.briefs.some((x) => x !== b && (x.hazards.length > 0 || rank(x.worst) > rank(b.worst)))
  const c = b.metar ? metarConditions(b.metar.raw) : null
  const r = b.metar ? metarReadings(b.metar.raw) : null
  // The sky's own hazard (TS, FG…) — the wind's is on the dial.
  const sky = skyOf(c, b.metar?.hazards.find((h) => !/KT$/.test(h)))
  const wide = (size?.cols ?? 1) >= 2
  const tall = (size?.rows ?? 1) >= 2
  // Dark cockpit: VFR is not said; a category below it is, in its colour.
  const cat = b.metar?.category && b.metar.category !== "VFR" ? b.metar.category : null
  const readings = (
    <div className="min-w-0 space-y-0.5 text-[12px] tabular-nums">
      {sky && (
        <p className={cn("flex min-w-0 items-center gap-1", sky.warn ? "font-semibold text-status-warning" : "text-foreground")}>
          <sky.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{sky.text}</span>
        </p>
      )}
      {r?.tempC !== null && r?.tempC !== undefined && (
        <p className="flex items-center gap-1 text-foreground">
          <Thermometer className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {r.tempC}°{r.dewC !== null ? `/${r.dewC}°` : ""}
        </p>
      )}
    </div>
  )
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[17px] font-bold leading-tight tracking-tight text-foreground" data-morph={lead ? `wx-code-${b.station}` : undefined}>
            {code(b.station)}
          </span>
          {/* In a narrow tile the code and the QNH take the line; the category goes under them. */}
          {cat && wide && <span className={cn("shrink-0 text-[12px] font-semibold", CATEGORY_TEXT[cat])}>{cat}</span>}
          {elsewhere && wide && <TriangleAlert className="h-3 w-3 shrink-0 self-center text-status-warning" aria-label="Another airport of the duty has hazards" />}
        </span>
        {r?.qnhHpa ? (
          <span className={cn("shrink-0 font-semibold tabular-nums text-foreground", wide ? "text-[15px]" : "text-[13px]")} data-morph={lead ? `wx-qnh-${b.station}` : undefined}>
            Q{r.qnhHpa}
          </span>
        ) : null}
      </div>
      {!wide && (cat || elsewhere) && (
        <p className="flex items-center gap-1 text-[12px] font-semibold leading-tight">
          {cat && <span className={CATEGORY_TEXT[cat]}>{cat}</span>}
          {elsewhere && <TriangleAlert className="h-3 w-3 text-status-warning" aria-label="Another airport of the duty has hazards" />}
        </p>
      )}
      {!b.metar ? (
        <p className="py-5 text-center text-xs text-muted-foreground">No report</p>
      ) : wide ? (
        <div className="mt-1.5 flex items-center gap-3">
          <WindDial dir={c?.windDir} kt={c?.windKt} gust={c?.gustKt} size={tall ? 84 : 72} />
          {readings}
        </div>
      ) : (
        <>
          <div className="flex justify-center py-1.5">
            {/* The category line under the code costs the dial its height, so a phone's grid still fits. */}
            <WindDial dir={c?.windDir} kt={c?.windKt} gust={c?.gustKt} size={tall ? (cat || elsewhere ? 72 : 84) : 64} />
          </div>
          {readings}
        </>
      )}
    </div>
  )
}

/** The METAR read out: wind (gust amber), temperature, QNH — what a briefing reads off it first. */
function MetarLine({ raw, station }: { raw: string; station: string }) {
  const c = metarConditions(raw)
  const r = metarReadings(raw)
  const wind =
    c.windKt === undefined ? null : c.windKt === 0 ? "Calm" : `${c.windDir === null || c.windDir === undefined ? "VRB" : String(c.windDir).padStart(3, "0") + "°"}/${c.windKt}kt`
  const temp = r.tempC !== null ? `${r.tempC}°/${r.dewC ?? "–"}°` : null
  if (!wind && !temp && !r.qnhHpa) return null
  return (
    <p className="text-[13px] font-semibold tabular-nums text-foreground">
      <span>{wind}</span>
      {c.gustKt ? <span className="text-status-warning"> G{c.gustKt}</span> : null}
      {temp && <span className="font-normal text-muted-foreground"> · {temp}</span>}
      {r.qnhHpa ? (
        <span className="font-normal text-muted-foreground">
          {" · "}
          <span data-morph={`wx-qnh-${station}`}>Q{r.qnhHpa}</span>
        </span>
      ) : null}
    </p>
  )
}

/** A hazard as a chip — "TS", "TEMPO CB". */
function Chip({ children, tone }: { children: React.ReactNode; tone: "warn" | "muted" | FlightCategory }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums",
        tone === "warn" ? "bg-chart-4/15 text-status-warning" : tone === "muted" ? "bg-muted text-muted-foreground" : cn("bg-muted", CATEGORY_TEXT[tone]),
      )}
    >
      {children}
    </span>
  )
}

/** A part's caption in the card: "METAR · 06:30Z", "TAF · over this duty". */
const SECTION = "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"

/**
 * Each airport as the duty meets it: its category and hazards as chips, the
 * METAR, and ONLY the TAF periods that cover the duty's time there — each with
 * the leg it covers. The rest of the TAF is not the pilot's question here.
 */
export function WeatherBody({
  weather,
  code,
  clock,
  now,
  station,
}: {
  weather: WeatherState
  code: (icao: string) => string
  clock: (ms: number) => string
  now: number
  /** The airport the tile shows — its code, category and wind fly into its block here. */
  station?: string | null
}) {
  const { briefs } = weather
  const status = weather.refreshing
    ? "Updating…"
    : weather.refreshFailed
      ? "Couldn't update"
      : weather.failed
        ? "Unavailable"
        : weather.checkedAt
          ? `Checked ${clock(weather.checkedAt)}${weather.stale ? " · source down" : ""}`
          : weather.loading
            ? "Checking…"
            : null
  if (!weather.asked) {
    return <p className="py-1 text-[13px] text-muted-foreground">No duty ahead</p>
  }
  return (
    <div className="space-y-2.5">
      {briefs.map((b) => {
        // The LATEST TAF whole (the owner: "doesn't have to be in reach of
        // this duty to show the latest"), the periods over the duty's times
        // there lit with the leg they cover.
        const periods = b.taf ? b.taf.periods.map((p, i) => ({ p, i, covers: b.touchedBy.get(i) })) : []
        const anyLit = periods.some((x) => x.covers)
        return (
          <div key={b.station} className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[15px] font-semibold text-foreground" data-morph={`wx-code-${b.station}`}>
                {code(b.station)}
              </span>
              {b.worst && (
                <Chip tone={b.worst}>{b.worst}</Chip>
              )}
              {hazardLine(b.hazards)
                .split(" · ")
                .filter(Boolean)
                .map((h) => (
                  <Chip key={h} tone="warn">
                    {h}
                  </Chip>
                ))}
              {b.metar && (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground" suppressHydrationWarning>
                  {ageText(b.metar.at, now)}
                </span>
              )}
            </div>
            {b.metar && <p className={SECTION}>METAR · {clock(b.metar.at)}</p>}
            {b.metar && <MetarLine raw={b.metar.raw} station={b.station} />}
            {b.metar && <p className="break-words text-[12px] leading-snug text-muted-foreground tabular-nums">{b.metar.raw.replace(/^METAR /, "")}</p>}
            {b.taf && (
              <p className={cn(SECTION, "pt-0.5")} suppressHydrationWarning>
                TAF · {clock(b.taf.from).replace(/Z$/, "")}–{clock(b.taf.to)}
                {anyLit ? " · this duty lit" : ""}
              </p>
            )}
            {periods.map(({ p, i, covers }) => {
              const own = p.kind === "base" || p.kind === "FM" ? p.conditions : p.stated
              const cat = categoryOf(p.conditions)
              const flagged = !!covers && (hazardsOf(own).length > 0 || cat === "IFR" || cat === "LIFR")
              return (
                <div key={i} className={cn("rounded-md px-2 py-1", covers ? (flagged ? "bg-chart-4/15" : "bg-primary/10") : "")}>
                  <p className={cn("break-words text-[12px] leading-snug tabular-nums", covers ? "text-foreground" : "text-muted-foreground")}>
                    {p.text.replace(/^TAF (AMD |COR )?/, "")}
                  </p>
                  {covers && (
                    <p className={cn("text-[10px] font-semibold uppercase tracking-wide", flagged ? "text-status-warning" : "text-primary")}>
                      {covers.map((w: StationWindow) => `${w.label} ${w.role === "dep" ? "dep" : "arr"} ${clock(w.atMs)}`).join(" · ")}
                    </p>
                  )}
                </div>
              )
            })}
            {!b.taf && <p className="text-[12px] text-muted-foreground">No TAF</p>}
          </div>
        )
      })}
      {status && (
        <p className="text-[11px] text-muted-foreground" role="status" aria-live="polite" suppressHydrationWarning>
          {status}
        </p>
      )}
    </div>
  )
}
