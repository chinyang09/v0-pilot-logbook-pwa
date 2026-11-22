"use client"

/**
 * A flight's BRIEFING, as the owner prepared it in a notes app before (Nov
 * 2026: "I can do away with my notes taking app and prepare with my PWA"):
 *
 * | block | from | the pilot |
 * |---|---|---|
 * | Flight card — INIT A / INIT B, OFF / ON, OptiClimb | the OFP (`journalOf`) | reads |
 * | Procedures — TAXI / SID / STAR / APP / TAXI, OFP and Sector Info | the OFP's SID / STAR as a prompt | writes, per ROUTE |
 * | FIR · WP · FREQ | the nav log's FIR boundaries as a prompt (`firCrossings`) | writes, per ROUTE |
 * | NOTAMs | the bulletin, every one | flags; flagged and new in full, the rest folded per location |
 * | INTAMs | the company bulletin | reads |
 * | Airports — Company (green) and Community (pink) | — | writes, per AIRPORT, for every flight there |
 * | Weather, Alternates, Route, Fuel history | the OFP and the WX list | reads |
 *
 * One column on a phone, two where the panel is wide (a container query: the
 * page sits in a split panel, so the window's width says nothing).
 */

import * as React from "react"
import { ChevronDown, Flag, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDay, formatStamp } from "@/lib/utils/date"
import { FormSection } from "@/components/ui/form-section"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { NoteText } from "./note-text"
import { firCrossings, fuelHistory, journalOf } from "@/lib/briefing/journal"
import { groupNotams, notamCounts, type NotamGroup, type NotamView } from "@/lib/briefing/notams"
import { routeRef } from "@/lib/briefing/ids"
import { saveBriefingNote, setNotamFlag } from "@/lib/db"
import { refreshBriefingCaches, useAllBriefings, useBriefingNote, useNotamRegister } from "@/hooks/data/use-briefings"
import type { Briefing } from "@/lib/briefing/types"
import type { BriefingNoteRecord, BriefingRecord, FrequencyNote, ProcedureRow } from "@/types/entities/briefing.types"

/* ── small pieces ────────────────────────────────────────────────────────── */

