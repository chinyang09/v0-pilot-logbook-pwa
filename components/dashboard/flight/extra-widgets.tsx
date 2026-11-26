"use client"

/**
 * The tiles a pilot ADDS to the Flight Deck (the owner, Nov 2026: "the ability
 * to add and remove widget … we need more relevant widgets"). Each is about the
 * duty the timeline has chosen, as every tile is, and keeps to the deck's
 * rules: one truncated line per fact, dark cockpit (colour only for a reason),
 * the card the tile lifted with a table under it.
 *
 * | Tile | Glance | Card |
 * |---|---|---|
 * | Sun & Night | each leg's take-off and landing by day or night and its night time; the next sunrise or sunset where the duty goes | each leg's row; the sun at every airport of the duty |
 * | Days Off | which date of the run since the last day off (of seven); the next day off; the days off in 14 and 28 days | the same as rows, and para 5's findings near the duty |
 * | Briefing | each leg's OFP in a line — cruise, trip, block fuel, alternate | each leg's table — and its briefing a tap away |
 * | Logbook | the duty's month: block, sectors, landings, night; what is still to log | the same as rows; each sector not logged opens its flight |
 */

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDutyClock } from "@/lib/utils/dashboard/duty-status"
import { formatDay } from "@/lib/utils/date"
import { tonnes, type LegSun } from "@/lib/utils/dashboard/deck-widgets"
import { CardTable, type CardRow } from "./faces"
import { WidgetLabel } from "./widget"
import type { FlightBrief } from "./model"

const digits = (flight: string) => flight.replace(/^[A-Z]{2,3}\s*/i, "") || flight

