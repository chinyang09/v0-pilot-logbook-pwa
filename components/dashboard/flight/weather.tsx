"use client"

/**
 * The weather parts of the AIRPORT tile and card (`airport-tile.tsx`): the
 * sky in a word, the wind as a dial, and — in the card — one airport's METAR
 * and its latest TAF with every period that covers one of the duty's times
 * there LIT, and which leg it covers.
 *
 * Read by `lib/weather/brief.ts` (`briefStations`): the raw text stays the
 * record, this is the highlighting over it. Category colours are aviation's
 * own (VFR green, MVFR blue, IFR red, LIFR magenta), not the status ramp.
 */

import type * as React from "react"
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Sun, TriangleAlert } from "lucide-react"
import { ageText, cloudLayer } from "@/lib/weather/format"
import { categoryOf, hazardLine, hazardsOf, metarConditions, type FlightCategory, type StationBrief, type StationWindow } from "@/lib/weather/brief"
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
    return { Icon: Cloud, text: cloudLayer(low.cover, low.baseFt), warn: false }
  }
  if ((c.weather ?? []).some((w) => /RA|DZ|SH/.test(w))) return { Icon: CloudRain, text: "Rain", warn: false }
  if ((c.visM ?? 9999) < 5000) return { Icon: CloudFog, text: `Vis ${c.visM! >= 1000 ? `${Math.round(c.visM! / 1000)} km` : `${c.visM} m`}`, warn: false }
  if ((c.clouds ?? []).length) {
    const low = c.clouds!.reduce((m, l) => (l.baseFt < m.baseFt ? l : m))
    return { Icon: CloudSun, text: cloudLayer(low.cover, low.baseFt), warn: false }
  }
  return { Icon: Sun, text: "Clear", warn: false }
}

/**
 * The wind as a dial (the owner's station widget): a ring of dots, a wedge on
 * the rim where the wind comes FROM, its direction and speed in the middle.
 * Ink when the wind is ordinary; amber from 25kt or a gust.
 */
export function WindDial({
  dir,
  kt,
  gust,
  size = 84,
  morph,
}: {
  dir: number | null | undefined
  kt: number | undefined
  gust?: number
  size?: number
  /** The shared morph's key — the dial flies into the card's wind. */
  morph?: string
}) {
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
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden data-morph={morph}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        {Array.from({ length: 24 }, (_, i) => {
          const [x, y] = at(i * 15, r - 3)
          return <circle key={i} cx={x} cy={y} r={1.1} className="fill-muted-foreground/50" />
        })}
        {wedge && <path d={wedge} className={strong ? "fill-status-warning" : "fill-foreground/70"} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={cn("font-semibold tabular-nums text-foreground", size < 80 ? "text-[13px]" : size >= 100 ? "text-[18px]" : "text-[15px]")}>
          {kt === undefined ? "—" : kt === 0 ? "Calm" : dir === null || dir === undefined ? "VRB" : `${String(dir).padStart(3, "0")}°`}
        </span>
        {kt ? (
          <span className={cn("mt-1 font-medium tabular-nums text-foreground", size < 80 ? "text-[10px]" : size >= 100 ? "text-[13px]" : "text-[12px]")}>
            {kt}kt{gust ? <span className="text-status-warning"> G{gust}</span> : null}
          </span>
        ) : null}
      </div>
    </div>
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
 * One airport's reports, as the airport card's lower half: the hazards and the
 * worst category over the duty as chips, the METAR's raw text, and the LATEST
 * TAF whole (the owner: "doesn't have to be in reach of this duty to show the
 * latest"), the periods over the duty's times there lit with the leg they
 * cover. The METAR's wind, temperature and QNH are the half above's.
 */
export function StationWeather({ b, clock, now }: { b: StationBrief; clock: (ms: number) => string; now: number }) {
  const periods = b.taf ? b.taf.periods.map((p, i) => ({ p, i, covers: b.touchedBy.get(i) })) : []
  const anyLit = periods.some((x) => x.covers)
  const hazards = hazardLine(b.hazards).split(" · ").filter(Boolean)
  return (
    <div className="space-y-1.5">
      {(b.worst || hazards.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {b.worst && <Chip tone={b.worst}>{b.worst}</Chip>}
          {hazards.map((h) => (
            <Chip key={h} tone="warn">
              {h}
            </Chip>
          ))}
        </div>
      )}
      {b.metar ? (
        <>
          <p className={cn(SECTION, "flex items-baseline justify-between gap-2")} suppressHydrationWarning>
            <span>METAR · {clock(b.metar.at)}</span>
            <span className="font-medium normal-case tracking-normal">{ageText(b.metar.at, now)}</span>
          </p>
          <p className="break-words text-[12px] leading-snug text-foreground/80 tabular-nums">{b.metar.raw.replace(/^METAR /, "")}</p>
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">No METAR</p>
      )}
      {b.taf && (
        <p className={cn(SECTION, "pt-1")} suppressHydrationWarning>
          TAF · {clock(b.taf.from).replace(/Z$/, "")}–{clock(b.taf.to)}
          {anyLit ? " · this duty lit" : ""}
        </p>
      )}
      <div className="space-y-0.5">
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
      </div>
      {!b.taf && <p className="text-[12px] text-muted-foreground">No TAF</p>}
    </div>
  )
}

/** Where the weather stands: updating, failed, or when it was last checked. */
export function weatherStatus(weather: WeatherState, clock: (ms: number) => string): string | null {
  return weather.refreshing
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
}