const kg = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n))
const signedKt = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}kt`)
const z = (hhmm: string) => (hhmm ? `${hhmm}Z` : "—")

function Cell({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 px-3 py-2", className)}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="truncate text-[15px] font-semibold leading-tight tabular-nums text-foreground">{value}</p>
      {sub ? <p className="truncate text-[11px] leading-tight tabular-nums text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

/** A row of cells divided by hairlines. */
function CellRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div
      className="grid divide-x divide-border/70 border-b border-border/70 last:border-b-0"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

/** A disclosure that needs no measuring: a grid row going 0fr → 1fr. */
function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

function FoldButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-[13px] text-muted-foreground"
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
    </button>
  )
}

/* ── the flight card ─────────────────────────────────────────────────────── */

function FlightCard({ b }: { b: Briefing }) {
  const j = journalOf(b)
  return (
    <FormSection title="Flight Card">
      <CellRow cols={4}>
        <Cell label="Off" value={z(j.off)} />
        <Cell label="On" value={z(j.on)} />
        <Cell label="Block" value={j.block || "—"} />
        <Cell label="Flight" value={j.flight || "—"} />
      </CellRow>
      <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Init A</div>
      <CellRow cols={4}>
        <Cell label="Altn" value={j.initA.altn || "—"} />
        <Cell label="To" value={j.initA.toIata} sub={j.initA.toIcao} />
        <Cell label="Flt Nbr" value={j.initA.flightNumber} />
        <Cell label="Time Zone" value={j.initA.timeZone || "—"} />
      </CellRow>
      <CellRow cols={4}>
        <Cell label="Dist" value={j.initA.distNm !== null ? `${j.initA.distNm}nm` : "—"} />
        <Cell label="Crz FL" value={j.initA.crzFl !== null ? `FL${j.initA.crzFl}` : "—"} />
        <Cell label="Crz Temp" value={j.initA.crzTemp !== null ? `${j.initA.crzTemp}°` : "—"} />
        <Cell label="Tropo" value={j.initA.tropo !== null ? `FL${j.initA.tropo}` : "—"} />
      </CellRow>
      <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Init B</div>
      <CellRow cols={4}>
        <Cell label="Taxi" value={kg(j.initB.taxi)} />
        <Cell label="Trip" value={kg(j.initB.trip)} />
        <Cell label="Rte Rsv" value={kg(j.initB.rteRsv)} />
        <Cell label="Altn" value={kg(j.initB.altn)} />
      </CellRow>
      <CellRow cols={4}>
        <Cell label="Final" value={kg(j.initB.final)} />
        <Cell label="MDF" value={kg(j.initB.mdf)} />
        <Cell label="Block" value={kg(j.initB.block)} />
        <Cell label="Avg Wind" value={signedKt(j.initB.avgWindKt)} />
      </CellRow>
      <CellRow cols={3}>
        <Cell label="ZFW" value={kg(j.initB.zfw.planned)} sub={`Max ${kg(j.initB.zfw.max)}`} />
        <Cell label="TOW" value={kg(j.initB.tow.planned)} sub={`Max ${kg(j.initB.tow.max)}`} />
        <Cell label="LW" value={kg(j.initB.lw.planned)} sub={`Max ${kg(j.initB.lw.max)}`} />
      </CellRow>
      <CellRow cols={4}>
        <div className="col-span-2 min-w-0 px-3 py-2">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Opti Clb</p>
          {j.optiClimb.length ? (
            j.optiClimb.map((s, i) => (
              <p key={i} className="truncate text-[15px] font-semibold leading-tight tabular-nums text-foreground">
                {s.ias}
                <span className="font-normal text-muted-foreground"> to </span>FL{s.fl}
              </p>
            ))
          ) : (
            <p className="text-[15px] font-semibold leading-tight text-foreground">—</p>
          )}
          {b.optiClimb?.maxTowKg ? (
            <p className="truncate text-[11px] leading-tight tabular-nums text-muted-foreground">TOW up to {b.optiClimb.maxTowKg}</p>
          ) : null}
        </div>
        <Cell label="Extra" value={kg(j.extra)} />
        <Cell label="Adtnl" value={kg(j.additional)} sub={j.topup60 ? `60 Top-up ${j.topup60}` : undefined} />
      </CellRow>
    </FormSection>
  )
}

/* ── procedures and frequencies (per route) ──────────────────────────────── */

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
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,1fr)] border-b border-border/70 bg-muted/20 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
          <button
            type="button"
            aria-label={`Remove ${r.fir || "row"}`}
            onClick={() => save(rows.filter((_, k) => k !== i))}
            className="flex h-11 w-11 items-center justify-center text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => save([...rows, { fir: "", wp: "", freq: "" }])}
        className="flex min-h-11 w-full items-center gap-2 px-4 text-[14px] text-primary"
      >
        <Plus className="h-4 w-4" /> Add Row
      </button>
    </FormSection>
  )
}

/* ── NOTAMs ──────────────────────────────────────────────────────────────── */

const validity = (n: NotamView["notam"]) => {
  if (n.toMs === null) return n.toText === "UFN" ? "Until further notice" : "Permanent"
  const d = new Date(n.toMs)
  const day = formatDay(d.toISOString().slice(0, 10), { weekday: false })
  return `To ${day} ${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`
}

function NotamItem({ v }: { v: NotamView }) {
  const [open, setOpen] = React.useState(false)
  const n = v.notam
  const lines = n.text.split("\n")
  const long = lines.length > 3 || n.text.length > 240
  const flagged = v.status === "flagged"
  return (
    <div
      className={cn(
        "relative flex gap-1 border-b border-border/70 py-2 pr-4 last:border-b-0",
        v.status === "new" && "bg-primary/[0.06] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary",
      )}
    >
      <button
        type="button"
        aria-pressed={flagged}
        aria-label={flagged ? `Unflag ${v.ids[0]}` : `Flag ${v.ids[0]}`}
        onClick={() => void setNotamFlag(n.key, !flagged).then(refreshBriefingCaches)}
        className="flex h-11 w-11 shrink-0 items-start justify-center pt-1.5"
      >
        <Flag className={cn("h-[18px] w-[18px]", flagged ? "fill-status-warning text-status-warning" : "text-muted-foreground/70")} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{v.ids.join(" · ")}</span>
          {v.status === "new" && <span className="font-semibold uppercase tracking-[0.08em] text-primary">New</span>}
          {n.category && <span className="uppercase tracking-[0.06em]">{n.category.toLowerCase()}</span>}
          <span>{validity(n)}</span>
        </p>
        {(n.schedule || n.limits) && (
          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{[n.schedule, n.limits].filter(Boolean).join(" · ")}</p>
        )}
        <p data-selectable className={cn("mt-1 whitespace-pre-line text-[13px] leading-snug text-foreground", !open && long && "line-clamp-3")}>
          {n.text}
        </p>
        {long && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 min-h-9 text-[12px] font-medium text-primary">
            {open ? "Less" : "More"}
          </button>
        )}
      </div>
    </div>
  )
}

function NotamLocation({ g, mode }: { g: NotamGroup; mode: "review" | "flagged" }) {
  const [showKnown, setShowKnown] = React.useState(false)
  const shown = mode === "flagged" ? g.flagged : [...g.flagged, ...g.fresh]
  const known = mode === "flagged" ? [] : g.known
  if (shown.length === 0 && known.length === 0) return null
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-baseline justify-between gap-2 bg-muted/20 px-4 py-1.5">
        <p className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {g.location}
          {g.locationName ? <span className="font-normal text-muted-foreground"> · {g.locationName}</span> : null}
        </p>
        <p className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{g.section}</p>
      </div>
      {shown.map((v) => (
        <NotamItem key={v.key} v={v} />
      ))}
      {known.length > 0 && (
        <>
          <FoldButton open={showKnown} onClick={() => setShowKnown((s) => !s)}>
            {known.length} seen before
          </FoldButton>
          <Fold open={showKnown}>{showKnown && known.map((v) => <NotamItem key={v.key} v={v} />)}</Fold>
        </>
      )}
    </div>
  )
}

function Notams({ record }: { record: BriefingRecord }) {
  const register = useNotamRegister()
  const b = record.data!
  const groups = React.useMemo(() => groupNotams(b.notams.items, register, record.id), [b, register, record.id])
  const counts = notamCounts(groups)
  const [mode, setMode] = React.useState<"review" | "flagged">("review")
  return (
    <FormSection title={`NOTAMs · ${counts.total}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
        <p className="text-[12px] tabular-nums text-muted-foreground">
          <span className={cn(counts.flagged && "font-semibold text-status-warning")}>{counts.flagged} flagged</span>
          {" · "}
          <span className={cn(counts.new && "font-semibold text-primary")}>{counts.new} new</span>
          {" · "}
          {counts.known} seen
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
        <p className="px-4 py-4 text-[13px] text-muted-foreground">Nothing flagged yet. Flag the NOTAMs that matter — they stay flagged on every briefing that carries them, through a re-issue, until they lapse.</p>
      ) : (
        groups.map((g) => <NotamLocation key={g.location} g={g} mode={mode} />)
      )}
    </FormSection>
  )
}

