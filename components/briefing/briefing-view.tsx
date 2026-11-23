"use client"

/**
 * A flight's BRIEFING in sections, read the way the pilot prepares the
 * aeroplane — DIFSRIP, the Airbus MCDU order (DATA, INIT A, F-PLN, SEC F-PLN,
 * RAD NAV, INIT B, PERF) — then the NOTAMs, INTAMs, the airports with their
 * LIVE weather, and the fuel this route has taken before. The page lists the
 * sections (`BRIEFING_SECTIONS`) and each opens in the detail panel, as a
 * Settings section does (the owner, Nov 2026: "scrolling of the briefing
 * should be like the other pages").
 *
 * | section | from | the pilot |
 * |---|---|---|
 * | INIT A, INIT B | the OFP as the MCDU's own pages (`mcdu.ts`) | keys it |
 * | F-PLN | route, SID / STAR, procedures (OFP · sector info), FIR · WP · freq, nav log | writes sector info and frequencies, per ROUTE |
 * | SEC F-PLN | the alternates, their routes, approaches and fuel | reads |
 * | PERF | RTOW, flaps, EOSID, OptiClimb, cost index | reads |
 * | NOTAMs | the bulletin by section → airport → category, a row each (`notamTitle`) | flags |
 * | Airports & Weather | live METAR / TAF (`useAirportWeather`), company and community notes per AIRPORT | writes notes |
 */

import * as React from "react"
import { ChevronDown, Flag, Plus, RefreshCw, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDay } from "@/lib/utils/date"
import { formatInstant } from "@/lib/utils/tz-format"
import { FormSection } from "@/components/ui/form-section"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { ReadingPanel } from "@/components/ui/detail-form-panel"
import { NoteText } from "./note-text"
import { firCrossings, fuelHistory } from "@/lib/briefing/journal"
import { hhmm, initA, initB, tonnes, type McduPage } from "@/lib/briefing/mcdu"
import { groupNotams, notamCounts, notamTitle, type NotamGroup, type NotamView } from "@/lib/briefing/notams"
import { routeRef } from "@/lib/briefing/ids"
import { stationsOf, type Briefing, type BriefingStation } from "@/lib/briefing/types"
import { saveBriefingNote, setNotamFlag } from "@/lib/db"
import { refreshBriefingCaches, useAllBriefings, useBriefingNote, useNotamRegister } from "@/hooks/data/use-briefings"
import { useAirportWeather } from "@/hooks/use-airport-weather"
import { briefStations, metarReadings, stationWindows, WINDOW_MS, type StationWindow } from "@/lib/weather/brief"
import { StationWeather } from "@/components/dashboard/flight/weather"
import { usePreferences } from "@/components/providers/preferences-provider"
import type { BriefingNoteRecord, BriefingRecord, FrequencyNote, ProcedureRow } from "@/types/entities/briefing.types"

/* ── the sections ────────────────────────────────────────────────────────── */

export type BriefingSectionKey = "init-a" | "fpln" | "sec" | "init-b" | "perf" | "notams" | "intams" | "airports" | "fuel"

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
  { key: "sec", letter: "S", label: "Sec F-PLN", title: "Alternates" },
  { key: "init-b", letter: "I", label: "Init B", title: "INIT B · Fuel Pred" },
  { key: "perf", letter: "P", label: "Perf", title: "Performance" },
  { key: "notams", label: "NOTAMs", title: "NOTAMs" },
  { key: "intams", label: "INTAMs", title: "INTAMs" },
  { key: "airports", label: "Airports & Weather", title: "Airports & Weather" },
  { key: "fuel", label: "Fuel History", title: "Fuel · This Route" },
]

/* ── shared pieces ───────────────────────────────────────────────────────── */

