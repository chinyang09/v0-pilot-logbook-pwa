"use client"

/**
 * What each widget's card holds under its face — and what it can DO.
 *
 * The rule (the owner, Nov 2026: "let users understand more with less
 * words"): a body is FIGURES and SHORT ROWS — a label/value grid like the
 * flight card's preview, rows a tap opens, chips for a state — never a
 * sentence, a section heading or a disclosure. Anything the face already says
 * is not said again. What can be done is an action circle, not a row.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { dutyWindow, formatDutyClock, formatRestSpan } from "@/lib/utils/dashboard/duty-status"
import type { Requirement } from "@/lib/utils/dashboard/legality"
import { cn } from "@/lib/utils"
import { formatDay } from "@/lib/utils/date"
import { REQ_TONE } from "./instruments"
import { fdpMinutesOf } from "@/lib/utils/roster/fdp-calculator"
import { PIC_FDP_DISCRETION_MIN } from "@/lib/utils/roster/regulation-definitions"
import { CardTable, FlightCardLegs, crewKey, crewRole, currenciesBySoonest, currencyRows, legNow, limitsOf, marginText, marginTone, shortDay, shortName } from "./faces"
import { CurrencyDots } from "./currency-dots"
import { dotAt, dotLayout, localDayKey } from "@/lib/utils/dashboard/currency-dots"
import { AirportBody } from "./airport-tile"
import type { FlightBrief } from "./model"
import { pageOf } from "./pager"
import { briefingId } from "@/lib/briefing/ids"
import { SheetClosingContext, type WidgetAction, type WidgetId } from "./widget"

export const WIDGET_TITLE: Record<WidgetId, string> = {
  duty: "Duty",
  flight: "Flight & Crew",
  airport: "Airport & Weather",
  currency: "Currency",
  limits: "Limits",
}

/* ── Building blocks ─────────────────────────────────────────────────────── */

/** A figure under its label — the preview's grid cell. */
function Fig({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "over" | "ok" }) {
  return (
    <div className="min-w-0 py-1">
      <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "truncate text-[15px] font-semibold tabular-nums",
          tone === "over" ? "text-destructive" : "text-foreground",
        )}
        suppressHydrationWarning
      >
        {value}
      </p>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4">{children}</div>
}

/** A row a tap opens — one line, its figure on the right. */
function TapRow({
  onClick,
  lead,
  title,
  sub,
  right,
}: {
  onClick?: () => void
  lead?: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  right?: React.ReactNode
}) {
  const Box = onClick ? "button" : "div"
  return (
    <Box
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left",
        onClick && "-mx-1.5 px-1.5 transition-colors active:bg-muted/60",
      )}
    >
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-foreground">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground" suppressHydrationWarning>{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground" suppressHydrationWarning>{right}</span>}
    </Box>
  )
}

/** "WL" — a crew member's initials, the avatar a contacts list draws. */
function Initials({ name, morph }: { name: string; morph?: string }) {
  const parts = shortName(name).split(/\s+/).filter(Boolean)
  const text = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground" data-morph={morph}>
      {text || "?"}
    </span>
  )
}

/* ── Bodies ──────────────────────────────────────────────────────────────── */

export interface WidgetCtx {
  openFlight: (id: string) => void
  go: (href: string) => void
  /** Make the dashboard about the duty reporting at `atMs`. */
  selectDuty?: (atMs: number) => void
}

/**
 * A widget's body and its actions. A body of `null` leaves the card its face
 * — nothing more to say is better than saying it again.
 */
