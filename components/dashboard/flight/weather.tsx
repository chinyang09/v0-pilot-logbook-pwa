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
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, PlaneLanding, PlaneTakeoff, Sun } from "lucide-react"
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


/** Cloud above this is no concern on the approach, and the tile does not name it. */
export const LOW_CLOUD_FT = 3500

/**
 * The sky as one word and an icon, as it matters on the approach: a hazard
 * first; else CAVOK, said as the METAR says it (the owner, Nov 2026); else the
 * lowest ceiling (BKN / OVC / VV) at or below `LOW_CLOUD_FT` (3,500ft — the
 * owner's revision); else the lowest layer there; else poor visibility; else
 * rain. Cloud higher up says nothing on the approach (the owner: "at 30000,
 * it is not of concern"), so a sky with only that is null — dark cockpit:
 * nothing to say.
 */
export function skyOf(c: ReturnType<typeof metarConditions> | null, hazard: string | undefined) {
  if (hazard) {
    const word = hazard.replace(/^(TEMPO|PROB\d+) /, "")
    // The weather's own picture, never an alert icon: the colour says it is a hazard.
    const Icon = /TS|CB/.test(word) ? CloudLightning : /FG|BR|HZ|FU|DU|SA|VA/.test(word) ? CloudFog : /SN|PL|GR|GS|FZ/.test(word) ? CloudSnow : /RA|DZ|SH/.test(word) ? CloudRain : Cloud
    return { Icon, text: word, warn: true }
  }
  if (!c) return null
  if (c.cavok) return { Icon: Sun, text: "CAVOK", warn: false }
  const low = (c.clouds ?? []).filter((l) => l.baseFt <= LOW_CLOUD_FT)
  const lowest = (ls: typeof low) => ls.reduce((m, l) => (l.baseFt < m.baseFt ? l : m))
  const ceil = low.filter((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "VV")
  if (ceil.length) {
    const l = lowest(ceil)
    return { Icon: Cloud, text: cloudLayer(l.cover, l.baseFt) + l.type, warn: false }
  }
  if (low.length) {
    const l = lowest(low)
    return { Icon: CloudSun, text: cloudLayer(l.cover, l.baseFt) + l.type, warn: false }
  }
  if ((c.visM ?? 9999) < 5000) return { Icon: CloudFog, text: `Vis ${c.visM! >= 1000 ? `${Math.round(c.visM! / 1000)} km` : `${c.visM} m`}`, warn: false }
  if ((c.weather ?? []).some((w) => /RA|DZ|SH/.test(w))) return { Icon: CloudRain, text: "Rain", warn: false }
  return null
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

/** A leg as its tag reads it: "TR275" → "275" (the airline is the pilot's own). */
const shortLeg = (label: string) => label.replace(/^[A-Z]{2,3}(?=\d)/, "")

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
        </p>
      )}
      <div className="space-y-0.5">
        {periods.map(({ p, i, covers }) => {
          const own = p.kind === "base" || p.kind === "FM" ? p.conditions : p.stated
          const cat = categoryOf(p.conditions)
          const flagged = !!covers && (hazardsOf(own).length > 0 || cat === "IFR" || cat === "LIFR")
          return (
            // No indent (the owner, Nov 2026): a lit period's wash reaches past
            // the text, the text stays in line with the METAR's.
            <div
              key={i}
              className={cn("-mx-2 flex items-start gap-2 rounded-md px-2 py-0.5", covers ? (flagged ? "bg-chart-4/15" : "bg-primary/10") : "")}
            >
              <p className={cn("min-w-0 flex-1 break-words text-[12px] leading-snug tabular-nums", covers ? "text-foreground" : "text-muted-foreground")}>
                {p.text.replace(/^TAF (AMD |COR )?/, "")}
              </p>
              {/* The legs it covers, as a TAG beside it — the departure or
                  arrival's glyph and the flight's digits (the owner, Nov 2026:
                  "TR275 DEP 02:35Z" under every lit period cluttered the card). */}
              {covers && (
                <span className={cn("flex shrink-0 flex-col items-end gap-0.5 pt-px", flagged ? "text-status-warning" : "text-primary")}>
                  {covers.map((w: StationWindow) => {
                    const Glyph = w.role === "dep" ? PlaneTakeoff : PlaneLanding
                    return (
                      <span
                        key={`${w.label}-${w.role}`}
                        className="flex items-center gap-0.5 text-[10px] font-semibold leading-none tabular-nums"
                        aria-label={`${w.label} ${w.role === "dep" ? "departure" : "arrival"} ${clock(w.atMs)}`}
                      >
                        <Glyph className="h-3 w-3" aria-hidden />
                        {shortLeg(w.label)}
                      </span>
                    )
                  })}
                </span>
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
