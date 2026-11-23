"use client"

/**
 * What each widget shows on the page — the glance. Everything here is ONE
 * line per fact, truncated rather than wrapped, so a tile is the same height
 * whatever it says (the page is laid out to a phone's height and must not
 * move as the answers land). The detail behind each is in `details.tsx`.
 */

import type { Requirement } from "@/lib/utils/dashboard/legality"
import type { SectorLeg } from "@/lib/utils/dashboard/duty-status"
import { formatDay } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import { dutyWindow, formatDutyClock, formatRestSpan } from "@/lib/utils/dashboard/duty-status"
import { REQ_TONE, TONE } from "./instruments"
import { DutyClockFace } from "./duty-clock"
import { WidgetLabel } from "./widget"
import { metarConditions } from "@/lib/weather/brief"
import { favouredRunway, runwayEndsFrom, type WindOnRunway } from "@/lib/weather/runway-wind"
import { greatCircleNm } from "@/lib/utils/geo"
import { hasCoordinates } from "@/lib/utils/flight-calculations"
import type { FlightBrief } from "./model"
import type { CrewMate } from "@/lib/utils/dashboard/flight-brief"
import type { TileSize } from "@/lib/utils/dashboard/bento"
import { PILOT_ROLES, roleLabel, type LogbookAuthority } from "@/lib/utils/logbook-rules"
import type { PilotRole } from "@/types/entities/flight.types"
import { addDays, localDayKey, lookAheadFor, type LookAhead } from "@/lib/utils/dashboard/currency-dots"
import { CurrencyDots } from "./currency-dots"
import { Pager, useRememberedPage } from "./pager"
import { whereaboutsLines } from "@/lib/lookup/aircraft-whereabouts"
import * as React from "react"

/** "18 Nov" — a stored day, as a tile has room for it. */
export const shortDay = (ymd: string) => formatDay(ymd, { weekday: false, year: false })

/** "Woon Kok Heng, Benson" → "Woon Kok Heng": the name before the given name. */
export const shortName = (name: string) => name.split(",")[0].trim()

/* ── Duty clock ──────────────────────────────────────────────────────────── */

/**
 * Duty and rest, one card: where the pilot stands now and what it asks of
 * them, in the tone of that answer alone. A lapsed currency is the currency
 * card's to say — it used to lead this one ("Tightest 90-Day Recency") and
 * then said it again two cards down.
 */
export function DutyFace({ brief }: { brief: FlightBrief }) {
  return (
    <>
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent", TONE[brief.status.dutyState].glow)}
      />
      <div className="relative">
        <DutyClockFace brief={brief} />
      </div>
    </>
  )
}

/* ── This / next duty ────────────────────────────────────────────────────── */

/** The chain's legs: the logbook's own, each with its progress; else the route the duty carries. */
export function chainOf(brief: FlightBrief): { legs: SectorLeg[]; route?: string } {
  const { duty, status, code } = brief
  if (duty.legs.length > 0) {
    return {
      legs: duty.legs.map((f) => ({
        from: code(f.departureIcao, f.departureIata),
        to: code(f.arrivalIcao, f.arrivalIata),
        status: f.inTime ? "complete" : f.outTime ? "active" : "scheduled",
      })),
    }
  }
  if (duty.current && status.duty.active) return { legs: status.duty.active.legs }
  return { legs: [], route: status.duty.next?.route }
}

/** "Now", "Next", "Later" — which duty the card is about. */
export function dutyWord(brief: FlightBrief): string {
  return brief.duty.current ? "Now" : brief.duty.index === 0 ? "Next" : "Later"
}

/** The rest before a later duty, against its own minimum: "Rest 15:20 · Min 12:00". */
export function restBeforeText(brief: FlightBrief): { text: string; short: boolean } | null {
  const r = brief.duty.restBefore
  if (!r) return null
  return { text: `Rest ${formatRestSpan(r.restMinutes)} · Min ${formatDutyClock(r.requiredRestMinutes)}`, short: !r.compliant }
}

/**
 * The duty laid on its day (the owner's duty-and-crew widget): a 24-hour
 * strip in the pilot's clock — a tick each hour, a taller one every six with
 * its hour under it — the duty from report to off duty as a track, each leg
 * filled on it (flown in ink, still to fly in the accent) and now as a
 * hairline. The track and the legs are squared off (the owner: so their left
 * and right ends read), and a duty past midnight moves the window on so it is
 * all in view.
 */