export function widgetContent(
  id: WidgetId,
  brief: FlightBrief,
  ctx: WidgetCtx,
): {
  body: React.ReactNode | null
  actions: WidgetAction[]
  /**
   * The card keeps the tile's face as its header — or, where the body says
   * all the face did and more (a narrow tile's list), only the tile's label,
   * so the card does not say each name twice.
   */
  header: "face" | "label"
} {
  const fdp: WidgetAction = { id: "fdp", label: "FDP", run: () => ctx.go(WIDGET_HREF.duty!) }
  switch (id) {
    case "duty":
      return { header: "face", body: dutyRows(brief).length ? <DutyBody brief={brief} /> : null, actions: [fdp] }
    case "flight": {
      const legs = brief.duty.legs
      return {
        header: "label",
        body: <FlightBody brief={brief} ctx={ctx} />,
        // Each leg opens from its own row; what to DO is ask again, and read
        // the briefing of the leg the tile is on.
        actions: [
          ...(legs.length && brief.duty.lookups
            ? [
                {
                  id: "refresh",
                  label: "Refresh",
                  icon: <RefreshCw className={cn("h-3.5 w-3.5", brief.duty.lookupsLoading && "animate-spin")} aria-hidden />,
                  run: brief.duty.refreshLookups,
                  stay: true,
                  busy: brief.duty.lookupsLoading,
                },
              ]
            : []),
          ...(legs.some((l) => l.flightNumber)
            ? [
                {
                  id: "briefing",
                  label: "Briefing",
                  run: () => {
                    const at = pageOf(`flight:${brief.duty.atMs}`) ?? legNow(brief)
                    const f = legs[Math.min(Math.max(0, at), legs.length - 1)]
                    ctx.go(f.flightNumber ? `/briefing?id=${encodeURIComponent(briefingId(f.flightNumber, f.date, f.departureIcao || ""))}` : "/briefing")
                  },
                },
              ]
            : []),
        ],
      }
    }
    case "airport":
      return {
        header: "label",
        body: <AirportBody brief={brief} openFlight={ctx.openFlight} />,
        actions: brief.weather.asked
          ? [
              {
                id: "refresh",
                label: "Refresh",
                icon: <RefreshCw className={cn("h-3.5 w-3.5", brief.weather.refreshing && "animate-spin")} aria-hidden />,
                run: brief.weather.refresh,
                stay: true,
                busy: brief.weather.refreshing,
              },
            ]
          : [],
      }
    case "currency":
      return {
        header: "label",
        body: <CurrencyBody brief={brief} />,
        actions: [{ id: "cur", label: "Currencies", run: () => ctx.go(WIDGET_HREF.currency!) }],
      }
    case "limits":
      return { header: "face", body: <LimitsBody brief={brief} />, actions: [fdp] }
  }
}

/** The section each card's footer leads to — warmed when the card opens (`prefetchSection`). */
export const WIDGET_HREF: Partial<Record<WidgetId, string>> = { duty: "/fdp", limits: "/fdp", currency: "/currencies" }

/** The navigation every body needs, bound to the app's router and panel. */
export function useWidgetCtx(): Omit<WidgetCtx, "selectDuty"> & { prefetchSection: (id: WidgetId) => void } {
  const router = useRouter()
  const { setSelectedId } = useDetailPanel()
  return React.useMemo(
    () => ({
      openFlight: (id) => setSelectedId(id),
      go: (href) => router.push(href),
      // The card's footer link, fetched while the card is read: tapped, the
      // page is already here, so the card fades straight onto it.
      prefetchSection: (id) => {
        const href = WIDGET_HREF[id]
        if (href) router.prefetch(href)
      },
    }),
    [router, setSelectedId],
  )
}

/** A row of the duty card's table. */
interface DutyRow {
  label: string
  value: string
  /** A smaller line under the value (the rest's minimum, the day). */
  sub?: string
  tone?: "fail" | "caution"
  /** The face's figure this row's value is — it flies there from the tile (`slot-<n>-v`). */
  slot?: number
}

const MIN_MS = 60_000

/**
 * The duty card's rows, in the order the day RUNS (the owner, Nov 2026: "2
 * columns, left are headers, right are values. In chronological order"):
 * the duty rested from, the rest before the report (FORECAST to it, not as of
 * now), the report, the scheduled IN that ends the FDP and the FDP itself,
 * then where the duty is actually heading — the ESTIMATED IN, from what the
 * logbook recorded and the sources say now — against the latest IN its
 * maximum allows, and past that the commander's discretion (para 13: up to
 * 3:00, on the day, reported) with the IN it reaches. The face's three
 * figures are rows here, and fly into them.
 */
