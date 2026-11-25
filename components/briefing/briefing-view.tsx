"use client"

/**
 * A flight's BRIEFING in sections, read the way the pilot prepares the
 * aeroplane — DIFSRIP, the Airbus MCDU order (DATA, INIT A, F-PLN, SEC F-PLN,
 * RAD NAV, INIT B, PERF) — then the NOTAMs, INTAMs, the airports and their
 * LIVE weather. The page lists the sections (`BRIEFING_SECTIONS`) and each
 * opens in the detail panel, as a Settings section does (the owner, Nov 2026:
 * "scrolling of the briefing should be like the other pages").
 *
 * | section | from | the pilot |
 * |---|---|---|
 * | INIT A, INIT B | the OFP as the MCDU's own pages (`mcdu.ts`); INIT B's fuel and its breakdown, folded | keys it |
 * | F-PLN | the route with its nav log folded under it; procedures (OFP · sector info), FIR · WP · freq | writes sector info and frequencies, per ROUTE |
 * | Alternates | runway, approach, minima, distance, time, fuel, route — and what the TAF brings over the time it could be needed (`alternateConcerns`) | reads |
 * | PERF | the weights against their maxima, OptiClimb | reads |
 * | NOTAMs | the bulletin by section → airport → category, a row each, its words reflowed and its keywords marked (`notam-text.ts`) | flags |
 * | Airports | each airport's runways and the company and community notes per AIRPORT | writes notes |
 * | Weather | live METAR / TAF (`useAirportWeather`) with the flight's times lit | reads |
 */

import * as React from "react"
import { Bookmark, ChevronDown, Plus, RefreshCw, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEFAULT_HOME_BASE } from "@/lib/utils/roster/days-off"
import { formatDay } from "@/lib/utils/date"
import { formatInstant } from "@/lib/utils/tz-format"
import { FormSection } from "@/components/ui/form-section"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { ReadingPanel } from "@/components/ui/detail-form-panel"
import { NoteText } from "./note-text"
import { firCrossings } from "@/lib/briefing/journal"
import { hhmm, initA, initB, tonnes, type McduPage } from "@/lib/briefing/mcdu"
import { groupNotams, notamCounts, type NotamGroup, type NotamView } from "@/lib/briefing/notams"
import { highlightSpans, notamBody, notamTitle, reflowLines, type TextBlock } from "@/lib/briefing/notam-text"
import { alternateConcerns, type AlternateConcern } from "@/lib/briefing/alternate-wx"
import { routeRef } from "@/lib/briefing/ids"
import { stationsOf, type Briefing, type BriefingStation } from "@/lib/briefing/types"
import { saveBriefingNote, setNotamFlag } from "@/lib/db"
import { refreshBriefingCaches, useBriefingNote, useNotamRegister } from "@/hooks/data/use-briefings"
import { useAirportInfo } from "@/hooks/use-airport-info"
import { useAirportByIcao } from "@/hooks/data"
import { useAirportWeather } from "@/hooks/use-airport-weather"
import { briefStations, metarReadings, stationWindows, WINDOW_MS, type StationWindow } from "@/lib/weather/brief"
import { StationWeather } from "@/components/dashboard/flight/weather"
import { usePreferences } from "@/components/providers/preferences-provider"
import { formatRunwayLength } from "@/lib/utils/runway-length"
import type { BriefingNoteRecord, BriefingRecord, FrequencyNote, ProcedureRow } from "@/types/entities/briefing.types"

/* ── the sections ────────────────────────────────────────────────────────── */

export type BriefingSectionKey = "init-a" | "fpln" | "sec" | "init-b" | "perf" | "notams" | "intams" | "airports" | "weather"

export interface BriefingSectionDef {
  key: BriefingSectionKey
  /** The DIFSRIP letter, for the MCDU's own pages. */
  letter?: string
  label: string
  title: string
}

export const BRIEFING_SECTIONS: BriefingSectionDef[] = [
  { key: "init-a", letter: "I", label: "Init A", title: "INIT A" },
  { key: "fpln", letter: "F", label: "F-PLN", title: "Flight Plan" },
  { key: "sec", letter: "S", label: "Alternates", title: "Alternates" },
  { key: "init-b", letter: "I", label: "Init B", title: "INIT B · Fuel Pred" },
  { key: "perf", letter: "P", label: "Perf", title: "Performance" },
  { key: "notams", label: "NOTAMs", title: "NOTAMs" },
  { key: "intams", label: "INTAMs", title: "INTAMs" },
  { key: "airports", label: "Airports", title: "Airports" },
  { key: "weather", label: "Weather", title: "Weather" },
]

/* ── shared pieces ───────────────────────────────────────────────────────── */

const kg = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-GB"))

/** A disclosure that needs no measuring: a grid row going 0fr → 1fr. */
function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

function FoldButton({ open, onClick, children, className }: { open: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={cn("flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-[13px] text-muted-foreground", className)}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
    </button>
  )
}