function DayBar({ brief, focus }: { brief: FlightBrief; focus: number | null }) {
  const { duty, now, display } = brief
  const zulu = display?.useZuluTime !== false
  const legs = duty.times
  const w = duty.period ? dutyWindow(duty.period) : null
  const start0 = w?.startMs ?? duty.atMs
  if (start0 === null) return null
  const end0 = w?.endMs ?? Math.max(...legs.map((t) => t.arriveMs ?? 0), start0 + 3600_000)
  const H = 3600_000
  const dayStart = (ms: number) => {
    const d = new Date(ms)
    return zulu ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  let from = dayStart(start0)
  while (end0 > from + 24 * H && from + 6 * H <= start0) from += 6 * H
  const to = from + 24 * H
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - from) / (to - from)) * 100))}%`
  const span = (a: number, b: number) => ({ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` })
  const hourOf = (ms: number) => (zulu ? new Date(ms).getUTCHours() : new Date(ms).getHours())
  return (
    <div aria-hidden className="mb-1.5" data-morph="fl-day" data-morph-stretch>
      <div className="relative h-[18px]">
        {/* The six-hourly lines run through the strip, behind the duty. */}
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} className="absolute inset-y-0 w-px bg-border" style={{ left: pct(from + h * H) }} />
        ))}
        <span className="absolute inset-y-0 rounded-[3px] border border-foreground/30 bg-muted" style={span(start0, end0)} />
        {legs.map((t, i) =>
          t.departMs !== null && t.arriveMs !== null ? (
            <span
              key={i}
              className={cn(
                "absolute inset-y-[3px] rounded-[2px] transition-opacity",
                duty.legs[i]?.inTime ? "bg-foreground/55" : "bg-primary",
                // The leg the page is about stands out; the others are context.
                focus !== null && focus !== i && "opacity-35",
              )}
              style={span(t.departMs, t.arriveMs)}
            />
          ) : null,
        )}
        {now > from && now < to && <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground" style={{ left: pct(now) }} />}
      </div>
      {/* A tick each hour, the six-hourly ones taller. */}
      <div className="relative h-1.5">
        {Array.from({ length: 25 }, (_, h) => (
          <span
            key={h}
            className={cn("absolute top-0 w-px", h % 6 === 0 ? "h-1.5 bg-foreground/45" : "h-1 bg-foreground/20")}
            style={{ left: pct(from + h * H) }}
          />
        ))}
      </div>
      <div className="relative h-3 text-[9px] tabular-nums text-muted-foreground">
        {[0, 6, 12, 18].map((h) => (
          <span key={h} className="absolute" style={{ left: pct(from + h * H) }}>
            {String(hourOf(from + h * H)).padStart(2, "0")}
          </span>
        ))}
        <span className="absolute right-0">{zulu ? "Z" : "L"}</span>
      </div>
    </div>
  )
}

/** A crew member's seat as the pilot's logbook rules name it ("PIC", "P2"); a relief pilot is "Relief". */
export function crewRole(role: string, authority: LogbookAuthority): string {
  if ((PILOT_ROLES as readonly string[]).includes(role)) return roleLabel(role as PilotRole, authority)
  return /relief/i.test(role) ? "Relief" : role
}

/** The key a crew member's initials and name fly between the tile and the card under. */
export const crewKey = (m: { personId?: string | null; name: string }) => (m.personId ?? m.name).replace(/\s+/g, "_")

/**
 * The crew of the leg on show: initials, the name, their seat and how often
 * flown together — on the right across the row, running the tile's full
 * height with its divider (the owner: it stopped short of a tall tile's
 * bottom), or under the leg in a narrower tile two rows tall.
 */
