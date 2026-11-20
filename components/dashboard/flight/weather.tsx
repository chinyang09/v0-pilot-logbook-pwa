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
        <span className="text-[15px] font-semibold tabular-nums text-foreground">
          {kt === undefined ? "—" : kt === 0 ? "Calm" : dir === null || dir === undefined ? "VRB" : `${String(dir).padStart(3, "0")}°`}
        </span>
        {kt ? (
          <span className="mt-1 text-[12px] font-medium tabular-nums text-foreground">
            {kt}kt{gust ? <span className="text-status-warning"> G{gust}</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The weather tile — ONE airport, the one the duty is going to next (the
 * owner's station widget, Nov 2026): its code and category, the wind as a
 * dial, the sky (a hazard over the duty's time there first) and the
 * temperature. Any OTHER airport of the duty with a hazard or a worse category
 * shows as the warning beside the category; the card lists them all.
 */
export function WeatherFace({ weather, code, station }: { weather: WeatherState; code: (icao: string) => string; station: string | null }) {
  const { briefs } = weather
  const b = briefs.find((x) => x.station === station) ?? briefs[0] ?? null
  const rank = (cat: FlightCategory | null) => (cat ? ["VFR", "MVFR", "IFR", "LIFR"].indexOf(cat) : -1)
  const elsewhere = briefs.some((x) => x !== b && (x.hazards.length > 0 || rank(x.worst) > rank(b?.worst ?? null)))
  const c = b?.metar ? metarConditions(b.metar.raw) : null
  const r = b?.metar ? metarReadings(b.metar.raw) : null
  const sky = skyOf(c, b?.hazards[0])
  const status = weather.failed ? "Unavailable" : weather.loading && !weather.checkedAt ? "Checking…" : !b?.metar ? "No report" : null
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground" data-morph="wx-code">
          {b ? code(b.station) : "Weather"}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold">
          {elsewhere && <TriangleAlert className="h-3 w-3 text-status-warning" aria-label="Another airport of the duty has hazards" />}
          {b?.worst && (
            <span className={CATEGORY_TEXT[b.worst]} data-morph="wx-cat">
              {b.worst}
            </span>
          )}
        </span>
      </div>
      {status ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{status}</p>
      ) : (
        <div className="flex justify-center py-1">
          <WindDial dir={c?.windDir} kt={c?.windKt} gust={c?.gustKt} />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[12px] tabular-nums">
        {sky ? (
          <span className={cn("flex min-w-0 items-center gap-1", sky.warn ? "font-semibold text-status-warning" : "text-foreground")}>
            <sky.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{sky.text}</span>
          </span>
        ) : (
          <span />
        )}
        {r?.tempC !== null && r?.tempC !== undefined && (
          <span className="flex shrink-0 items-center gap-0.5 text-foreground">
            <Thermometer className="h-3.5 w-3.5" aria-hidden />
            {r.tempC}°{r.dewC !== null ? `/${r.dewC}°` : ""}
          </span>
        )}
      </div>
    </>
  )
}

/** The METAR read out: wind (gust amber), temperature, QNH — what a briefing reads off it first. */
function MetarLine({ raw, morph }: { raw: string; morph?: boolean }) {
  const c = metarConditions(raw)
  const r = metarReadings(raw)
  const wind =
    c.windKt === undefined ? null : c.windKt === 0 ? "Calm" : `${c.windDir === null || c.windDir === undefined ? "VRB" : String(c.windDir).padStart(3, "0") + "°"}/${c.windKt}kt`
  const parts = [r.tempC !== null ? `${r.tempC}°/${r.dewC ?? "–"}°` : null, r.qnhHpa ? `Q${r.qnhHpa}` : null].filter(Boolean)
  if (!wind && parts.length === 0) return null
  return (
    <p className="text-[13px] font-semibold tabular-nums text-foreground">
      <span data-morph={morph ? "wx-wind" : undefined}>{wind}</span>
      {c.gustKt ? <span className="text-status-warning"> G{c.gustKt}</span> : null}
      {parts.length > 0 && <span className="font-normal text-muted-foreground"> · {parts.join(" · ")}</span>}
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
        const lit = b.taf ? b.taf.periods.map((p, i) => ({ p, i, covers: b.touchedBy.get(i) })).filter((x) => x.covers) : []
        return (
          <div key={b.station} className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[15px] font-semibold text-foreground" data-morph={b.station === station ? "wx-code" : undefined}>
                {code(b.station)}
              </span>
              {b.worst && (
                <span data-morph={b.station === station ? "wx-cat" : undefined}>
                  <Chip tone={b.worst}>{b.worst}</Chip>
                </span>
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
            {b.metar && <MetarLine raw={b.metar.raw} morph={b.station === station} />}
            {b.metar && <p className="break-words text-[12px] leading-snug text-muted-foreground tabular-nums">{b.metar.raw.replace(/^METAR /, "")}</p>}
            {lit.map(({ p, i, covers }) => {
              const own = p.kind === "base" || p.kind === "FM" ? p.conditions : p.stated
              const cat = categoryOf(p.conditions)
              const flagged = hazardsOf(own).length > 0 || cat === "IFR" || cat === "LIFR"
              return (
                <div key={i} className={cn("rounded-md px-2 py-1", flagged ? "bg-chart-4/15" : "bg-primary/10")}>
                  <p className="break-words text-[12px] leading-snug text-foreground tabular-nums">{p.text.replace(/^TAF (AMD |COR )?/, "")}</p>
                  <p className={cn("text-[10px] font-semibold uppercase tracking-wide", flagged ? "text-status-warning" : "text-primary")}>
                    {covers!.map((w: StationWindow) => `${w.label} ${w.role === "dep" ? "dep" : "arr"} ${clock(w.atMs)}`).join(" · ")}
                  </p>
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