/* ── INTAMs ──────────────────────────────────────────────────────────────── */

function Intams({ b }: { b: Briefing }) {
  const [open, setOpen] = React.useState<string | null>(null)
  if (b.intams.length === 0) return null
  return (
    <FormSection title={`INTAM · ${b.intams.length}`}>
      {b.intams.map((i) => (
        <div key={i.id} className="border-b border-border/70 last:border-b-0">
          <button
            type="button"
            aria-expanded={open === i.id}
            onClick={() => setOpen((o) => (o === i.id ? null : i.id))}
            className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left"
          >
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{i.id}</span>
            <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">{i.title}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open === i.id && "rotate-180")} />
          </button>
          <Fold open={open === i.id}>
            <p data-selectable className="whitespace-pre-line px-4 pb-3 text-[13px] leading-snug text-foreground">
              {i.body}
              {i.auth ? <span className="mt-1 block text-[11px] text-muted-foreground">Auth: {i.auth}</span> : null}
            </p>
          </Fold>
        </div>
      ))}
    </FormSection>
  )
}

/* ── airports (per airport, every flight there) ──────────────────────────── */

function AirportNotes({ icao, name, role }: { icao: string; name: string; role: string }) {
  const note = useBriefingNote("airport", icao)
  const save = (patch: Partial<Pick<BriefingNoteRecord, "company" | "community">>) =>
    void saveBriefingNote("airport", icao, patch).then(refreshBriefingCaches)
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {icao}
          {name ? <span className="font-normal text-muted-foreground"> · {name}</span> : null}
        </p>
        <p className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{role}</p>
      </div>
      <div className="mx-3 mb-2 rounded-lg bg-emerald-500/10 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400">Company</p>
        <NoteText label={`${icao} company notes`} value={note?.company ?? ""} placeholder="The company's airport briefing, summarised" onCommit={(t) => save({ company: t })} />
      </div>
      <div className="mx-3 mb-3 rounded-lg bg-rose-500/10 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-700 dark:text-rose-400">Community</p>
        <NoteText label={`${icao} community notes`} value={note?.community ?? ""} placeholder="What other pilots say to look out for" onCommit={(t) => save({ community: t })} />
      </div>
    </div>
  )
}