function CrewPanel({ brief, crew, below = false }: { brief: FlightBrief; crew: CrewMate[]; below?: boolean }) {
  const shown = crew.slice(0, 3)
  const role = (r: string) => crewRole(r, brief.authority)
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col justify-center gap-1.5 border-border/70 bg-muted/50",
        below ? "-mx-3 -mb-3 mt-2 flex-1 border-t px-3 py-2" : "-my-3 -mr-3 ml-3 w-[40%] max-w-44 self-stretch rounded-r-2xl border-l px-2.5 py-3",
      )}
    >
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No crew yet</p>
      ) : (
        shown.map((m) => (
          <div key={m.personId ?? m.name} className="flex min-w-0 items-center gap-1.5">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-[9px] font-semibold text-foreground"
              data-morph={`crew-ini-${crewKey(m)}`}
            >
              {initialsOf(m.name)}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[12px] font-medium text-foreground" data-morph={`crew-name-${crewKey(m)}`}>
                {shortName(m.name)}
              </span>
              {/* The role and the history fly into the card's row (its caption and its right). */}
              <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
                <span data-morph={`crew-role-${crewKey(m)}`}>{role(m.role)}</span>
                {(m.last ? (m.count ? `${m.count}×` : null) : "New") && (
                  <>
                    {" · "}
                    <span data-morph={`crew-last-${crewKey(m)}`}>{m.last ? `${m.count}×` : "New"}</span>
                  </>
                )}
              </span>
            </span>
          </div>
        ))
      )}
      {crew.length > shown.length && <p className="pl-7 text-[11px] text-muted-foreground">+ {crew.length - shown.length} more</p>}
    </div>
  )
}