/** Day or night at an end of a leg: the sun or the moon, the take-off or the landing beside it. */
function Phase({ phase, end }: { phase: "day" | "night" | null; end: "↑" | "↓" }) {
  if (!phase) return <span className="text-muted-foreground">✈{end} —</span>
  const Icon = phase === "night" ? Moon : Sun
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${end === "↑" ? "Take-off" : "Landing"} by ${phase}`}>
      <span className="text-muted-foreground">✈{end}</span>
      <Icon className={cn("h-3 w-3", phase === "night" ? "text-foreground" : "text-muted-foreground")} aria-hidden />
    </span>
  )
}

/* ── Sun & Night ─────────────────────────────────────────────────────────── */

export function SunFace({ brief }: { brief: FlightBrief }) {
  const sun = brief.extras.sun
  const next = sun?.places[sun.places.length - 1]?.events[0] ?? null
  const place = sun?.places[sun.places.length - 1]
  return (
    <>
      <WidgetLabel title>Sun & Night</WidgetLabel>
      {!sun || sun.legs.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No legs on this duty</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5">
          {sun.legs.slice(0, 3).map((l) => (
            <li key={l.id} className="flex min-w-0 items-center justify-between gap-1.5 text-[11px] leading-none tabular-nums">
              <span className="w-8 shrink-0 font-semibold text-foreground">{digits(l.flight)}</span>
              <Phase phase={l.takeoff} end="↑" />
              <Phase phase={l.landing} end="↓" />
              <span className="ml-auto shrink-0 text-muted-foreground">{l.nightMinutes !== null ? `${formatDutyClock(l.nightMinutes)} N` : "—"}</span>
            </li>
          ))}
        </ul>
      )}
      {next && place && (
        <p className="mt-auto truncate pt-1 text-[11px] text-muted-foreground" suppressHydrationWarning>
          {brief.code(place.icao)} {next.kind === "sunrise" ? "sunrise" : "sunset"} <span className="font-semibold text-foreground">{brief.clock(next.atMs)}</span>
        </p>
      )}
    </>
  )
}

function legRow(brief: FlightBrief, l: LegSun): CardRow {
  const word = (p: "day" | "night" | null) => (p === null ? "—" : p === "night" ? "Night" : "Day")
  return {
    label: l.flight || "Leg",
    value: `${word(l.takeoff)} ↑ · ${word(l.landing)} ↓`,
    sub:
      l.nightMinutes !== null && l.blockMinutes !== null
        ? `${formatDutyClock(l.nightMinutes)} of ${formatDutyClock(l.blockMinutes)} at night`
        : "No position for an end",
  }
}

export function SunBody({ brief }: { brief: FlightBrief }) {
  const sun = brief.extras.sun
  if (!sun || sun.legs.length === 0) return <p className="py-1 text-[13px] text-muted-foreground">No legs on this duty</p>
  return (
    <div className="space-y-3">
      <CardTable rows={sun.legs.map((l) => legRow(brief, l))} />
      {sun.places.map((p) => (
        <div key={p.icao}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sun at {brief.code(p.icao)}</p>
          <CardTable
            rows={p.events.map((e) => ({
              label: e.kind === "sunrise" ? "Sunrise" : "Sunset",
              value: brief.clock(e.atMs),
              sub: brief.day(e.atMs),
            }))}
          />
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">Night as the logbook counts it: the sun 6° below the horizon.</p>
    </div>
  )
}

/* ── Days Off ────────────────────────────────────────────────────────────── */

/** The worst finding near the duty, as the tile's edge. */
export function daysOffTone(brief: FlightBrief): "fail" | "caution" | null {
  const d = brief.extras.daysOff
  if (!d) return null
  if (d.findings.some((f) => f.severity === "violation")) return "fail"
  if (d.findings.length || (d.runDay !== null && d.runDay >= 7)) return "caution"
  return null
}

export function DaysOffFace({ brief }: { brief: FlightBrief }) {
  const d = brief.extras.daysOff
  const tone = daysOffTone(brief)
  const lit = tone === "fail" ? "text-destructive" : tone === "caution" ? "text-status-warning" : "text-foreground"
  return (
    <>
      <WidgetLabel title>Days Off</WidgetLabel>
      {!d ? (
        <p className="text-[12px] text-muted-foreground">No duty chosen</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-1">
          <p className="flex items-baseline gap-1.5">
            <span className={cn("text-[22px] font-semibold leading-none tabular-nums", lit)}>{d.runDay !== null ? `Day ${d.runDay}` : "—"}</span>
            {d.runDay !== null && <span className="text-[11px] text-muted-foreground">of 7</span>}
          </p>
          <p className="truncate text-[11px] text-muted-foreground" suppressHydrationWarning>
            Next off <span className="font-semibold text-foreground">{d.nextOff ? brief.day(d.nextOff.startMs) : "none rostered"}</span>
          </p>
          <p className="truncate text-[11px] tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{d.in14}</span> in 14d · <span className="font-semibold text-foreground">{d.in28}</span> in 28d
          </p>
          {d.findings[0] && <p className={cn("truncate text-[11px] font-semibold", lit)}>{d.findings[0].label}</p>}
        </div>
      )}
    </>
  )
}

export function DaysOffBody({ brief }: { brief: FlightBrief }) {
  const d = brief.extras.daysOff
  if (!d) return <p className="py-1 text-[13px] text-muted-foreground">No duty chosen</p>
  const span = (a: number, b: number) => `${brief.day(a)} – ${brief.day(b - 1)}`
  const rows: CardRow[] = [
    { label: "This Duty", value: d.runDay !== null ? `Day ${d.runDay} of 7` : "—", sub: "SGT dates since the last day off · para 5(4)(a)", tone: d.runDay !== null && d.runDay > 7 ? "fail" : d.runDay === 7 ? "caution" : undefined },
    { label: "Last Day Off", value: d.lastOff ? brief.day(d.lastOff.startMs) : "—", sub: d.lastOff ? span(d.lastOff.startMs, d.lastOff.endMs) : undefined },
    { label: "Next Day Off", value: d.nextOff ? brief.day(d.nextOff.startMs) : "None rostered", sub: d.nextOff ? span(d.nextOff.startMs, d.nextOff.endMs) : undefined },
    { label: "In 14 Days", value: `${d.in14}`, sub: "At least 2 · para 5(4)(b)", tone: d.in14 < 2 ? "caution" : undefined },
    { label: "In 28 Days", value: `${d.in28}`, sub: "At least 8 · para 5(4)(c)", tone: d.in28 < 8 ? "caution" : undefined },
  ]
  return (
    <div className="space-y-2">
      <CardTable rows={rows} />
      {d.findings.length > 0 && (
        <ul className="border-t border-border/70 pt-2">
          {d.findings.map((f) => (
            <li key={`${f.rule}-${f.atMs}`} className={cn("flex justify-between gap-3 py-1 text-[13px]", f.severity === "violation" ? "text-destructive" : "text-status-warning")}>
              <span className="min-w-0">{f.label}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">Para {f.rule}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">A day off is 34 hours free of duty with a local night; each next one 24 hours. Counted only between rostered duties.</p>
    </div>
  )
}

/* ── Briefing ────────────────────────────────────────────────────────────── */

export function briefingTone(brief: FlightBrief): "caution" | null {
  return brief.extras.ofp.some((o) => o?.towTight) ? "caution" : null
}

export function BriefingFace({ brief }: { brief: FlightBrief }) {
  const legs = brief.duty.legs
  return (
    <>
      <WidgetLabel title>Briefing</WidgetLabel>
      {legs.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No legs on this duty</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5">
          {legs.slice(0, 3).map((l, i) => {
            const o = brief.extras.ofp[i]
            return (
              <li key={l.id} className="flex min-w-0 items-baseline gap-2 text-[11px] leading-tight tabular-nums">
                <span className="w-8 shrink-0 font-semibold text-foreground">{digits(l.flightNumber || "")}</span>
                {o ? (
                  <span className="min-w-0 truncate text-muted-foreground">
                    <span className="text-foreground">{o.cruise ?? "—"}</span> · {o.tripTime || "—"} · <span className="text-foreground">{tonnes(o.blockKg)}</span>
                    {o.alternate && <> · {brief.code(o.alternate)}</>}
                    {o.towTight && <span className="font-semibold text-status-warning"> · TOW</span>}
                  </span>
                ) : (
                  <span className="truncate text-muted-foreground">No briefing</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function BriefingBody({ brief, open }: { brief: FlightBrief; open: (i: number) => void }) {
  const legs = brief.duty.legs
  if (legs.length === 0) return <p className="py-1 text-[13px] text-muted-foreground">No legs on this duty</p>
  return (
    <div className="space-y-3">
      {legs.map((l, i) => {
        const o = brief.extras.ofp[i]
        return (
          <div key={l.id}>
            <button type="button" onClick={() => open(i)} className="flex w-full items-baseline justify-between gap-2 text-left">
              <span className="text-[15px] font-semibold text-foreground">
                {l.flightNumber} <span className="font-normal text-muted-foreground">{brief.code(l.departureIcao)}–{brief.code(l.arrivalIcao)}</span>
              </span>
              <span className="shrink-0 text-[13px] font-medium text-primary">{o ? "Open ›" : "Import ›"}</span>
            </button>
            {o ? (
              <CardTable
                rows={[
                  { label: "Cruise", value: o.cruise ?? "—" },
                  { label: "Trip", value: `${o.tripTime || "—"} · ${tonnes(o.tripKg)}` },
                  { label: "Block Fuel", value: tonnes(o.blockKg) },
                  { label: "Alternate", value: o.alternate ? brief.code(o.alternate) : "—" },
                  {
                    label: "TOW",
                    value: `${tonnes(o.tow.planned)} / ${tonnes(o.tow.max)}`,
                    sub: "Planned / max",
                    tone: o.towTight ? "caution" : undefined,
                  },
                  { label: "NOTAMs", value: String(o.notams) },
                ]}
              />
            ) : (
              <p className="py-1 text-[13px] text-muted-foreground">No briefing imported for this leg</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Logbook ─────────────────────────────────────────────────────────────── */

const monthName = (ym: string) => formatDay(`${ym}-15`, { weekday: false, year: false }).replace(/^\d+\s*/, "")

export function logbookTone(brief: FlightBrief): "caution" | null {
  return brief.extras.logbook.unlogged.length ? "caution" : null
}

export function LogbookFace({ brief }: { brief: FlightBrief }) {
  const m = brief.extras.logbook
  return (
    <>
      <WidgetLabel title>
        Logbook
        <span className="font-medium normal-case tracking-normal"> · {monthName(m.month)}</span>
      </WidgetLabel>
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-1">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-semibold leading-none tabular-nums text-foreground">{formatDutyClock(m.blockMinutes)}</span>
          <span className="text-[11px] text-muted-foreground">block</span>
        </p>
        <p className="truncate text-[11px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{m.sectors}</span> sectors · <span className="font-semibold text-foreground">{m.landings}</span> ldg
          {m.nightMinutes > 0 && <> · {formatDutyClock(m.nightMinutes)} N</>}
        </p>
        {m.unlogged.length > 0 ? (
          <p className="truncate text-[11px] font-semibold text-status-warning">{m.unlogged.length} not logged</p>
        ) : (
          <p className="truncate text-[11px] text-muted-foreground">{m.rostered ? `${m.rostered} still rostered` : " "}</p>
        )}
      </div>
    </>
  )
}

export function LogbookBody({ brief, openFlight }: { brief: FlightBrief; openFlight: (id: string) => void }) {
  const m = brief.extras.logbook
  return (
    <div className="space-y-2">
      <CardTable
        rows={[
          { label: "Block", value: formatDutyClock(m.blockMinutes), sub: monthName(m.month) },
          { label: "Sectors", value: String(m.sectors) },
          { label: "Landings", value: String(m.landings) },
          { label: "Night", value: formatDutyClock(m.nightMinutes) },
          { label: "Still Rostered", value: String(m.rostered) },
        ]}
      />
      {m.unlogged.length > 0 && (
        <div className="border-t border-border/70 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-status-warning">Not Logged</p>
          <ul>
            {m.unlogged.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => openFlight(u.id)} className="flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-[13px]">
                  <span className="font-semibold text-foreground">{u.flight || "Flight"}</span>
                  <span className="text-muted-foreground">{formatDay(u.date, { year: false })} ›</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
