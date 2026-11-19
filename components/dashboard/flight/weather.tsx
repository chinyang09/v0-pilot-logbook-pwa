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
import { TriangleAlert } from "lucide-react"
import { ageText } from "@/lib/weather/format"
import { categoryOf, hazardLine, hazardsOf, type FlightCategory, type StationBrief, type StationWindow } from "@/lib/weather/brief"
import { cn } from "@/lib/utils"
import { WidgetLabel } from "./widget"

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

const hazardText = hazardLine

export function WeatherFace({ weather, code }: { weather: WeatherState; code: (icao: string) => string }) {
  const { briefs } = weather
  const anyHazard = briefs.some((b) => b.hazards.length > 0)
  return (
    <>
      <WidgetLabel right={anyHazard ? <TriangleAlert className="h-3 w-3 text-status-warning" aria-label="Hazards forecast" /> : undefined}>
        Weather
      </WidgetLabel>
      {!weather.asked ? (
        <p className="text-xs leading-snug text-muted-foreground">{briefs.length ? "Checked nearer the duty" : "—"}</p>
      ) : weather.failed ? (
        <p className="text-xs leading-snug text-muted-foreground">Unavailable</p>
      ) : weather.loading && !weather.checkedAt ? (
        <p className="text-xs leading-snug text-muted-foreground">Checking…</p>
      ) : (
        <ul className="space-y-0.5">
          {briefs.slice(0, 3).map((b) => (
            <li key={b.station} className="flex items-baseline justify-between gap-1.5 text-xs leading-tight">
              <span className="truncate font-medium text-foreground">{code(b.station)}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                <span className={b.worst ? CATEGORY_TEXT[b.worst] : "text-muted-foreground"}>{b.worst ?? "—"}</span>
                {b.hazards[0] && (
                  <span className="ml-1 text-status-warning">{b.hazards[0].replace(/^(TEMPO|PROB\d+) /, "")}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
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
}: {
  weather: WeatherState
  code: (icao: string) => string
  clock: (ms: number) => string
  now: number
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
    return <p className="py-1 text-[13px] text-muted-foreground">{briefs.length ? "Checked within 30h of the duty" : "No duty ahead"}</p>
  }
  return (
    <div className="space-y-2.5">
      {briefs.map((b) => {
        const lit = b.taf ? b.taf.periods.map((p, i) => ({ p, i, covers: b.touchedBy.get(i) })).filter((x) => x.covers) : []
        return (
          <div key={b.station} className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[15px] font-semibold text-foreground">{code(b.station)}</span>
              {b.worst && <Chip tone={b.worst}>{b.worst}</Chip>}
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