export function dutyRows(brief: FlightBrief): DutyRow[] {
  const { status, duty, clock, day } = brief
  const { phase, active, next, lastDuty, rest } = status.duty
  const lastArrive = duty.times.reduce<number | null>((m, t) => (t.arriveMs !== null && (m === null || t.arriveMs > m) ? t.arriveMs : m), null)
  const span = (min: number) => formatDutyClock(Math.max(0, Math.round(min)))
  /** Scheduled IN, then the FDP row the caller hands in. */
  const head = (schedInMs: number, fdp: DutyRow[]): DutyRow[] => [{ label: "Scheduled IN", value: clock(schedInMs) }, ...fdp]
  /** Estimated IN → latest IN → discretion → its IN. */
  const tail = (fdpStartMs: number, schedInMs: number, maxMin: number, latestSlot?: number): DutyRow[] => {
    const latest = maxMin > 0 ? fdpStartMs + maxMin * MIN_MS : null
    const rows: DutyRow[] = []
    const est = estimateRow(brief, schedInMs, latest)
    if (est) rows.push(est)
    if (latest === null) return rows
    const estMs = duty.estimate?.ms ?? schedInMs
    const room = (latest - estMs) / MIN_MS
    rows.push({ label: "Latest IN", value: clock(latest), sub: "FDP maximum", slot: latestSlot })
    // Past it, only the commander's discretion — on the day, for the
    // unforeseen, and the company's approval asked (the owner: "flag to
    // request for approval as per fifth schedule").
    rows.push({
      label: "Further Delay",
      value: `+${span(PIC_FDP_DISCRETION_MIN)} max`,
      sub: "Request approval · para 13",
      tone: room < 0 ? "fail" : room < 60 ? "caution" : undefined,
    })
    rows.push({ label: "Waiver Max IN", value: clock(latest + PIC_FDP_DISCRETION_MIN * MIN_MS), sub: "With PIC discretion" })
    return rows
  }
  const fdpRow = (planned: number, max: number, slot?: number): DutyRow => ({
    label: "FDP",
    value: planned > 0 ? `${formatDutyClock(planned)}${max > 0 ? ` / ${formatDutyClock(max)}` : ""}` : "—",
    sub: "Scheduled / max",
    tone: max > 0 && planned > max ? "fail" : undefined,
    slot,
  })
  const last: DutyRow[] = lastDuty
    ? [{ label: "Last Duty", value: lastDuty.route || formatDutyClock(lastDuty.elapsedMinutes), sub: `Off ${clock(lastDuty.debriefMs)} · ${day(lastDuty.debriefMs)}` }]
    : []

  /* A later duty, chosen in the header. */
  if (duty.index > 0 && duty.period) {
    const dp = duty.period
    const w = dutyWindow(dp)
    if (!w) return []
    const planned = fdpMinutesOf(dp)
    const r = dp.restBefore
    const schedIn = w.startMs + planned * MIN_MS
    return [
      ...(r
        ? [{ label: "Rest", value: formatRestSpan(r.restMinutes), sub: `Min ${formatDutyClock(r.requiredRestMinutes)}`, tone: r.compliant ? undefined : ("fail" as const), slot: 0 }]
        : []),
      { label: "Report", value: clock(w.startMs), sub: day(w.startMs), slot: 1 },
      ...head(schedIn, [fdpRow(planned, dp.maxFdpMinutes, 2)]),
      ...tail(w.startMs, schedIn, dp.maxFdpMinutes),
    ]
  }

  /* On duty: the report as it was, the FDP so far. */
  if (phase === "on_duty" && active) {
    if (active.maxFdpMinutes <= 0) return []
    const fdpOpen = active.startMs - (active.fdpElapsedMinutes - active.elapsedMinutes) * MIN_MS
    const left = active.maxFdpMinutes - active.fdpElapsedMinutes
    const schedIn = lastArrive ?? active.endMs
    return [
      { label: "Report", value: clock(active.startMs), sub: day(active.startMs) },
      ...head(schedIn, [
        { label: "FDP", value: `${formatDutyClock(active.fdpElapsedMinutes)} / ${formatDutyClock(active.maxFdpMinutes)}`, sub: "So far / max", tone: active.exceeded ? "fail" : undefined, slot: 1 },
        { label: active.exceeded ? "FDP Over" : "FDP Left", value: span(Math.abs(left)), tone: active.exceeded ? "fail" : undefined, slot: 0 },
      ]),
      ...tail(fdpOpen, schedIn, active.maxFdpMinutes, 2),
    ]
  }

  /* Off duty, the next duty ahead: its rest worked back from its report. */
  if (next && next.restRequiredMinutes > 0) {
    const short = next.legalAtReport === false
    const schedIn = next.reportMs + next.plannedFdpMinutes * MIN_MS
    return [
      ...last,
      {
        label: "Rest",
        value: formatRestSpan(next.restAvailableMinutes),
        sub: `To report · min ${next.restMinimum || formatDutyClock(next.restRequiredMinutes)}`,
        tone: short ? "fail" : undefined,
        slot: 0,
      },
      { label: "Report", value: clock(next.reportMs), sub: day(next.reportMs), slot: 1 },
      ...(next.plannedFdpMinutes > 0
        ? [...head(schedIn, [fdpRow(next.plannedFdpMinutes, next.maxFdpMinutes, 2)]), ...tail(next.reportMs, schedIn, next.maxFdpMinutes)]
        : [fdpRow(0, next.maxFdpMinutes, 2)]),
    ]
  }

  /* Off duty, nothing ahead: the rest so far, and when it is legal. */
  if (rest) {
    const legal = Date.parse(rest.legalAtUtc)
    return [
      ...last,
      { label: "Rest", value: formatRestSpan(rest.elapsedMinutes), sub: "So far", slot: 0 },
      ...(rest.isLegalNow || !Number.isFinite(legal) ? [] : [{ label: "Legal From", value: clock(legal), slot: 1 }]),
    ]
  }
  return last
}