/** Label over value, a hairline row of them. */
function Fig({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-2">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="truncate text-[15px] font-semibold leading-tight tabular-nums text-foreground">{value}</p>
      {sub ? <p className="truncate text-[11px] leading-tight tabular-nums text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row-divider flex min-h-11 items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-[14px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[14px] tabular-nums text-foreground">{children}</span>
    </div>
  )
}

/* ── the MCDU screen ─────────────────────────────────────────────────────── */

/**
 * One MCDU page, drawn as the screen draws it: six rows of a small label over
 * a large value, left and right of the line select keys. Always the dark
 * screen — it is a picture of the instrument, in either theme. Keyed values
 * are in the screen's cyan (pilot-entered data); a reference (time zone,
 * distance, the live ground temperature) in its green (computed); what the
 * OFP cannot give in the screen's dashes. A slot whose neighbour is empty
 * takes the whole row, as a long entry does on the screen.
 */
export function McduScreen({ page }: { page: McduPage }) {
  return (
    <div className="mx-auto max-w-[26rem] rounded-2xl bg-[#101318] px-3 pb-3 pt-2.5 shadow-inner ring-1 ring-black/40" role="group" aria-label={`MCDU ${page.title}`}>
      <p className="pb-1 text-center text-[15px] font-medium tracking-[0.2em] text-white/90">{page.title}</p>
      <div className="grid grid-cols-2 gap-x-3">
        {page.rows.map(([l, r], i) => (
          <React.Fragment key={i}>
            {l && r ? (
              <>
                <McduSlot slot={l} side="left" />
                <McduSlot slot={r} side="right" />
              </>
            ) : l ? (
              <McduSlot slot={l} side="left" wide />
            ) : r ? (
              <>
                <div />
                <McduSlot slot={r} side="right" />
              </>
            ) : (
              <div className="col-span-2 min-h-[46px]" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function McduSlot({ slot, side, wide = false }: { slot: NonNullable<McduPage["rows"][number][number]>; side: "left" | "right"; wide?: boolean }) {
  return (
    <div className={cn("min-h-[46px] min-w-0 py-0.5", side === "right" && "text-right", wide && "col-span-2")}>
      <p className="truncate text-[11px] font-medium tracking-[0.14em] text-white/85">{slot.label}</p>
      <p
        data-selectable
        className={cn(
          "truncate text-[19px] font-medium leading-tight tracking-[0.06em] tabular-nums",
          slot.ref ? "text-emerald-300/90" : "text-cyan-300",
        )}
      >
        {slot.value}
        {slot.rest ? <span className="text-white/45">{slot.rest}</span> : null}
      </p>
    </div>
  )
}

/* ── weather: live, for the flight's airports ────────────────────────────── */

/** The flight's departure and arrival instants, from the OFP's schedule. */
function flightTimes(b: Briefing): { depMs: number | null; arrMs: number | null } {
  const at = (hm: string, dayOffset = 0) => {
    const m = hm.match(/^(\d{2}):(\d{2})$/)
    if (!m || !b.flight.date) return null
    return Date.parse(`${b.flight.date}T${m[1]}:${m[2]}:00Z`) + dayOffset * 86_400_000
  }
  const depMs = at(b.route.schedDep)
  let arrMs = at(b.route.schedArr)
  if (depMs !== null && arrMs !== null && arrMs < depMs) arrMs += 86_400_000
  return { depMs, arrMs }
}

/**
 * Live METAR and TAF for every airport the briefing names — departure,
 * destination, alternates, en route — read over the flight's times there
 * (± an hour; an alternate at the arrival plus its diversion). The PDF's own
 * reports are not kept: these are newer (the owner, Nov 2026).
 */
export function useBriefingWeather(b: Briefing) {
  const stations = React.useMemo(() => stationsOf(b), [b])
  const ids = React.useMemo(() => {
    const out = [b.flight.dep, b.flight.arr, ...b.alternates.map((a) => a.icao), ...stations.map((s) => s.icao)]
    return [...new Set(out.filter(Boolean))].slice(0, 24)
  }, [b, stations])
  const wx = useAirportWeather(ids, true)
  const windows = React.useMemo(() => {
    const { depMs, arrMs } = flightTimes(b)
    const out: StationWindow[] = stationWindows([
      { label: b.flight.number, departureIcao: b.flight.dep, arrivalIcao: b.flight.arr, departMs: depMs, arriveMs: arrMs },
    ])
    if (arrMs !== null)
      for (const a of b.alternates) {
        const div = a.time?.match(/^(\d+):(\d{2})$/)
        const atMs = arrMs + (div ? (Number(div[1]) * 60 + Number(div[2])) * 60_000 : 0)
        out.push({ station: a.icao, role: "arr", label: "ALTN", atMs, fromMs: atMs - WINDOW_MS, toMs: atMs + WINDOW_MS })
      }
    return out
  }, [b])
  const briefs = React.useMemo(() => briefStations(ids, windows, wx.weather), [ids, windows, wx.weather])
  return { ids, briefs, ...wx }
}

/* ── INIT A / INIT B ─────────────────────────────────────────────────────── */

function InitASection({ b }: { b: Briefing }) {
  const wx = useBriefingWeather(b)
  return <McduScreen page={initA(b, groundTempOf(b, wx.briefs))} />
}

/** The departure's temperature off its live METAR — GND TEMP, to check against the ATIS. */
export function groundTempOf(b: Briefing, briefs: ReturnType<typeof useBriefingWeather>["briefs"]): number | null {
  const raw = briefs.find((s) => s.station === b.flight.dep)?.metar?.raw
  return raw ? metarReadings(raw).tempC : null
}

/**
 * The fuel as a table — kilograms in one column, time in the next, so the
 * figures tabulate (the owner, Nov 2026) — folded under the screen until
 * asked for: the screen already says what is keyed.
 */
function FuelTable({ b }: { b: Briefing }) {
  const f = b.fuel
  const [open, setOpen] = React.useState(false)
  const rows: { label: string; kg: number | null | undefined; time?: string | null; strong?: boolean }[] = [
    { label: "Trip", kg: f.trip.kg, time: f.trip.time },
    { label: `Route Reserve${f.contingencyPct !== null ? ` ${f.contingencyPct}%` : ""}`, kg: f.contingency.kg, time: f.contingency.time },
    { label: "Alternate", kg: f.alternate.kg, time: f.alternate.time },
    { label: "Final Reserve", kg: f.finalReserve.kg, time: f.finalReserve.time },
    { label: "Additional", kg: f.additional.kg, time: f.additional.time },
    { label: "60 Min Top-Up", kg: f.topup60.kg, time: f.topup60.time },
    { label: "Extra", kg: f.extra.kg ?? 0, time: f.extra.time },
    { label: "Taxi", kg: f.taxi.kg },
    { label: "Block", kg: f.inTanks.kg, time: f.inTanks.time, strong: true },
    { label: "Min Diversion", kg: f.mdf },
  ]
  const adjustments = [
    ...(f.burnPerTonneZfw !== null ? [{ label: "ZFW +1t", value: `+${f.burnPerTonneZfw}` }] : []),
    ...(f.burn2000Below !== null ? [{ label: "2,000ft Below", value: `+${f.burn2000Below}` }] : []),
    ...f.additionalReasons.filter((r) => r.kg).map((r) => ({ label: r.reason, value: kg(r.kg) })),
  ]
  return (
    <FormSection>
      <FoldButton open={open} onClick={() => setOpen((o) => !o)}>
        Fuel · Block {kg(f.inTanks.kg)} kg
      </FoldButton>
      <Fold open={open}>
        {open && (
          <div className="border-t border-border/70 pb-1 text-[14px] tabular-nums">
            <div className="grid grid-cols-[minmax(0,1fr)_5rem_3.5rem] gap-x-3 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <span />
              <span className="text-right">kg</span>
              <span className="text-right">Time</span>
            </div>
            {rows.map((r) => (
              <div key={r.label} className={cn("grid grid-cols-[minmax(0,1fr)_5rem_3.5rem] gap-x-3 px-4 py-1.5", r.strong && "font-semibold")}>
                <span className={cn("truncate", !r.strong && "text-muted-foreground")}>{r.label}</span>
                <span className="text-right text-foreground">{kg(r.kg)}</span>
                <span className="text-right text-muted-foreground">{r.time ? hhmm(r.time) : ""}</span>
              </div>
            ))}
            {adjustments.length > 0 && (
              <div className="mt-1 border-t border-border/70 pt-1">
                {adjustments.map((a) => (
                  <div key={a.label} className="grid grid-cols-[minmax(0,1fr)_5rem_3.5rem] gap-x-3 px-4 py-1.5">
                    <span className="truncate text-muted-foreground">{a.label}</span>
                    <span className="text-right text-foreground">{a.value}</span>
                    <span />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Fold>
    </FormSection>
  )
}

function InitBSection({ b }: { b: Briefing }) {
  return (
    <div className="space-y-3">
      <McduScreen page={initB(b)} />
      <FuelTable b={b} />
    </div>
  )
}

/* ── F-PLN: route with its nav log, procedures, frequencies (per route) ──── */

const PROC_ROWS: { row: ProcedureRow; label: string }[] = [
  { row: "taxiOut", label: "Taxi" },
  { row: "sid", label: "SID" },
  { row: "star", label: "STAR" },
  { row: "app", label: "APP" },
  { row: "taxiIn", label: "Taxi" },
]

function Procedures({ b, note, route }: { b: Briefing; note: BriefingNoteRecord | null | undefined; route: string }) {
  const prompt: Record<ProcedureRow, string> = {
    taxiOut: b.route.depRunway ? `${b.flight.dep} RWY ${b.route.depRunway}` : "",
    sid: b.sid ? `${b.sid.name} · RWY ${b.sid.runway}` : "",
    star: b.star ? `${b.star.name} · RWY ${b.star.runway}` : "",
    app: b.route.arrRunway ? `RWY ${b.route.arrRunway}` : "",
    taxiIn: b.route.arrRunway ? `${b.flight.arr} RWY ${b.route.arrRunway}` : "",
  }
  const save = (row: ProcedureRow, side: "plan" | "sector", text: string) => {
    const procs = { ...(note?.procedures ?? {}) }
    procs[row] = { plan: procs[row]?.plan ?? "", sector: procs[row]?.sector ?? "", [side]: text }
    void saveBriefingNote("route", route, { procedures: procs }).then(refreshBriefingCaches)
  }
  return (
    <FormSection title={`Procedures · ${route.replace("-", "–")}`}>
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1fr)] border-b border-border/70 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span className="px-3 py-1.5" />
        <span className="border-l border-border/70 px-3 py-1.5">OFP</span>
        <span className="border-l border-border/70 px-3 py-1.5">Sector Info</span>
      </div>
      {PROC_ROWS.map(({ row, label }) => (
        <div key={row} className="grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1fr)] border-b border-border/70 last:border-b-0">
          <span className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
          <div className="min-h-11 border-l border-border/70 px-3 py-2">
            <NoteText label={`${label} — OFP`} value={note?.procedures?.[row]?.plan ?? ""} placeholder={prompt[row]} onCommit={(t) => save(row, "plan", t)} />
          </div>
          <div className="min-h-11 border-l border-border/70 px-3 py-2">
            <NoteText label={`${label} — sector info`} value={note?.procedures?.[row]?.sector ?? ""} placeholder="From colleagues" onCommit={(t) => save(row, "sector", t)} />
          </div>
        </div>
      ))}
    </FormSection>
  )
}

function Frequencies({ b, note, route }: { b: Briefing; note: BriefingNoteRecord | null | undefined; route: string }) {
  const suggested = React.useMemo(() => firCrossings(b), [b])
  const rows: FrequencyNote[] = note?.frequencies?.length ? note.frequencies : suggested
  const fromOfp = !note?.frequencies?.length
  const save = (next: FrequencyNote[]) => void saveBriefingNote("route", route, { frequencies: next }).then(refreshBriefingCaches)
  const edit = (i: number, field: keyof FrequencyNote, text: string) => save(rows.map((r, k) => (k === i ? { ...r, [field]: text.trim().toUpperCase() } : r)))
  return (
    <FormSection title="FIR · WP · Freq">
      {fromOfp && rows.length > 0 && (
        <p className="border-b border-border/70 px-4 py-2 text-[12px] text-muted-foreground">The route&apos;s FIR boundaries, off the nav log — add the frequencies.</p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_2.75rem] items-center border-b border-border/70 last:border-b-0">
          <div className="px-3 py-2">
            <NoteText single label="FIR" value={r.fir} placeholder="FIR" onCommit={(t) => edit(i, "fir", t)} className={cn(fromOfp && "text-muted-foreground")} />
          </div>
          <div className="border-l border-border/70 px-3 py-2">
            <NoteText single label="Waypoint" value={r.wp} placeholder="WP" onCommit={(t) => edit(i, "wp", t)} />
          </div>
          <div className="border-l border-border/70 px-3 py-2">
            <NoteText single label="Frequency" value={r.freq} placeholder="Freq" onCommit={(t) => edit(i, "freq", t)} />
          </div>
          <button type="button" aria-label={`Remove ${r.fir || "row"}`} onClick={() => save(rows.filter((_, k) => k !== i))} className="flex h-11 w-11 items-center justify-center text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => save([...rows, { fir: "", wp: "", freq: "" }])} className="flex min-h-11 w-full items-center gap-2 px-4 text-[14px] text-primary">
        <Plus className="h-4 w-4" /> Add Row
      </button>
    </FormSection>
  )
}


/** The nav log, folded under the route it is the detail of. */
function NavLog({ b }: { b: Briefing }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="border-t border-border/70">
      <FoldButton open={open} onClick={() => setOpen((s) => !s)}>
        Nav Log · {b.navlog.length} points
      </FoldButton>
      <Fold open={open}>
        {open && (
          <div className="px-4 pb-2">
            <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3.5rem_3.5rem] gap-x-2 border-b border-border/70 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <span>Point</span>
              <span className="text-right">Time</span>
              <span className="text-right">FL</span>
              <span className="text-right">To Go</span>
              <span className="text-right">Fuel t</span>
            </div>
            {b.navlog.map((p, i) => (
              <div key={i} className={cn("grid grid-cols-[minmax(0,1fr)_3rem_3rem_3.5rem_3.5rem] gap-x-2 py-1 text-[12px] tabular-nums", p.fir ? "text-muted-foreground" : "text-foreground")}>
                <span className="truncate">{p.fir ? `FIR ${p.fir}` : p.name}</span>
                <span className="text-right">
                  {Math.floor(p.elapsedMin / 60)}:{String(p.elapsedMin % 60).padStart(2, "0")}
                </span>
                <span className="text-right">{p.level || "—"}</span>
                <span className="text-right">{p.toGoNm ?? "—"}</span>
                <span className="text-right">{tonnes(p.fuelRemainingKg)}</span>
              </div>
            ))}
          </div>
        )}
      </Fold>
    </div>
  )
}

function FplnSection({ b }: { b: Briefing }) {
  const route = routeRef(b.flight.dep, b.flight.arr)
  const note = useBriefingNote("route", route)
  return (
    <div className="space-y-3">
      <FormSection title="Route">
        <p data-selectable className="px-4 pt-3 text-[14px] font-medium leading-snug text-foreground">
          {b.route.text}
        </p>
        <div className="grid grid-cols-2 divide-x divide-border/70">
          <Fig label="Distance" value={b.route.groundNm !== null ? `${b.route.groundNm}nm` : "—"} sub={b.route.airNm !== null ? `${b.route.airNm}nm air` : undefined} />
          <Fig label="Trip Time" value={b.route.tripTime || "—"} sub={`${b.route.schedDep}–${b.route.schedArr}Z`} />
        </div>
        <NavLog b={b} />
      </FormSection>
      <Procedures b={b} note={note} route={route} />
      <Frequencies b={b} note={note} route={route} />
    </div>
  )
}

/* ── Alternates ──────────────────────────────────────────────────────────── */

/**
 * What each alternate's TAF brings over the time the flight could need it —
 * the arrival plus its diversion, ± an hour (`useBriefingWeather`'s window).
 */
export function useAlternateConcerns(b: Briefing, wx: ReturnType<typeof useBriefingWeather>): Map<string, AlternateConcern[] | null> {
  return React.useMemo(() => {
    const out = new Map<string, AlternateConcern[] | null>()
    for (const a of b.alternates) {
      const brief = wx.briefs.find((s) => s.station === a.icao)
      const w = brief?.windows.find((x) => x.label === "ALTN") ?? brief?.windows[0]
      out.set(a.icao, brief?.taf && w ? alternateConcerns(brief.taf, w.fromMs, w.toMs, a.minima) : null)
    }
    return out
  }, [b, wx.briefs])
}

/** The worst of the alternates' concerns, for the section's line on the page. */
export function concernTone(concerns: Map<string, AlternateConcern[] | null>): "unsuitable" | "caution" | null {
  let tone: "unsuitable" | "caution" | null = null
  for (const list of concerns.values())
    for (const c of list ?? []) {
      if (c.severity === "unsuitable") return "unsuitable"
      tone = "caution"
    }
  return tone
}

function ConcernLine({ c, clock }: { c: AlternateConcern; clock: (ms: number) => string }) {
  return (
    <p className={cn("text-[13px] font-medium tabular-nums", c.severity === "unsuitable" ? "text-destructive" : "text-status-warning")}>
      {[c.tag, ...c.words].filter(Boolean).join(" ")}
      <span className="font-normal text-muted-foreground">
        {" "}
        · {clock(c.fromMs)}–{clock(c.toMs)}
        {c.severity === "unsuitable" ? " · below minima" : ""}
      </span>
    </p>
  )
}

function SecSection({ b }: { b: Briefing }) {
  const wx = useBriefingWeather(b)
  const concerns = useAlternateConcerns(b, wx)
  const { preferences } = usePreferences()
  const clock = React.useCallback((ms: number) => formatInstant(ms, { ...preferences.display, useZuluTime: true }), [preferences.display])
  if (b.alternates.length === 0) return <p className="px-1 text-[14px] text-muted-foreground">The OFP names no alternate.</p>
  return (
    <FormSection>
      {b.alternates.map((a) => {
        const list = concerns.get(a.icao)
        return (
          <div key={a.icao} className="row-divider px-4 py-3">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] tabular-nums">
              <span className="font-semibold text-foreground">
                {a.icao}/{a.runway}
              </span>
              <span className="text-foreground">{a.approach}</span>
              <span className="text-muted-foreground">{a.minima}</span>
            </p>
            <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
              {[a.distNm !== null ? `${a.distNm}nm` : "", a.time ?? "", a.fuelKg !== null ? `${kg(a.fuelKg)}kg` : ""].filter(Boolean).join(" • ")}
            </p>
            {a.route && (
              <p data-selectable className="mt-0.5 text-[13px] leading-snug text-foreground/80">
                {a.route}
              </p>
            )}
            <div className="mt-1.5 space-y-0.5">
              {list === undefined || (list === null && wx.loading) ? (
                <p className="text-[12px] text-muted-foreground">Getting the TAF…</p>
              ) : list === null ? (
                <p className="text-[12px] text-muted-foreground">No TAF</p>
              ) : list.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Nothing in the TAF for this flight&apos;s times</p>
              ) : (
                list.map((c, i) => <ConcernLine key={i} c={c} clock={clock} />)
              )}
            </div>
          </div>
        )
      })}
    </FormSection>
  )
}

/* ── PERF ────────────────────────────────────────────────────────────────── */

function PerfSection({ b }: { b: Briefing }) {
  const w = b.weights
  return (
    <div className="space-y-3">
      <FormSection title="Weights · kg">
        <div className="grid grid-cols-3 divide-x divide-border/70">
          <Fig label="Max ZFW" value={kg(w.zfw.max)} sub={`Plan ${kg(w.zfw.planned)}`} />
          <Fig label="Max TOW" value={kg(w.tow.max)} sub={`Plan ${kg(w.tow.planned)}`} />
          <Fig label="Max LW" value={kg(w.lw.max)} sub={`Plan ${kg(w.lw.planned)}`} />
        </div>
      </FormSection>
      {b.optiClimb && (
        <FormSection title="OptiClimb">
          {b.optiClimb.steps.map((s, i) => (
            <Line key={i} label={i === 0 ? "VERT REV" : `At FL${b.optiClimb!.steps[i - 1].fl}`}>
              IAS {s.ias} <span className="text-muted-foreground">to</span> FL{s.fl}
            </Line>
          ))}
          {b.optiClimb.maxTowKg !== null && <Line label="Use up to TOW">{kg(b.optiClimb.maxTowKg)}</Line>}
        </FormSection>
      )}
    </div>
  )
}

/* ── NOTAMs and INTAMs: words reflowed, keywords marked ──────────────────── */

const validity = (n: NotamView["notam"]) => {
  if (n.toMs === null) return n.toText === "UFN" ? "UFN" : "PERM"
  const d = new Date(n.toMs)
  return `to ${formatDay(d.toISOString().slice(0, 10), { weekday: false })} ${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`
}

/** A line with its facilities in bold and what closes them in the caution colour. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {highlightSpans(text).map((s, i) =>
        s.tone === "status" ? (
          <strong key={i} className="font-semibold text-status-warning">
            {s.text}
          </strong>
        ) : s.tone === "facility" ? (
          <strong key={i} className="font-semibold text-foreground">
            {s.text}
          </strong>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ),
      )}
    </>
  )
}

/** Reflowed blocks: paragraphs, items hung on their marker, headings, rules. */
function Blocks({ blocks }: { blocks: TextBlock[] }) {
  return (
    <div data-selectable className="space-y-1.5 text-[13px] leading-snug text-foreground/85">
      {blocks.map((bl, i) =>
        bl.kind === "rule" ? (
          <hr key={i} className="border-border/70" />
        ) : bl.kind === "heading" ? (
          <p key={i} className="pt-1 text-[12px] font-semibold text-foreground">
            <Marked text={bl.text} />
          </p>
        ) : bl.kind === "item" ? (
          <ItemLine key={i} text={bl.text} />
        ) : (
          <p key={i}>
            <Marked text={bl.text} />
          </p>
        ),
      )}
    </div>
  )
}

/** "- TEXT", "A) TEXT", "2.1 TEXT": the marker in a gutter so the lines under it align. */
function ItemLine({ text }: { text: string }) {
  const m = text.match(/^(\S+)\s+([\s\S]*)$/) ?? text.match(/^(\d+\.)([\s\S]*)$/)
  if (!m) return <p><Marked text={text} /></p>
  const marker = m[1] === "-" || m[1] === "*" ? "•" : m[1]
  return (
    <p className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <span className="min-w-3 tabular-nums text-muted-foreground">{marker}</span>
      <span>
        <Marked text={m[2]} />
      </span>
    </p>
  )
}

/**
 * One NOTAM as an ACCORDION row (the owner, Nov 2026: "ID or header or
 * title, with validity shown when collapsed, then expanded for fine
 * details"). The bookmark is its own target beside the row, never inside it;
 * a NOTAM whose title is all of it does not expand.
 */
function NotamRow({ v }: { v: NotamView }) {
  const [open, setOpen] = React.useState(false)
  const n = v.notam
  const flagged = v.status === "flagged"
  const body = React.useMemo(() => notamBody(n), [n])
  const more = body.length > 0 || v.ids.length > 1 || !!n.limits
  return (
    <div className={cn("relative border-b border-border/60 last:border-b-0", v.status === "new" && "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary")}>
      <div className="flex items-stretch">
        <button
          type="button"
          aria-pressed={flagged}
          aria-label={flagged ? `Unflag ${v.ids[0]}` : `Flag ${v.ids[0]}`}
          onClick={() => void setNotamFlag(n.key, !flagged).then(refreshBriefingCaches)}
          className="flex w-11 shrink-0 items-start justify-center pt-3"
        >
          <Bookmark className={cn("h-[18px] w-[18px]", flagged ? "fill-status-warning text-status-warning" : "text-muted-foreground/60")} />
        </button>
        <button
          type="button"
          aria-expanded={more ? open : undefined}
          disabled={!more}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 min-w-0 flex-1 items-start gap-2 py-2.5 pr-3 text-left disabled:cursor-default"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{v.ids[0]}</span>
              {v.status === "new" && <span className="font-semibold uppercase tracking-[0.08em] text-primary">New</span>}
              <span>{validity(n)}</span>
              {n.schedule && <span className="truncate">· {n.schedule}</span>}
            </span>
            <span className={cn("mt-0.5 block text-[13px] leading-snug text-foreground", !open && "line-clamp-2")}>
              <Marked text={notamTitle(n)} />
            </span>
          </span>
          {more && <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden />}
        </button>
      </div>
      {more && (
        <Fold open={open}>
          {open && (
            <div className="space-y-1.5 pb-3 pl-11 pr-4">
              {(v.ids.length > 1 || n.limits) && (
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {[v.ids.length > 1 ? `Also ${v.ids.slice(1).join(" · ")}` : "", n.limits].filter(Boolean).join(" · ")}
                </p>
              )}
              <Blocks blocks={body} />
            </div>
          )}
        </Fold>
      )}
    </div>
  )
}

/** Rows grouped under their category ("RUNWAY", "APPROACH PROCEDURE"…), in the bulletin's order. */
function ByCategory({ views }: { views: NotamView[] }) {
  const cats: { cat: string; views: NotamView[] }[] = []
  for (const v of views) {
    const c = v.notam.category
    const g = cats.find((x) => x.cat === c) ?? cats[cats.push({ cat: c, views: [] }) - 1]
    g.views.push(v)
  }
  return (
    <>
      {cats.map((c) => (
        <div key={c.cat || "-"}>
          {c.cat && <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{c.cat.toLowerCase()}</p>}
          {c.views.map((v) => (
            <NotamRow key={v.key} v={v} />
          ))}
        </div>
      ))}
    </>
  )
}

function NotamLocation({ g, mode }: { g: NotamGroup; mode: "review" | "flagged" }) {
  const [showKnown, setShowKnown] = React.useState(false)
  const shown = mode === "flagged" ? g.flagged : [...g.flagged, ...g.fresh]
  const known = mode === "flagged" ? [] : g.known
  if (shown.length === 0 && known.length === 0) return null
  return (
    <div className="border-b border-border last:border-b-0">
      <p className="truncate px-4 pb-0.5 pt-2.5 text-[14px] font-semibold text-foreground">
        {g.location}
        {g.locationName ? <span className="font-normal text-muted-foreground"> · {g.locationName}</span> : null}
      </p>
      <ByCategory views={shown} />
      {known.length > 0 && (
        <>
          <FoldButton open={showKnown} onClick={() => setShowKnown((s) => !s)} className="pl-11">
            {known.length} seen before
          </FoldButton>
          <Fold open={showKnown}>{showKnown && <ByCategory views={known} />}</Fold>
        </>
      )}
    </div>
  )
}

/** A `====` section of the bulletin — Departure Airport, Destination Alternate(s), an area — with its airports. */
function NotamSectionBlock({ section, groups, mode }: { section: string; groups: NotamGroup[]; mode: "review" | "flagged" }) {
  const c = notamCounts(groups)
  const active = mode === "flagged" ? c.flagged > 0 : c.flagged + c.new > 0
  const [open, setOpen] = React.useState(active)
  if (mode === "flagged" && c.flagged === 0) return null
  return (
    <FormSection>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 w-full items-center gap-2 px-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{section}</span>
          <span className="block truncate text-[12px] tabular-nums text-muted-foreground">
            {groups.map((g) => g.location).join(" • ")}
            {c.flagged > 0 && <span className="text-status-warning"> · {c.flagged} flagged</span>}
            {c.new > 0 && <span className="text-primary"> · {c.new} new</span>}
            {c.known > 0 && <span> · {c.known} seen</span>}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <Fold open={open}>
        {open && (
          <div className="border-t border-border/70">
            {groups.map((g) => (
              <NotamLocation key={g.location} g={g} mode={mode} />
            ))}
          </div>
        )}
      </Fold>
    </FormSection>
  )
}

function NotamsSection({ record }: { record: BriefingRecord }) {
  const register = useNotamRegister()
  const b = record.data!
  const groups = React.useMemo(() => groupNotams(b.notams.items, register, record.id), [b, register, record.id])
  const sections = React.useMemo(() => {
    const out: { section: string; groups: NotamGroup[] }[] = []
    for (const g of groups) {
      const s = out.find((x) => x.section === g.section) ?? out[out.push({ section: g.section, groups: [] }) - 1]
      s.groups.push(g)
    }
    return out
  }, [groups])
  const counts = notamCounts(groups)
  const [mode, setMode] = React.useState<"review" | "flagged">("review")
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[12px] tabular-nums text-muted-foreground">
          <span className={cn(counts.flagged && "font-semibold text-status-warning")}>{counts.flagged} flagged</span> ·{" "}
          <span className={cn(counts.new && "font-semibold text-primary")}>{counts.new} new</span> · {counts.known} seen
        </p>
        <SegmentedTabs
          tabs={[
            { value: "review", label: "Review" },
            { value: "flagged", label: "Flagged", count: counts.flagged },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === "flagged" && counts.flagged === 0 ? (
        <p className="px-1 text-[13px] text-muted-foreground">
          Nothing flagged yet. A flagged NOTAM stays flagged on every briefing that carries it — through a re-issue — until it lapses.
        </p>
      ) : (
        sections.map((s) => <NotamSectionBlock key={`${mode}:${s.section}`} section={s.section} groups={s.groups} mode={mode} />)
      )}
    </div>
  )
}

function IntamsSection({ b }: { b: Briefing }) {
  const [open, setOpen] = React.useState<string | null>(null)
  if (b.intams.length === 0) return <p className="px-1 text-[14px] text-muted-foreground">No INTAMs in this package.</p>
  return (
    <FormSection>
      {b.intams.map((i) => (
        <div key={i.id} className="border-b border-border/70 last:border-b-0">
          <button type="button" aria-expanded={open === i.id} onClick={() => setOpen((o) => (o === i.id ? null : i.id))} className="flex min-h-12 w-full items-start gap-3 px-4 py-2.5 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold tabular-nums text-muted-foreground">{i.id}</span>
              <span className={cn("block text-[14px] leading-snug text-foreground", open !== i.id && "line-clamp-2")}>{i.title}</span>
            </span>
            <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open === i.id && "rotate-180")} />
          </button>
          <Fold open={open === i.id}>
            {open === i.id && (
              <div className="space-y-1.5 px-4 pb-3">
                <Blocks blocks={reflowLines(i.body.split("\n"))} />
                {i.auth ? <p className="text-[11px] text-muted-foreground">Auth: {i.auth}</p> : null}
              </div>
            )}
          </Fold>
        </div>
      ))}
    </FormSection>
  )
}

/* ── the airports: who they are and what pilots say ──────────────────────── */

const ROLE_NAME = { departure: "Departure", destination: "Destination", alternate: "Alternate", enroute: "En Route" } as const

/**
 * What the Airports section needs: the flight's two ends, and — where a
 * briefing is imported — the alternates its OFP plans and the airports its
 * WX list names. The notes are the pilot's own (`note:airport:<ICAO>`), so
 * a flight with NO briefing has the section too, from its ends alone (the
 * owner, Nov 2026: "to be made available even without briefing upload").
 */
export interface FlightAirports {
  dep: string
  arr: string
  alternates: Briefing["alternates"]
  stations: BriefingStation[]
}

export const airportsOfBriefing = (b: Briefing): FlightAirports => ({ dep: b.flight.dep, arr: b.flight.arr, alternates: b.alternates, stations: stationsOf(b) })

/** The departure, destination and alternates once each, then what the WX list adds en route. */
export function briefingAirports(a: FlightAirports): { main: BriefingStation[]; enroute: BriefingStation[] } {
  const all = a.stations
  const named = (icao: string, role: BriefingStation["role"]): BriefingStation => all.find((s) => s.icao === icao) ?? { icao, iata: "", name: "", role }
  // An airport once — the departure is often the first alternate too.
  const main = [named(a.dep, "departure"), named(a.arr, "destination"), ...a.alternates.map((x) => named(x.icao, "alternate"))].filter(
    (s, i, xs) => !!s.icao && xs.findIndex((x) => x.icao === s.icao) === i,
  )
  return { main, enroute: all.filter((s) => !main.some((m) => m.icao === s.icao)) }
}

function AirportHeader({ station }: { station: BriefingStation }) {
  // The airport database's name, as everywhere (see `AirportRow`).
  const name = useAirportByIcao(station.icao)?.name || station.name
  return (
    <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
      <p className="min-w-0 truncate text-[15px] font-semibold text-foreground">
        {station.icao}
        {name ? <span className="font-normal text-muted-foreground"> · {name}</span> : null}
      </p>
      <p className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{ROLE_NAME[station.role]}</p>
    </div>
  )
}

function NoteRow({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder: string; onCommit: (t: string) => void }) {
  return (
    <div className="row-divider px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <NoteText label={label} value={value} placeholder={placeholder} onCommit={onCommit} />
    </div>
  )
}

/**
 * One airport as a ROW of its group (the owner, Nov 2026: "group alternates
 * together, group en route together"): its code and name, what it is to this
 * flight on the right, and a line under them — the runways with their lengths
 * (feet or metres, as Settings › Display says), and for an alternate the
 * OFP's runway, approach and distance. A tap unfolds the company's and the
 * community's notes in place.
 */
function AirportRow({
  station,
  info,
  sub,
  defaultOpen,
  role = true,
}: {
  station: BriefingStation
  info: ReturnType<typeof useAirportInfo>[string] | undefined
  /** What the OFP says about it (an alternate's runway, approach, distance). */
  sub?: string
  defaultOpen: boolean
  /** Say its role on the right (a group already named by role does not). */
  role?: boolean
}) {
  const note = useBriefingNote("airport", station.icao)
  const save = (patch: Partial<Pick<BriefingNoteRecord, "company" | "community">>) => void saveBriefingNote("airport", station.icao, patch).then(refreshBriefingCaches)
  const unit = usePreferences().preferences?.display?.runwayLength
  const runways = (info?.runways ?? []).map((r) => [r.id, formatRunwayLength(r.lengthFt ?? 0, unit)].filter(Boolean).join(" ")).join(" • ")
  const [open, setOpen] = React.useState(defaultOpen)
  const noted = !!(note?.company?.trim() || note?.community?.trim())
  // ONE name for an airport everywhere (the owner, Nov 2026: the Flight Deck
  // said "Ho Chi Minh City" where the airport database says "Tan Son
  // Nhat…"): the airport database's, else the WX list's, else the source's.
  const db = useAirportByIcao(station.icao)
  const name = db?.name || station.name || info?.name || ""
  return (
    <div className="row-divider">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-12 w-full items-start gap-2 px-4 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-foreground">
            {station.icao}
            {name ? <span className="font-normal text-muted-foreground"> · {name}</span> : null}
          </span>
          {/* What the OFP plans (an alternate's runway, approach, distance), then its runways. */}
          {sub && <span className="mt-0.5 block truncate text-[12px] leading-snug tabular-nums text-foreground">{sub}</span>}
          {runways && <span className="mt-0.5 block text-[12px] leading-snug tabular-nums text-muted-foreground">{runways}</span>}
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
          {(role || (!open && noted)) && (
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {[role ? ROLE_NAME[station.role] : null, !open && noted ? "Notes" : null].filter(Boolean).join(" • ")}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </span>
      </button>
      <Fold open={open}>
        {open && (
          <div className="border-t border-border/70">
            <NoteRow label="Company" value={note?.company ?? ""} placeholder="The company's airport briefing, summarised" onCommit={(t) => save({ company: t })} />
            <NoteRow label="Community" value={note?.community ?? ""} placeholder="What other pilots say to look out for" onCommit={(t) => save({ community: t })} />
          </div>
        )}
      </Fold>
    </div>
  )
}

/**
 * The airport this leg is ABOUT — the one away from home base (the owner,
 * Nov 2026: on WSSS–VVTS–WSSS, VVTS for both legs): the destination on the
 * way out, the departure on the way back; the destination when both or
 * neither end is home.
 */
export function outstationOf(dep: string, arr: string): string {
  const home = (icao: string) => DEFAULT_HOME_BASE.includes(icao.toUpperCase())
  if (arr && !home(arr)) return arr
  if (dep && !home(dep)) return dep
  return arr || dep
}

/**
 * The airports in three groups, each one card of rows (the owner, Nov 2026:
 * grouped, and the grouped layout was "terrible"): the FLIGHT — the
 * outstation first and open, then home base; the ALTERNATES the OFP plans,
 * each with its runway, approach and distance; and EN ROUTE, what the WX list
 * adds. Every row unfolds its notes in place.
 */
export function AirportsSection({ airports }: { airports: FlightAirports }) {
  const { main, enroute } = briefingAirports(airports)
  const info = useAirportInfo([...main, ...enroute].map((s) => s.icao), true)
  const lead = outstationOf(airports.dep, airports.arr)
  const flight = main.filter((s) => s.role !== "alternate")
  const alternates = main.filter((s) => s.role === "alternate")
  // The outstation leads; home base after it.
  const ordered = [...flight.filter((s) => s.icao === lead), ...flight.filter((s) => s.icao !== lead)]
  const altSub = (icao: string) => {
    const a = airports.alternates.find((x) => x.icao === icao)
    if (!a) return undefined
    return [a.runway && `RWY ${a.runway}`, a.approach, a.distNm != null && `${a.distNm}nm`].filter(Boolean).join(" · ") || undefined
  }
  return (
    <div className="space-y-3">
      <FormSection title="Flight">
        {ordered.map((s) => (
          <AirportRow key={s.icao} station={s} info={info[s.icao]} defaultOpen={s.icao === lead} />
        ))}
      </FormSection>
      {alternates.length > 0 && (
        <FormSection title="Alternates">
          {alternates.map((s) => (
            <AirportRow key={s.icao} station={s} info={info[s.icao]} sub={altSub(s.icao)} defaultOpen={false} role={false} />
          ))}
        </FormSection>
      )}
      {enroute.length > 0 && (
        <FormSection title="En Route">
          {enroute.map((s) => (
            <AirportRow key={s.icao} station={s} info={info[s.icao]} defaultOpen={false} role={false} />
          ))}
        </FormSection>
      )}
    </div>
  )
}

/* ── the weather: live, for every airport of the flight ──────────────────── */

function WeatherSection({ b }: { b: Briefing }) {
  const wx = useBriefingWeather(b)
  const { preferences } = usePreferences()
  const clock = React.useCallback((ms: number) => formatInstant(ms, { ...preferences.display, useZuluTime: true }), [preferences.display])
  const [showEnroute, setShowEnroute] = React.useState(false)
  // The reports' ages are read against when the section opened.
  const [now] = React.useState(Date.now)
  const { main, enroute } = briefingAirports(airportsOfBriefing(b))
  const block = (s: BriefingStation) => {
    const brief = wx.briefs.find((x) => x.station === s.icao)
    return (
      <FormSection key={s.icao}>
        <AirportHeader station={s} />
        <div className="px-4 pb-3">
          {brief ? <StationWeather b={brief} clock={clock} now={now} /> : <p className="text-[12px] text-muted-foreground">{wx.loading ? "Getting the weather…" : "No weather"}</p>}
        </div>
      </FormSection>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[12px] text-muted-foreground">{wx.refreshing ? "Getting the latest…" : wx.failed ? "Weather unavailable" : "The flight's times lit"}</p>
        <button type="button" onClick={wx.refresh} className="control-surface flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px]" aria-label="Refresh weather">
          <RefreshCw className={cn("h-3.5 w-3.5", wx.refreshing && "animate-spin")} /> Refresh
        </button>
      </div>
      {main.map(block)}
      {enroute.length > 0 && (
        <FormSection>
          <FoldButton open={showEnroute} onClick={() => setShowEnroute((o) => !o)}>
            En route · {enroute.map((s) => s.icao).join(" • ")}
          </FoldButton>
        </FormSection>
      )}
      {showEnroute && enroute.map(block)}
    </div>
  )
}

/* ── one section, in the detail panel ────────────────────────────────────── */

export function BriefingSectionPanel({ record, section }: { record: BriefingRecord; section: BriefingSectionKey }) {
  const b = record.data!
  const def = BRIEFING_SECTIONS.find((s) => s.key === section)!
  const description = `${b.flight.number} ${b.flight.dep}–${b.flight.arr} · ${formatDay(b.flight.date, { weekday: false })} · OFP ${b.flight.ofpVersion}`
  return (
    <ReadingPanel title={def.title} description={description}>
      {section === "init-a" && <InitASection b={b} />}
      {section === "fpln" && <FplnSection b={b} />}
      {section === "sec" && <SecSection b={b} />}
      {section === "init-b" && <InitBSection b={b} />}
      {section === "perf" && <PerfSection b={b} />}
      {section === "notams" && <NotamsSection record={record} />}
      {section === "intams" && <IntamsSection b={b} />}
      {section === "airports" && <AirportsSection airports={airportsOfBriefing(b)} />}
      {section === "weather" && <WeatherSection b={b} />}
    </ReadingPanel>
  )
}

/**
 * The Airports section for a flight with NO briefing imported — its two
 * ends and the pilot's notes on them, which belong to the airport, not to a
 * PDF (`note:airport:<ICAO>`).
 */
export function FlightAirportsPanel({ dep, arr, description }: { dep: string; arr: string; description: string }) {
  return (
    <ReadingPanel title="Airports" description={description}>
      <AirportsSection airports={{ dep, arr, alternates: [], stations: [] }} />
    </ReadingPanel>
  )
}

export interface SummaryContext {
  notams?: { flagged: number; new: number }
  groundTempC?: number | null
}

/** The one-line summary under each section's row on the page, its parts set apart by "•". */
export function sectionSummary(key: BriefingSectionKey, b: Briefing, ctx: SummaryContext = {}): string {
  const join = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" • ")
  switch (key) {
    case "init-a":
      return join([
        b.flight.number,
        b.route.cruiseFl !== null ? `FL${b.route.cruiseFl}/${b.winds.cruiseOat !== null ? `${b.winds.cruiseOat}°` : "---°"}` : "",
        b.winds.tropopause !== null ? `TROPO ${b.winds.tropopause * 100}` : "",
        ctx.groundTempC !== null && ctx.groundTempC !== undefined ? `GND ${ctx.groundTempC}°` : "",
      ])
    case "fpln":
      return join([`${b.sid?.name ?? b.flight.dep} … ${b.star?.name ?? b.flight.arr}`, b.route.groundNm !== null ? `${b.route.groundNm}nm` : "", b.route.tripTime])
    case "sec":
      return join(b.alternates.map((a) => a.icao)) || "None"
    case "init-b":
      return join([`Block ${tonnes(b.fuel.inTanks.kg)}`, `Trip ${tonnes(b.fuel.trip.kg)}`, `MDF ${tonnes(b.fuel.mdf)}`])
    case "perf":
      return b.optiClimb?.steps.length ? join(b.optiClimb.steps.map((s) => `IAS ${s.ias} to FL${s.fl}`)) : "No OptiClimb"
    case "notams": {
      const n = ctx.notams
      if (!n) return `${b.notams.items.length}`
      return n.flagged + n.new === 0 ? "Nothing flagged or new" : join([n.flagged ? `${n.flagged} flagged` : "", n.new ? `${n.new} new` : ""])
    }
    case "intams":
      return b.intams.length ? join([`${b.intams.length}`, b.intams[0].title]) : "None"
    case "airports":
    case "weather":
      return join(briefingAirports(airportsOfBriefing(b)).main.map((s) => s.icao))
  }
}