function Airports({ b }: { b: Briefing }) {
  const [showAlts, setShowAlts] = React.useState(false)
  const name = (icao: string) => b.weather.find((s) => s.icao === icao)?.name ?? ""
  return (
    <FormSection title="Airports">
      <AirportNotes icao={b.flight.dep} name={name(b.flight.dep)} role="Departure" />
      <AirportNotes icao={b.flight.arr} name={name(b.flight.arr)} role="Destination" />
      {b.alternates.length > 0 && (
        <>
          <FoldButton open={showAlts} onClick={() => setShowAlts((s) => !s)}>
            Alternates · {b.alternates.map((a) => a.icao).join(" ")}
          </FoldButton>
          <Fold open={showAlts}>
            {showAlts && b.alternates.map((a) => <AirportNotes key={a.icao} icao={a.icao} name={name(a.icao)} role="Alternate" />)}
          </Fold>
        </>
      )}
    </FormSection>
  )
}

/* ── weather, alternates, route ──────────────────────────────────────────── */

const ROLE_NAME = { departure: "Departure", destination: "Destination", alternate: "Alternate", enroute: "En Route" } as const

function Weather({ b }: { b: Briefing }) {
  const [showEnroute, setShowEnroute] = React.useState(false)
  const main = b.weather.filter((s) => s.role !== "enroute")
  const enroute = b.weather.filter((s) => s.role === "enroute")
  const row = (s: (typeof b.weather)[number]) => (
    <div key={s.icao} className="border-b border-border/70 px-4 py-2 last:border-b-0">
      <p className="flex items-baseline justify-between gap-2 text-[13px] font-semibold text-foreground">
        <span>
          {s.icao}
          <span className="font-normal text-muted-foreground"> · {s.name}</span>
        </span>
        <span className="text-[10px] font-normal uppercase tracking-[0.06em] text-muted-foreground">{ROLE_NAME[s.role]}</span>
      </p>
      {s.metar && <p data-selectable className="mt-0.5 text-[12px] leading-snug tabular-nums text-foreground">{s.metar.replace(/^METAR /, "")}</p>}
      {s.taf && <p data-selectable className="mt-0.5 text-[12px] leading-snug tabular-nums text-muted-foreground">{s.taf}</p>}
    </div>
  )
  return (
    <FormSection title="Weather · as Briefed">
      {main.map(row)}
      {enroute.length > 0 && (
        <>
          <FoldButton open={showEnroute} onClick={() => setShowEnroute((s) => !s)}>
            En route · {enroute.map((s) => s.icao).join(" ")}
          </FoldButton>
          <Fold open={showEnroute}>{showEnroute && enroute.map(row)}</Fold>
        </>
      )}
    </FormSection>
  )
}

function Alternates({ b }: { b: Briefing }) {
  if (b.alternates.length === 0) return null
  return (
    <FormSection title="Alternates">
      {b.alternates.map((a) => (
        <div key={a.icao} className="border-b border-border/70 px-4 py-2 last:border-b-0">
          <p className="flex flex-wrap items-baseline gap-x-3 text-[13px] tabular-nums">
            <span className="font-semibold text-foreground">
              {a.icao}/{a.runway}
            </span>
            <span className="text-foreground">{a.approach}</span>
            <span className="text-muted-foreground">{a.minima}</span>
          </p>
          <p className="text-[12px] tabular-nums text-muted-foreground">
            {a.distNm}nm · FL{a.fl} · {signedKt(a.windKt)} · {a.time} · {a.fuelKg}kg
          </p>
          {a.route && <p data-selectable className="text-[12px] leading-snug text-muted-foreground">{a.route}</p>}
        </div>
      ))}
    </FormSection>
  )
}