/**
 * The ESTIMATED IN row: the duty's last on-blocks as the logbook and the
 * sources have it now — how late against the schedule, and how much of the
 * maximum is left after it. Red past the latest IN, amber within the hour.
 */
export function estimateRow(brief: FlightBrief, schedInMs: number, latestMs: number | null): DutyRow | null {
  const e = brief.duty.estimate
  if (!e) return null
  const late = e.delayMin ?? Math.round((e.ms - schedInMs) / MIN_MS)
  const room = latestMs === null ? null : Math.round((latestMs - e.ms) / MIN_MS)
  const delay =
    e.kind === "actual" ? "On blocks" : late >= 5 ? `${formatDutyClock(late)} late` : late <= -5 ? `${formatDutyClock(-late)} early` : "On time"
  // Nothing asked of the sources yet (more than 18h out): it is the schedule.
  const basis = e.kind === "scheduled" && !brief.duty.lookups ? "As scheduled" : delay
  const margin = room === null ? null : room < 0 ? `${formatDutyClock(-room)} past latest` : `${formatDutyClock(room)} to latest`
  return {
    label: e.kind === "actual" ? "Actual IN" : "Estimated IN",
    value: brief.clock(e.ms),
    sub: [basis, margin].filter(Boolean).join(" · "),
    tone: room === null ? undefined : room < 0 ? "fail" : room < 60 ? "caution" : undefined,
  }
}

/**
 * The duty card's body: `dutyRows` as a two-column table — what it is on the
 * left, its value on the right, read top to bottom as the day runs.
 */