/** "Woon Kok Heng" → "WK". */
export function initialsOf(name: string): string {
  const parts = shortName(name).split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

/** The leg the duty is on now: the first not yet on blocks, else the last. */
export function legNow(brief: FlightBrief): number {
  const i = brief.duty.legs.findIndex((l) => !l.inTime)
  return i < 0 ? Math.max(0, brief.duty.legs.length - 1) : i
}

/**
 * One leg as the flights tile has it (the owner, Nov 2026: "show aircraft in
 * use, gate, essentially flight info"): the route large; the flight number
 * and its times; the AEROPLANE (registration and type) and the GATE on a line
 * of their own; then where the aeroplane is coming from, or what follows.
 */
function LegPage({ brief, i }: { brief: FlightBrief; i: number }) {
  const { duty, clock, code } = brief
  const f = duty.legs[i]
  const t = duty.times[i]
  const flown = !!f.inTime
  const gates = duty.info?.legGates[i]
  const gate = flown ? gates?.arr || "" : gates?.dep || ""
  const last = i === duty.legs.length - 1
  const rest = i === 0 ? restBeforeText(brief) : null
  // The inbound aeroplane belongs to the leg still to fly next.
  const inbound = i === legNow(brief) && !flown ? duty.lookups?.inbound : null
  const whereabouts =
    inbound?.status === "done" ? whereaboutsLines(inbound.whereabouts, brief.now, brief.display?.clockSeparator) : null
  const reg = f.aircraftReg || (i === legNow(brief) ? duty.lookups?.inboundRegistration : "") || ""
  const type = f.aircraftType || ""
  const next = !last && !flown ? duty.legs[i + 1] : null
  return (
    <>
      <p className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground @[15rem]:text-[21px]" data-morph={`fl-route-${i}`}>
        {code(f.departureIcao, f.departureIata)} – {code(f.arrivalIcao, f.arrivalIata)}
      </p>
      <p className="mt-0.5 truncate text-[12px] leading-tight tabular-nums text-foreground" suppressHydrationWarning data-morph={`fl-num-${i}`}>
        <span className="font-semibold">{f.flightNumber || "Flight"}</span>
        {t?.departMs != null && t?.arriveMs != null && ` · ${clock(t.departMs).replace(/Z$/, "")}–${clock(t.arriveMs)}`}
        {flown && <span className="text-muted-foreground"> · On blocks</span>}
      </p>
      <p className="flex items-baseline justify-between gap-2 text-[12px] leading-tight tabular-nums">
        <span className="min-w-0 truncate" data-morph={`fl-ac-${i}`}>
          <span className={cn("font-semibold", reg ? "text-foreground" : "text-muted-foreground")}>{reg || "Aircraft not yet assigned"}</span>
          {reg && type && <span className="text-muted-foreground"> {type}</span>}
        </span>
        {gate && (
          <span className="shrink-0 font-semibold text-foreground" data-morph={`fl-gate-${i}`}>
            {flown ? "Arr " : ""}Gate {gate}
          </span>
        )}
      </p>
      <p
        className={cn("truncate text-[11px] leading-tight", rest?.short ? "text-destructive" : "text-muted-foreground")}
        suppressHydrationWarning
        data-morph={`fl-next-${i}`}
      >
        {[
          whereabouts ? [whereabouts.flight, whereabouts.primary].filter(Boolean).join(" · ") : null,
          !whereabouts && rest ? rest.text : null,
          next ? `then ${code(next.departureIcao, next.departureIata)}–${code(next.arrivalIcao, next.arrivalIata)}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "\u00a0"}
      </p>
    </>
  )
}

/**
 * The chosen duty's FLIGHTS, a leg a page (the owner, Nov 2026: "tracks
 * individual flights, swipeable to first or second leg"): the duty on its
 * day with the leg on show lit, the leg's route large, its number and times,
 * its gate and aeroplane — and that leg's crew beside it. It opens on the leg
 * the duty is on; the duty itself is chosen in the header. The card lists
 * every leg with its gates, and every crew member.
 */
export function FlightFace({ brief, size, inCard = false }: { brief: FlightBrief; size: TileSize; inCard?: boolean }) {
  const { duty, day } = brief
  const crewAt = inCard ? null : size.cols >= 2.5 ? "side" : size.rows >= 2 ? "below" : null
  const count = duty.legs.length
  const [page, setPage] = useRememberedPage(`flight:${duty.atMs}`, legNow(brief), count)
  if (duty.atMs === null) {
    return (
      <>
        <WidgetLabel>Next</WidgetLabel>
        <p className="text-sm font-medium text-muted-foreground">Nothing rostered</p>
      </>
    )
  }
  const crew = count ? (brief.legCrew[page] ?? brief.crew) : brief.crew
  const { legs, route } = chainOf(brief)
  const stops = legs.length ? [legs[0].from, ...legs.map((l) => l.to)] : (route ?? "").split("-").filter(Boolean)
  return (
    <div className={cn("flex min-w-0 flex-1", crewAt === "below" && "flex-col")}>
      {/* A container: on a phone the crew panel leaves the route ~190px, and a
          three-stop route at 21px does not fit it (measured at 360). */}
      <div className={cn("@container flex min-w-0 flex-col", crewAt !== "below" && "flex-1")}>
        <WidgetLabel right={count > 1 ? <span className="text-[10px] font-semibold tabular-nums text-muted-foreground" data-morph="fl-legn">Leg {page + 1}/{count}</span> : undefined}>
          <span suppressHydrationWarning>
            {dutyWord(brief)} · {day(duty.atMs)}
          </span>
        </WidgetLabel>
        <DayBar brief={brief} focus={count > 1 ? page : null} />
        {count === 0 ? (
          <p className="truncate text-[17px] font-bold leading-tight tracking-tight text-foreground @[15rem]:text-[21px]" data-morph="fl-route">
            {stops.join(stops.length > 2 ? "–" : " – ") || "—"}
          </p>
        ) : (
          <Pager count={count} page={page} onPage={setPage} morph="fl">
            {(i) => <LegPage brief={brief} i={i} />}
          </Pager>
        )}
      </div>
      {crewAt && <CrewPanel brief={brief} crew={crew} below={crewAt === "below"} />}
    </div>
  )
}

/* ── Destinations ────────────────────────────────────────────────────────── */

/**
 * Every airport the duty lands at, in the order it reaches them — the return
 * to base included. Leaving it out (it is where the duty starts) gave a
 * there-and-back duty ONE destination: no dots and nothing to swipe (the
 * owner's report), and no runway or weather card for the landing home.
 */
export function destinationsOf(brief: FlightBrief) {
  return brief.destinations
}

/** The runway the wind favours at a destination — the tile's tone (a tailwind) reads it. */
export function favouredAt(brief: FlightBrief, icao: string): WindOnRunway | null {
  const info = brief.airportInfo[icao]
  const raw = brief.weather.briefs.find((b) => b.station === icao)?.metar?.raw
  if (!info || !raw) return null
  const c = metarConditions(raw)
  return favouredRunway(runwayEndsFrom(info.runways), c.windDir ?? null, c.windKt)
}

/* ── Currency and limits ─────────────────────────────────────────────────── */

/**
 * What is flagged past the rows a tile names, as a word in the colour of the
 * worst of it: "+2" — no icon (the owner, Nov 2026: "no need for alert icon …
 * just highlight area of concern with color change"). Nothing when nothing is.
 */
function MoreFlagged({ rows }: { rows: Array<{ state: Requirement["state"] }> }) {
  const flagged = rows.filter((r) => r.state !== "ok")
  if (flagged.length === 0) return null
  const fail = flagged.some((r) => r.state === "fail")
  return (
    <span
      className={cn("shrink-0 text-[10px] font-semibold tabular-nums", fail ? "text-destructive" : "text-status-warning")}
      aria-label={`${flagged.length} more flagged`}
    >
      +{flagged.length}
    </span>
  )
}

/** One line of the currency tile: a logbook requirement (recency, sectors not logged) or a document. */
export interface CurrencyRow {
  key: string
  name: string
  state: Requirement["state"]
  figure: string
  /** The last valid day — the dot it lights — or null for what has no expiry (sectors not logged). */
  ymd: string | null
}

const SEVERITY: Record<Requirement["state"], number> = { fail: 0, unknown: 1, caution: 1, ok: 2 }

/**
 * Everything the currency tile summarises, most pressing first: the logbook's
 * own requirements (90-day recency, sectors not logged, a read that failed)
 * and every document on the Currencies page, by the NAME that page gives it.
 * Within a state, the order is the page's — soonest first.
 */
export function currencyRows(brief: FlightBrief): CurrencyRow[] {
  // 90-day recency is the one that usually binds (the rest are a year long
  // and renewed on the ground), so it leads — and it is judged against the
  // DUTY, not today: recency that lapses before the report does not cover it.
  const lapseMs = brief.recencyLapseIso ? Date.parse(`${brief.recencyLapseIso}T00:00:00Z`) : NaN
  const logbook = brief.status.legality.requirements
    .filter((r) => r.group === "currency" && !r.id.startsWith("doc-"))
    .map((r) => {
      const beforeDuty =
        r.id === "recency" && r.state !== "fail" && brief.duty.atMs !== null && Number.isFinite(lapseMs) && lapseMs <= brief.duty.atMs
      return {
        key: r.id,
        name: r.id === "recency" ? "Recency 90d" : r.label,
        state: beforeDuty ? ("caution" as const) : r.state,
        figure: beforeDuty ? `${r.value} · before duty` : r.value,
        // Recency's last current day; lapsed (or never current), it is today's.
        ymd: r.id === "recency" ? (brief.recencyLapseIso && r.state !== "fail" ? addDays(brief.recencyLapseIso, -1) : "0000-01-01") : null,
      }
    })
  const docs = [...brief.currency.attention, ...brief.currency.current].map((l) => ({
    key: `doc-${l.id}`,
    name: l.name,
    state: l.state,
    figure: l.lapsesBeforeDuty ? `${l.figure} · before duty` : l.figure,
    ymd: l.expiryDate || null,
  }))
  // Recency first whatever its state; then the documents, most pressing first.
  const [recency, others] = [logbook.filter((r) => r.key === "recency"), logbook.filter((r) => r.key !== "recency")]
  return [...recency, ...[...others, ...docs].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state])]
}

/**
 * The currencies in the order they run out: what has already gone (and what
 * is wrong now with no date — sectors not logged) first, then by expiry, the
 * more pressing first on a tie. The first is the CLOSEST, the dot ringed.
 */
export function currenciesBySoonest(rows: CurrencyRow[]): CurrencyRow[] {
  const at = (r: CurrencyRow) => (r.ymd === null ? (r.state === "ok" ? "9999" : "0000") : r.ymd)
  return [...rows].sort((a, b) => at(a).localeCompare(at(b)) || SEVERITY[a.state] - SEVERITY[b.state])
}

/** "90d", "6m", "1y" — how far the dots look, said beside the tile's label. */
const AHEAD_SHORT: Record<LookAhead, string> = { "90d": "90d", "6m": "6m", "1y": "1y" }

/**
 * The currencies on a DOT CALENDAR (the owner, Nov 2026): a dot a day, looking
 * 90 days, six months or a year ahead as the tile is a third, two thirds or
 * the whole row wide, each expiry a dot lit in its state's colour and the
 * closest ringed — then the closest by name (more of them in a tile two rows
 * tall). The tally counts what is flagged past the rows named.
 */
export function CurrencyFace({ brief, size }: { brief: FlightBrief; size: TileSize }) {
  const all = currenciesBySoonest(currencyRows(brief))
  const ahead = lookAheadFor(size.cols)
  // Under two thirds of the row it names the closest only; a THIRD puts the
  // figure under the name (half the row has room for both on one line).
  const narrow = size.cols < 2
  const third = size.cols < 1.5
  const lines = size.rows >= 2 ? (narrow ? 3 : 6) : narrow ? 1 : 2
  const marks = all.filter((r) => r.ymd !== null).map((r) => ({ key: r.key, name: r.name, state: r.state, ymd: r.ymd! }))
  return (
    <>
      {/* A third of the row has no room for the tally beside the label: its
          edge and the dots' colours carry what is flagged. */}
      <WidgetLabel right={third ? undefined : <MoreFlagged rows={all.slice(lines)} />}>
        Currency
        {!third && <span className="font-medium normal-case tracking-normal"> · {AHEAD_SHORT[ahead]}</span>}
      </WidgetLabel>
      {all.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">None tracked</p>
      ) : (
        <>
          <div data-morph="cur-dots">
            <CurrencyDots today={localDayKey(brief.now)} ahead={ahead} marks={marks} closest={marks[0]?.key ?? null} className="mb-1" />
          </div>
          <ul className="space-y-1">
            {all.slice(0, lines).map((r) => {
              return (
                // No icon: a flagged currency says so in its figure's colour.
                <li key={r.key} className={cn("flex items-center gap-1 text-xs leading-tight", third && "flex-wrap")}>
                  <span className={cn("min-w-0 flex-1 truncate text-foreground", third && "basis-full")} data-morph={`cur-name-${r.key}`}>
                    {r.name}
                  </span>
                  <span
                    className={cn("shrink-0 font-semibold tabular-nums", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}
                    data-morph={`cur-fig-${r.key}`}
                  >
                    {r.figure.split(" · ")[0]}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}

const LIMIT_ORDER = ["duty-14", "duty-28", "flight-28", "flight-365"]

export function limitsOf(brief: FlightBrief): Requirement[] {
  const byId = new Map(brief.status.legality.requirements.filter((r) => r.group === "limits").map((r) => [r.id, r]))
  return LIMIT_ORDER.map((id) => byId.get(id)).filter((r): r is Requirement => !!r)
}

/**
 * How much later the chosen duty can run inside every limit — the FDP's and
 * every rolling window's — as a figure; amber under an hour, red at none.
 */
export function marginText(minutes: number): string {
  // A day and more is said in hours: "+69h", not "+69:21".
  return minutes >= 24 * 60 ? `${Math.floor(minutes / 60)}h` : formatDutyClock(minutes)
}

export function marginTone(minutes: number): string {
  return minutes <= 0 ? "text-destructive" : minutes < 60 ? "text-status-warning" : "text-foreground"
}

/**
 * The four rolling limits as bars with the hours LEFT (the owner, Nov 2026:
 * the limits tile tracks the four limits; the FDP is the duty tile's).
 */
export function LimitsFace({ brief, size }: { brief: FlightBrief; size?: TileSize }) {
  const limits = limitsOf(brief)
  // A third of the row: the figure alone ("81h").
  const narrow = (size?.cols ?? 3) < 2
  return (
    <>
      <WidgetLabel>Limits</WidgetLabel>
      {/* The rows share the tile's height, so a tall tile has no empty foot. */}
      <ul className="flex min-h-0 flex-1 flex-col justify-around gap-1.5">
        {limits.map((r) => {
          // What is LEFT is the question ("how much more"); the bar shows what is used.
          const left = (r.detail?.find((d) => d.label === "Remaining")?.value ?? "").replace(/h$/, "")
          const fraction = Math.min(1, Math.max(0, r.progress ?? 0))
          const fill = r.state === "ok" ? "bg-muted-foreground" : REQ_TONE[r.state].fill
          return (
            <li key={r.id} className="text-[11px] leading-none">
              <span className="flex items-baseline justify-between gap-1">
                <span className="truncate text-muted-foreground" data-morph={`lim-name-${r.id}`}>
                  {r.label}
                </span>
                <span className="shrink-0 tabular-nums" data-morph={`lim-left-${r.id}`}>
                  <span className={cn("font-semibold", r.state === "ok" ? "text-foreground" : REQ_TONE[r.state].icon)}>{left}h</span>
                  {!narrow && <span className="text-muted-foreground"> left</span>}
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" data-morph={`lim-bar-${r.id}`} data-morph-stretch>
                <span className={cn("block h-full rounded-full", fill)} style={{ width: `${fraction * 100}%` }} />
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