function Route({ b }: { b: Briefing }) {
  const [showLog, setShowLog] = React.useState(false)
  return (
    <FormSection title="Route">
      <div className="px-4 py-2">
        <p data-selectable className="text-[13px] font-medium leading-snug text-foreground">{b.route.text}</p>
        <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
          {[
            b.route.groundNm !== null && `${b.route.groundNm}nm ground · ${b.route.airNm}nm air`,
            b.route.costIndex !== null && `CI ${b.route.costIndex}`,
            b.rtow && `RTOW ${b.rtow.rtowKg} (${b.rtow.limit}) RWY ${b.rtow.runway} Flaps ${b.rtow.flaps}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {b.rtow?.eosid && <p className="text-[12px] text-muted-foreground">EOSID: {b.rtow.eosid}</p>}
      </div>
      <FoldButton open={showLog} onClick={() => setShowLog((s) => !s)}>
        Nav log · {b.navlog.length} points
      </FoldButton>
      <Fold open={showLog}>
        {showLog && (
          <div className="px-4 pb-2">
            <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3.5rem_3.5rem] gap-x-2 border-b border-border/70 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <span>Point</span>
              <span className="text-right">Time</span>
              <span className="text-right">FL</span>
              <span className="text-right">To Go</span>
              <span className="text-right">Fuel</span>
            </div>
            {b.navlog.map((p, i) => (
              <div
                key={i}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_3rem_3rem_3.5rem_3.5rem] gap-x-2 py-1 text-[12px] tabular-nums",
                  p.fir ? "text-muted-foreground" : "text-foreground",
                )}
              >
                <span className="truncate">{p.fir ? `FIR ${p.fir}` : p.name}</span>
                <span className="text-right">
                  {Math.floor(p.elapsedMin / 60)}:{String(p.elapsedMin % 60).padStart(2, "0")}
                </span>
                <span className="text-right">{p.level || "—"}</span>
                <span className="text-right">{p.toGoNm ?? "—"}</span>
                <span className="text-right">{p.fuelRemainingKg !== null ? (p.fuelRemainingKg / 1000).toFixed(1) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Fold>
    </FormSection>
  )
}

function FuelHistory({ record }: { record: BriefingRecord }) {
  const all = useAllBriefings()
  if (!all) return null
  const h = fuelHistory(record, all)
  const b = record.data!
  return (
    <FormSection title="Fuel · This Route">
      {h.count === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
          The first briefing of {b.flight.dep}–{b.flight.arr} on the {b.flight.aircraftType.slice(0, 4)}. Each one you import adds to this.
        </p>
      ) : (
        <CellRow cols={3}>
          <Cell label="Earlier" value={h.count} sub={h.sameRegistration ? `${h.sameRegistration} on ${record.registration}` : undefined} />
          <Cell label="Trip" value={h.trip ? `${h.trip.avg}` : "—"} sub={h.trip ? `${h.trip.min}–${h.trip.max}` : undefined} />
          <Cell label="Block" value={h.block ? `${h.block.avg}` : "—"} sub={h.block ? `${h.block.min}–${h.block.max}` : undefined} />
        </CellRow>
      )}
    </FormSection>
  )
}

/* ── the page ────────────────────────────────────────────────────────────── */

export function BriefingView({ record }: { record: BriefingRecord }) {
  const b = record.data!
  const route = routeRef(b.flight.dep, b.flight.arr)
  const routeNote = useBriefingNote("route", route)
  return (
    <div className="@container space-y-3 px-panel pb-4 pt-1">
      <p className="text-[13px] tabular-nums text-muted-foreground">
        {formatDay(b.flight.date)} · {b.flight.registration} {b.flight.aircraftType} · OFP {b.flight.ofpVersion}
        {b.flight.captain ? ` · Capt ${b.flight.captain}` : ""}
      </p>
      <div className="grid gap-3 @3xl:grid-cols-2 @3xl:items-start">
        <div className="space-y-3">
          <FlightCard b={b} />
          <Procedures b={b} note={routeNote} route={route} />
          <Frequencies b={b} note={routeNote} route={route} />
          <Airports b={b} />
        </div>
        <div className="space-y-3">
          <Notams record={record} />
          <Intams b={b} />
          <Weather b={b} />
          <Alternates b={b} />
          <Route b={b} />
          <FuelHistory record={record} />
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        {record.fileName} · imported {formatStamp(record.importedAt)}
        {b.flight.generatedAtMs ? ` · generated ${formatStamp(b.flight.generatedAtMs)}` : ""}
      </p>
    </div>
  )
}