function DutyBody({ brief }: { brief: FlightBrief }) {
  const rows = dutyRows(brief)
  return (
    <CardTable
      rows={rows.map((r) => ({ label: r.label, value: r.value, sub: r.sub, tone: r.tone, morph: r.slot !== undefined ? `slot-${r.slot}-v` : undefined }))}
    />
  )
}

/**
 * The flights card: the duty on its day, a leg a page — the leg's own table
 * and a row that opens it, the dots under them (`FlightCardLegs`) — then the
 * crew, flight and cabin.
 */
function FlightBody({ brief, ctx }: { brief: FlightBrief; ctx: WidgetCtx }) {
  return (
    <div>
      <FlightCardLegs brief={brief} openFlight={ctx.openFlight} />
      {/* The crew is part of this card (the owner's duty-and-crew widget). */}
      {brief.crew.length > 0 && (
        <div className="mt-2 border-t border-border/70 pt-1">
          <CrewBody brief={brief} go={ctx.go} />
        </div>
      )}
    </div>
  )
}

/** Who, and when last together — a tap opens their card. */
function CrewBody({ brief, go }: { brief: FlightBrief; go: (href: string) => void }) {
  return (
    <div>
      {brief.crew.map((m, i) => (
        <React.Fragment key={m.personId ?? `${m.cabin ? "cabin" : "crew"}:${m.name}`}>
        {/* The cabin, after the flight crew, under a caption of its own. */}
        {m.cabin && !brief.crew[i - 1]?.cabin && (
          <p className="mt-2 border-t border-border/70 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Cabin</p>
        )}
        <TapRow
          key={m.personId ?? m.name}
          onClick={m.personId ? () => go(`/crew?selected=${m.personId}`) : undefined}
          // The tile's initials and name fly into these (shared morph).
          lead={<Initials name={m.name} morph={`crew-ini-${crewKey(m)}`} />}
          title={<span data-morph={`crew-name-${crewKey(m)}`}>{m.name}</span>}
          sub={
            <>
              <span data-morph={`crew-role-${crewKey(m)}`}>{crewRole(m.role, brief.authority)}</span>
              {m.count ? ` · ${m.count} together` : null}
            </>
          }
          right={<span data-morph={`crew-last-${crewKey(m)}`}>{m.last ? shortDay(m.last.date) : "New"}</span>}
        />
        </React.Fragment>
      ))}
    </div>
  )
}

/**
 * The Currencies page, brought to the card: 90-day recency first (it is the
 * one that usually binds — both halves and the day it lapses), sectors not
 * logged, then every document as the page groups them — what needs
 * attention, then what is current, soonest first. ONE line each: the name,
 * the expiry date, the days left, and a flag after it only when there is one
 * (the owner: no gutter of empty icons, and a shorter card). A tap selects it
 * on the dots, a second deselects; the Currencies page is the footer's link.
 */