const kg = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-GB"))
const signedKt = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}kt`)

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
  const depMetar = wx.briefs.find((s) => s.station === b.flight.dep)?.metar?.raw
  const gnd = depMetar ? metarReadings(depMetar).tempC : null
  return (
    <div className="space-y-3">
      <McduScreen page={initA(b, gnd)} />
      <p className="mx-auto max-w-[26rem] px-1 text-[12px] leading-snug text-muted-foreground">
        Cyan is what you key. Green is for reference — GND TEMP is the {b.flight.dep} METAR&apos;s, to check against the ATIS.
      </p>
    </div>
  )
}

function InitBSection({ b }: { b: Briefing }) {
  const f = b.fuel
  const [open, setOpen] = React.useState(false)
  return (
    <div className="space-y-3">
      <McduScreen page={initB(b)} />
      <FormSection title="Fuel · kg">
        <Line label="Trip">{kg(f.trip.kg)} <span className="text-muted-foreground">· {hhmm(f.trip.time)}</span></Line>
        <Line label={`Route Reserve ${f.contingencyPct ?? ""}%`}>{kg(f.contingency.kg)}</Line>
        <Line label="Alternate">{kg(f.alternate.kg)} <span className="text-muted-foreground">· {hhmm(f.alternate.time)}</span></Line>
        <Line label="Final Reserve">{kg(f.finalReserve.kg)}</Line>
        <Line label="Min Diversion">{kg(f.mdf)}</Line>
        <Line label="Additional">{kg(f.additional.kg)}</Line>
        <Line label="60 Min Top-Up">{kg(f.topup60.kg)}</Line>
        <Line label="Extra">{kg(f.extra.kg ?? 0)}</Line>
        <Line label="Taxi">{kg(f.taxi.kg)}</Line>
        <Line label="Block">
          <span className="font-semibold">{kg(f.inTanks.kg)}</span>
        </Line>
        {(f.additionalReasons.length > 0 || f.burnPerTonneZfw !== null || f.burn2000Below !== null) && (
          <>
            <FoldButton open={open} onClick={() => setOpen((o) => !o)}>
              Adjustments
            </FoldButton>
            <Fold open={open}>
              {open && (
                <div className="pb-1">
                  {f.burnPerTonneZfw !== null && <Line label="ZFW +1t">+{f.burnPerTonneZfw} burn</Line>}
                  {f.burn2000Below !== null && <Line label="2,000ft Below">+{f.burn2000Below} burn</Line>}
                  {f.additionalReasons.map((r) => (
                    <Line key={r.reason} label={r.reason}>
                      {kg(r.kg)}
                    </Line>
                  ))}
                </div>
              )}
            </Fold>
          </>
        )}
      </FormSection>
      <FormSection title="Weights · kg">
        <div className="grid grid-cols-3 divide-x divide-border/70">
          <Fig label="ZFW" value={kg(b.weights.zfw.planned)} sub={`Max ${kg(b.weights.zfw.max)}`} />
          <Fig label="TOW" value={kg(b.weights.tow.planned)} sub={`Max ${kg(b.weights.tow.max)}`} />
          <Fig label="LW" value={kg(b.weights.lw.planned)} sub={`Max ${kg(b.weights.lw.max)}`} />
        </div>
      </FormSection>
    </div>
  )
}

/* ── F-PLN: route, procedures, frequencies (per route) ───────────────────── */

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

function NavLog({ b }: { b: Briefing }) {
  const [open, setOpen] = React.useState(false)
  return (
    <FormSection>
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
    </FormSection>
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
        <div className="grid grid-cols-3 divide-x divide-border/70">
          <Fig label="Distance" value={b.route.groundNm !== null ? `${b.route.groundNm}nm` : "—"} sub={b.route.airNm !== null ? `${b.route.airNm}nm air` : undefined} />
          <Fig label="Cruise" value={b.route.cruiseFl !== null ? `FL${b.route.cruiseFl}` : "—"} sub={signedKt(b.route.avgWindKt)} />
          <Fig label="Trip Time" value={b.route.tripTime || "—"} sub={`${b.route.schedDep}–${b.route.schedArr}Z`} />
        </div>
      </FormSection>
      <Procedures b={b} note={note} route={route} />
      <Frequencies b={b} note={note} route={route} />
      <NavLog b={b} />
    </div>
  )
}

/* ── SEC F-PLN: the alternates ───────────────────────────────────────────── */

function SecSection({ b }: { b: Briefing }) {
  if (b.alternates.length === 0) return <p className="px-1 text-[14px] text-muted-foreground">The OFP names no alternate.</p>
  return (
    <FormSection>
      {b.alternates.map((a, i) => (
        <div key={a.icao} className="row-divider px-4 py-3">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] tabular-nums">
            <span className="font-semibold text-foreground">
              {a.icao}/{a.runway}
            </span>
            {i === 0 && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">INIT A</span>}
            <span className="text-foreground">{a.approach}</span>
            <span className="text-muted-foreground">{a.minima}</span>
          </p>
          <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
            {a.distNm}nm · FL{a.fl} · {signedKt(a.windKt)} · {a.time} · {kg(a.fuelKg)}kg
          </p>
          {a.route && (
            <p data-selectable className="mt-0.5 text-[13px] leading-snug text-foreground/80">
              {a.route}
            </p>
          )}
        </div>
      ))}
    </FormSection>
  )
}

/* ── PERF ────────────────────────────────────────────────────────────────── */

function PerfSection({ b }: { b: Briefing }) {
  const r = b.rtow
  return (
    <div className="space-y-3">
      {r && (
        <FormSection title={`Takeoff · ${r.airport} RWY ${r.runway}`}>
          <div className="grid grid-cols-3 divide-x divide-border/70 border-b border-border/70">
            <Fig label="RTOW" value={kg(r.rtowKg)} sub={r.limit ? `${r.limit} limit` : undefined} />
            <Fig label="Flaps" value={r.flaps || "—"} sub={r.rating || undefined} />
            <Fig label="RWY Cond" value={r.condition || "—"} />
          </div>
          {r.eosid && <Line label="EOSID">{r.eosid}</Line>}
          {r.perfKg !== null && <Line label="Perf / Land / Struct">{[r.perfKg, r.landKg, r.structKg].map(kg).join(" / ")}</Line>}
          {r.excessKg !== null && <Line label="Excess Available">{kg(r.excessKg)}</Line>}
        </FormSection>
      )}
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
      <FormSection title="Cruise">
        <Line label="Cost Index">{b.route.costIndex ?? "—"}</Line>
        <Line label="Rules">{b.route.rules || "—"}</Line>
      </FormSection>
    </div>
  )
}

/* ── NOTAMs ──────────────────────────────────────────────────────────────── */

const validity = (n: NotamView["notam"]) => {
  if (n.toMs === null) return n.toText === "UFN" ? "UFN" : "PERM"
  const d = new Date(n.toMs)
  return `to ${formatDay(d.toISOString().slice(0, 10), { weekday: false })} ${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`
}

/**
 * One NOTAM as an ACCORDION row (the owner, Nov 2026: "ID or header or
 * title, with validity shown when collapsed, then expanded for fine
 * details"). The flag is its own target beside the row, never inside it.
 */
function NotamRow({ v }: { v: NotamView }) {
  const [open, setOpen] = React.useState(false)
  const n = v.notam
  const flagged = v.status === "flagged"
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
          <Flag className={cn("h-[18px] w-[18px]", flagged ? "fill-status-warning text-status-warning" : "text-muted-foreground/70")} />
        </button>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 min-w-0 flex-1 items-start gap-2 py-2.5 pr-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{v.ids[0]}</span>
              {v.status === "new" && <span className="font-semibold uppercase tracking-[0.08em] text-primary">New</span>}
              <span>{validity(n)}</span>
              {n.schedule && <span className="truncate">· {n.schedule.split(/\s+/).slice(0, 3).join(" ")}…</span>}
            </span>
            <span className={cn("mt-0.5 block text-[13px] leading-snug text-foreground", !open && "line-clamp-2")}>{notamTitle(n)}</span>
          </span>
          <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      <Fold open={open}>
        {open && (
          <div className="pb-3 pl-11 pr-4">
            {v.ids.length > 1 && <p className="text-[11px] tabular-nums text-muted-foreground">Also {v.ids.slice(1).join(" · ")}</p>}
            {(n.schedule || n.limits) && (
              <p className="text-[12px] tabular-nums text-muted-foreground">{[n.schedule, n.limits].filter(Boolean).join(" · ")}</p>
            )}
            <p data-selectable className="mt-1 whitespace-pre-line text-[13px] leading-snug text-foreground">
              {n.text}
            </p>
          </div>
        )}
      </Fold>
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
            {groups.map((g) => g.location).join(" ")} ·{" "}
            <span className={cn(c.flagged > 0 && "text-status-warning")}>{c.flagged} flagged</span> ·{" "}
            <span className={cn(c.new > 0 && "text-primary")}>{c.new} new</span> · {c.known} seen
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

/* ── INTAMs ──────────────────────────────────────────────────────────────── */

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
              <p data-selectable className="whitespace-pre-line px-4 pb-3 text-[13px] leading-snug text-foreground">
                {i.body}
                {i.auth ? <span className="mt-1 block text-[11px] text-muted-foreground">Auth: {i.auth}</span> : null}
              </p>
            )}
          </Fold>
        </div>
      ))}
    </FormSection>
  )
}

/* ── Airports & Weather (per airport, every flight there) ────────────────── */

const ROLE_NAME = { departure: "Departure", destination: "Destination", alternate: "Alternate", enroute: "En Route" } as const

function AirportBlock({ station, wx, clock, now }: { station: BriefingStation; wx: ReturnType<typeof useBriefingWeather>; clock: (ms: number) => string; now: number }) {
  const note = useBriefingNote("airport", station.icao)
  const brief = wx.briefs.find((s) => s.station === station.icao)
  const save = (patch: Partial<Pick<BriefingNoteRecord, "company" | "community">>) => void saveBriefingNote("airport", station.icao, patch).then(refreshBriefingCaches)
  return (
    <FormSection>
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
        <p className="min-w-0 truncate text-[15px] font-semibold text-foreground">
          {station.icao}
          {station.name ? <span className="font-normal text-muted-foreground"> · {station.name}</span> : null}
        </p>
        <p className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{ROLE_NAME[station.role]}</p>
      </div>
      <div className="px-4 pb-3">
        {brief ? <StationWeather b={brief} clock={clock} now={now} /> : <p className="text-[12px] text-muted-foreground">{wx.loading ? "Getting the weather…" : "No weather"}</p>}
      </div>
      <div className="mx-3 mb-2 rounded-lg bg-emerald-500/10 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400">Company</p>
        <NoteText label={`${station.icao} company notes`} value={note?.company ?? ""} placeholder="The company's airport briefing, summarised" onCommit={(t) => save({ company: t })} />
      </div>
      <div className="mx-3 mb-3 rounded-lg bg-rose-500/10 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-700 dark:text-rose-400">Community</p>
        <NoteText label={`${station.icao} community notes`} value={note?.community ?? ""} placeholder="What other pilots say to look out for" onCommit={(t) => save({ community: t })} />
      </div>
    </FormSection>
  )
}

function AirportsSection({ b }: { b: Briefing }) {
  const wx = useBriefingWeather(b)
  const { preferences } = usePreferences()
  const clock = React.useCallback((ms: number) => formatInstant(ms, { ...preferences.display, useZuluTime: true }), [preferences.display])
  const [showEnroute, setShowEnroute] = React.useState(false)
  // The reports' ages are read against when the section opened.
  const [now] = React.useState(Date.now)
  const all = stationsOf(b)
  const named = (icao: string, role: BriefingStation["role"]): BriefingStation => all.find((s) => s.icao === icao) ?? { icao, iata: "", name: "", role }
  // An airport once — the departure is often the first alternate too.
  const main = [named(b.flight.dep, "departure"), named(b.flight.arr, "destination"), ...b.alternates.map((a) => named(a.icao, "alternate"))].filter(
    (s, i, xs) => xs.findIndex((x) => x.icao === s.icao) === i,
  )
  const enroute = all.filter((s) => !main.some((m) => m.icao === s.icao))
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[12px] text-muted-foreground">
          {wx.refreshing ? "Getting the latest…" : wx.failed ? "Weather unavailable" : "Live METAR and TAF, the flight's times lit"}
        </p>
        <button type="button" onClick={wx.refresh} className="control-surface flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px]" aria-label="Refresh weather">
          <RefreshCw className={cn("h-3.5 w-3.5", wx.refreshing && "animate-spin")} /> Refresh
        </button>
      </div>
      {main.map((s) => (
        <AirportBlock key={s.icao} station={s} wx={wx} clock={clock} now={now} />
      ))}
      {enroute.length > 0 && (
        <FormSection>
          <FoldButton open={showEnroute} onClick={() => setShowEnroute((s) => !s)}>
            En route · {enroute.map((s) => s.icao).join(" ")}
          </FoldButton>
        </FormSection>
      )}
      {showEnroute && enroute.map((s) => <AirportBlock key={s.icao} station={s} wx={wx} clock={clock} now={now} />)}
    </div>
  )
}

/* ── Fuel history ────────────────────────────────────────────────────────── */

function FuelSection({ record }: { record: BriefingRecord }) {
  const all = useAllBriefings()
  const b = record.data!
  if (!all) return null
  const h = fuelHistory(record, all)
  if (h.count === 0)
    return (
      <p className="px-1 text-[14px] leading-snug text-muted-foreground">
        The first briefing of {b.flight.dep}–{b.flight.arr} on the {b.flight.aircraftType.slice(0, 4)}. Each one you import adds to this, so you can see what the route usually takes.
      </p>
    )
  return (
    <FormSection>
      <div className="grid grid-cols-3 divide-x divide-border/70">
        <Fig label="Earlier" value={h.count} sub={h.sameRegistration ? `${h.sameRegistration} on ${record.registration}` : undefined} />
        <Fig label="Trip" value={h.trip ? kg(h.trip.avg) : "—"} sub={h.trip ? `${kg(h.trip.min)}–${kg(h.trip.max)}` : undefined} />
        <Fig label="Block" value={h.block ? kg(h.block.avg) : "—"} sub={h.block ? `${kg(h.block.min)}–${kg(h.block.max)}` : undefined} />
      </div>
      <p className="border-t border-border/70 px-4 py-2 text-[12px] text-muted-foreground">
        This one: trip {kg(b.fuel.trip.kg)} · block {kg(b.fuel.inTanks.kg)}
      </p>
    </FormSection>
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
      {section === "airports" && <AirportsSection b={b} />}
      {section === "fuel" && <FuelSection record={record} />}
    </ReadingPanel>
  )
}

/** The one-line summary under each section's row on the page. */
export function sectionSummary(key: BriefingSectionKey, b: Briefing, notams?: { total: number; flagged: number; new: number }): string {
  switch (key) {
    case "init-a":
      return [b.flight.routeNumber, `${b.flight.dep}/${b.flight.arr}`, b.route.costIndex !== null ? `CI ${b.route.costIndex}` : ""].filter(Boolean).join(" · ")
    case "fpln":
      return [`${b.sid?.name ?? b.flight.dep} … ${b.star?.name ?? b.flight.arr}`, b.route.groundNm !== null ? `${b.route.groundNm}nm` : "", b.route.cruiseFl ? `FL${b.route.cruiseFl}` : ""].filter(Boolean).join(" · ")
    case "sec":
      return b.alternates.map((a) => a.icao).join(" · ") || "None"
    case "init-b":
      return `Block ${tonnes(b.fuel.inTanks.kg)} · Trip ${tonnes(b.fuel.trip.kg)} · MDF ${tonnes(b.fuel.mdf)}`
    case "perf":
      return b.rtow ? `RWY ${b.rtow.runway} · Flaps ${b.rtow.flaps} · RTOW ${tonnes(b.rtow.rtowKg)}` : "OptiClimb"
    case "notams":
      return notams ? `${notams.total} · ${notams.flagged} flagged · ${notams.new} new` : `${b.notams.items.length}`
    case "intams":
      return b.intams.length ? `${b.intams.length} · ${b.intams[0].title}` : "None"
    case "airports":
      return `${[...new Set([b.flight.dep, b.flight.arr, ...b.alternates.map((a) => a.icao)])].join(" ")} · live weather`
    case "fuel":
      return `${b.flight.dep}–${b.flight.arr} on the ${b.flight.aircraftType.slice(0, 4)}`
  }
}
