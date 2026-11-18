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

import { CloudSun, RefreshCw, TriangleAlert } from "lucide-react"
import { FormSection } from "@/components/ui/form-section"
import { ageText } from "@/lib/weather/format"
import { categoryOf, hazardLine, hazardsOf, type FlightCategory, type StationBrief, type StationWindow } from "@/lib/weather/brief"
import { cn } from "@/lib/utils"
import { WidgetLabel } from "./widget"

export const CATEGORY_TEXT: Record<FlightCategory, string> = {
  VFR: "text-chart-2",
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

export function WeatherDetail({
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
    ? "Getting the latest…"
    : weather.refreshFailed
      ? `Couldn't refresh — showing what was checked at ${weather.checkedAt ? clock(weather.checkedAt) : "—"}`
      : weather.failed
        ? "Weather unavailable — check your connection and try again."
        : weather.checkedAt
          ? `Checked ${clock(weather.checkedAt)}${weather.sourceAt ? ` · reports as of ${ageText(weather.sourceAt, now)}` : ""}${weather.stale ? " · the source did not answer" : ""}`
          : weather.loading
            ? "Checking…"
            : "Not checked yet"

  return (
    <>
      <div className="flex items-center gap-2 px-1">
        <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground" role="status" aria-live="polite" suppressHydrationWarning>
          {status}
        </p>
        <button
          type="button"
          onClick={weather.refresh}
          disabled={weather.refreshing}
          className="control-surface flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", weather.refreshing && "animate-spin")} aria-hidden />
          Refresh
        </button>
      </div>

      {briefs.length === 0 && (
        <FormSection>
          <p className="px-4 py-3.5 text-sm text-muted-foreground">No duty ahead to check the weather for.</p>
        </FormSection>
      )}

      {briefs.map((b) => (
        <FormSection key={b.station} title={[code(b.station), b.worst].filter(Boolean).join(" · ")}>
          {/* When the duty is there, and what that time brings. */}
          {b.windows.length > 0 && (
            <div className="row-divider relative space-y-1 px-4 py-3">
              {b.windows.map((w, i) => {
                const brief = b.briefs.find((x) => x.window === w)?.brief
                return (
                  <p key={i} className="flex items-baseline gap-2 text-[13px] leading-snug">
                    <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                      {w.role === "dep" ? "Dep" : "Arr"} {clock(w.atMs)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-muted-foreground">{w.label}</span>
                      {brief?.worst && <span className={cn("ml-1.5 font-semibold", CATEGORY_TEXT[brief.worst])}>{brief.worst}</span>}
                      {brief && brief.hazards.length > 0 && (
                        <span className="ml-1.5 font-semibold text-status-warning">{hazardText(brief.hazards)}</span>
                      )}
                      {!brief && <span className="ml-1.5 text-muted-foreground">{b.taf ? "outside the TAF" : "no TAF"}</span>}
                    </span>
                  </p>
                )
              })}
            </div>
          )}

          {b.metar ? (
            <div className="row-divider relative space-y-1 px-4 py-3">
              <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                <span className="font-semibold uppercase tracking-wide">METAR</span>
                <span>
                  {clock(b.metar.at)} · {ageText(b.metar.at, now)}
                  {b.metar.category && <span className={cn("ml-1.5 font-semibold", CATEGORY_TEXT[b.metar.category])}>{b.metar.category}</span>}
                </span>
              </p>
              <p className="break-words text-[13px] leading-snug text-foreground tabular-nums">{b.metar.raw}</p>
              {b.metar.hazards.length > 0 && <p className="text-xs font-semibold text-status-warning">{hazardText(b.metar.hazards)}</p>}
            </div>
          ) : (
            <p className="row-divider relative px-4 py-3 text-xs text-muted-foreground">No METAR</p>
          )}

          {b.taf ? (
            <div className="relative space-y-0.5 px-2 py-2">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">TAF</p>
              {b.taf.periods.map((p, i) => {
                const covers = b.touchedBy.get(i)
                const own = p.kind === "base" || p.kind === "FM" ? p.conditions : p.stated
                const cat = categoryOf(p.conditions)
                const flagged = !!covers && (hazardsOf(own).length > 0 || cat === "IFR" || cat === "LIFR")
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg px-2 py-1 text-[13px] leading-snug tabular-nums",
                      i > 0 && "pl-5",
                      covers ? (flagged ? "bg-chart-4/15 text-foreground" : "bg-primary/10 text-foreground") : "text-muted-foreground",
                    )}
                  >
                    <p className="break-words">{p.text}</p>
                    {covers && (
                      <p className={cn("mt-0.5 text-[11px] font-semibold", flagged ? "text-status-warning" : "text-primary")}>
                        {covers.map((w: StationWindow) => `${w.label} ${w.role === "dep" ? "dep" : "arr"}`).join(", ")}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="px-4 py-3 text-xs text-muted-foreground">No TAF</p>
          )}
        </FormSection>
      ))}
      <p className="flex items-center gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        <CloudSun className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Lit: the TAF periods within an hour of the duty&apos;s time at that airport — actual off-blocks plus the planned block once a leg has left.
      </p>
    </>
  )
}