function CurrencyBody({ brief }: { brief: FlightBrief }) {
  const logbook = brief.status.legality.requirements.filter((r) => r.group === "currency" && !r.id.startsWith("doc-"))
  const { attention, current } = brief.currency
  // The year ahead as dots, every expiry ink — a tap on a dot or a row
  // SELECTS its currency (the one dot in colour, the days up to it lit in
  // turn), a second tap deselects. The Currencies page is the footer's.
  const [chosen, setSelected] = React.useState<string | null>(null)
  // Closing, nothing is selected: the morph then copies a calendar at rest.
  const selected = React.useContext(SheetClosingContext) ? null : chosen
  const toggle = (key: string) => setSelected((s) => (s === key ? null : key))
  // The day the dots start: a later duty's, as the rows are forecast to it.
  const today = localDayKey(brief.currencyAsOfMs)
  const dated = React.useMemo(() => {
    const layout = dotLayout(today, "1y")
    return currenciesBySoonest(currencyRows(brief)).filter((r) => r.ymd !== null && dotAt(layout, r.ymd) !== null)
  }, [brief, today])
  if (logbook.length === 0 && attention.length === 0 && current.length === 0) return null
  const tone = (state: Requirement["state"]) => (state === "ok" ? "text-foreground" : REQ_TONE[state].icon)
  const row = (key: string, name: string, sub: string, figure: string, state: Requirement["state"]) => {
    const isSel = selected === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={isSel}
        onClick={() => toggle(key)}
        className={cn(
          "-mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-2 rounded-md px-1 py-1 text-left transition-[opacity,background-color] active:bg-muted/60",
          isSel && "bg-muted",
          selected !== null && !isSel && "opacity-35",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground" data-morph={`cur-name-${key}`}>
          {name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" suppressHydrationWarning>{sub}</span>
        <span className={cn("w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums", tone(state))}>
          <span data-morph={`cur-fig-${key}`}>{figure}</span>
        </span>
      </button>
    )
  }
  const recencyRows = currencyRows(brief).filter((r) => !r.key.startsWith("doc-"))
  const forecast = brief.currencyAsOfMs !== brief.now
  return (
    <div>
      {/* A later duty: every figure below is as it will stand on its day. */}
      {forecast && (
        <p className="mb-1.5 text-xs text-muted-foreground" suppressHydrationWarning>
          As at {formatDay(today)}
        </p>
      )}
      {dated.length > 0 && (
        <div data-morph="cur-dots">
        <CurrencyDots
          today={today}
          ahead="1y"
          marks={dated.map((r) => ({ key: r.key, name: r.name, state: r.state, ymd: r.ymd! }))}
          closest={dated[0]?.key ?? null}
          selected={selected}
          onSelect={setSelected}
          className="mb-2"
        />
        </div>
      )}
      {logbook.map((r) => {
        const shown = recencyRows.find((x) => x.key === r.id)
        // Recency: both halves, and when it lapses; not logged: which sectors.
        const sub =
          (r.detail ?? [])
            .filter((d) => d.label !== "Status")
            .map((d) =>
              r.id === "recency"
                ? d.label === "Lapses"
                  ? `to ${d.value}`
                  : `${d.label === "Takeoffs" ? "T/O" : "LDG"} ${d.value.split(" / ")[0]}`
                : d.value,
            )
            .join(" · ") || ""
        return row(r.id, shown?.name ?? r.label, sub, shown ? shown.figure.split(" · ")[0] : r.value, shown?.state ?? r.state)
      })}
      {[...attention, ...current].map((l, i) =>
        <div key={l.id} className={cn(i === 0 && logbook.length > 0 && "mt-1 border-t border-border/70 pt-1")}>
          {row(
            `doc-${l.id}`,
            l.name,
            // With its year: a licence valid to 2030 is not "1 Jun".
            l.lapsesBeforeDuty ? "before duty" : formatDay(l.expiryDate, { weekday: false }),
            l.figure,
            l.state,
          )}
        </div>,
      )}
    </div>
  )
}

/**
 * The limits, as the margins a delay eats into: the chosen duty's FDP and
 * every rolling window that holds it (its rostered successors counted), the
 * smallest first — the face's "Delay" is the first of them — and a breach the
 * roster runs into further ahead.
 */
function LimitsBody({ brief }: { brief: FlightBrief }) {
  const m = brief.margin
  const breaches = limitsOf(brief).filter((r) => r.detail?.some((d) => d.label === "Forecast"))
  return (
    <div>
      {m ? (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">If This Duty Runs Late</p>
          <Grid>
            {m.each.filter((e) => e.limit !== "FDP").map((e) => (
              <Fig key={e.limit} label={e.limit} value={<span className={marginTone(e.minutes)}>+{marginText(e.minutes)}</span>} />
            ))}
          </Grid>
        </>
      ) : (
        <p className="py-1 text-[13px] text-muted-foreground">No duty ahead to measure</p>
      )}
      {breaches.length > 0 && (
        <p className="mt-1.5 border-t border-border/70 pt-1.5 text-[13px] font-semibold text-destructive">
          Breach ahead · {breaches.map((r) => r.label).join(", ")}
        </p>
      )}
    </div>
  )
}
