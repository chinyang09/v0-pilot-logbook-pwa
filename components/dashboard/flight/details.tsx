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
import { Plane, PlaneLanding, RefreshCw } from "lucide-react"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { dutyWindow, formatDutyClock, formatRestSpan } from "@/lib/utils/dashboard/duty-status"
import { gateLabel } from "@/lib/utils/dashboard/duty-line"
import { whereaboutsLines } from "@/lib/lookup/aircraft-whereabouts"
import type { Requirement } from "@/lib/utils/dashboard/legality"
import { cn } from "@/lib/utils"
import { formatDay } from "@/lib/utils/date"
import { REQ_TONE, STATE_ICON } from "./instruments"
import { destinationsOf, limitsOf, shortDay, shortName } from "./faces"
import { WeatherBody } from "./weather"
import { AirportPanel } from "./airport"
import type { FlightBrief } from "./model"
import type { WidgetAction, WidgetId } from "./widget"

export const WIDGET_TITLE: Record<WidgetId, string> = {
  duty: "Duty & Rest",
  flight: "Flights",
  weather: "Weather",
  crew: "Crew",
  destination: "Destination",
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
function Initials({ name }: { name: string }) {
  const parts = shortName(name).split(/\s+/).filter(Boolean)
  const text = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
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
  const fdp: WidgetAction = { id: "fdp", label: "FDP", run: () => ctx.go("/fdp") }
  switch (id) {
    case "duty":
      return { header: "face", body: hasDutyBody(brief) ? <DutyBody brief={brief} /> : null, actions: [fdp] }
    case "flight": {
      const legs = brief.duty.legs
      return {
        header: "face",
        body: legs.length ? <FlightBody brief={brief} ctx={ctx} /> : null,
        // Each leg opens from its own row; the one thing to DO is ask again.
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
        ],
      }
    }
    case "weather":
      return {
        header: "label",
        body: <WeatherBody weather={brief.weather} code={brief.code} clock={brief.clock} now={brief.now} />,
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
    case "crew":
      return {
        header: brief.crew.length ? "label" : "face",
        body: brief.crew.length ? <CrewBody brief={brief} go={ctx.go} /> : null,
        actions: [{ id: "crew", label: "Crew", run: () => ctx.go("/crew") }],
      }
    case "destination":
      return {
        header: destinationsOf(brief).length ? "label" : "face",
        body: destinationsOf(brief).length ? <DestinationBody brief={brief} openFlight={ctx.openFlight} /> : null,
        actions: [],
      }
    case "currency":
      return {
        header: "label",
        body: <CurrencyBody brief={brief} go={ctx.go} />,
        actions: [{ id: "cur", label: "Currencies", run: () => ctx.go("/currencies") }],
      }
    case "limits":
      return { header: "face", body: <LimitsBody brief={brief} />, actions: [fdp] }
  }
}

/** The navigation every body needs, bound to the app's router and panel. */
export function useWidgetCtx(): Omit<WidgetCtx, "selectDuty"> {
  const router = useRouter()
  const { setSelectedId } = useDetailPanel()
  return React.useMemo(() => ({ openFlight: (id) => setSelectedId(id), go: (href) => router.push(href) }), [router, setSelectedId])
}

/** Anything the duty card's face does not already say. */
function hasDutyBody(brief: FlightBrief): boolean {
  const { phase, active, rest, lastDuty } = brief.status.duty
  if (phase === "on_duty" && active) return active.maxFdpMinutes > 0
  return !!rest || !!lastDuty
}

/**
 * What the duty card's face has no room for — never a figure it already
 * shows. On duty: the latest the last leg may block in, and when the duty
 * ends. Off duty: how long rested so far, and the duty rested from.
 */
function DutyBody({ brief }: { brief: FlightBrief }) {
  const { status, clock, day } = brief
  const { active, rest, lastDuty } = status.duty
  if (status.duty.phase === "on_duty" && active) {
    if (active.maxFdpMinutes <= 0) return null
    const fdpOpenMs = active.startMs - (active.fdpElapsedMinutes - active.elapsedMinutes) * 60_000
    return (
      <Grid>
        <Fig label="Latest On-Blocks" value={clock(fdpOpenMs + active.maxFdpMinutes * 60_000)} />
        <Fig label="Off Duty" value={clock(active.debriefMs)} />
      </Grid>
    )
  }
  return (
    <Grid>
      {rest && <Fig label="Rested" value={formatRestSpan(rest.elapsedMinutes)} />}
      {lastDuty && (
        <Fig label={`Last Duty · ${day(lastDuty.debriefMs)}`} value={lastDuty.route || formatDutyClock(lastDuty.elapsedMinutes)} />
      )}
    </Grid>
  )
}

/**
 * The chosen duty: its figures (what its face does not say), each leg a row a
 * tap opens, and the aeroplane coming in. The duty is chosen on the tile's
 * own date line, not here.
 */
function FlightBody({ brief, ctx }: { brief: FlightBrief; ctx: WidgetCtx }) {
  const { duty, code, clock, day } = brief
  const w = duty.period ? dutyWindow(duty.period) : null
  const inbound = duty.lookups?.inbound
  const lines =
    inbound?.status === "done" ? whereaboutsLines(inbound.whereabouts, brief.now, brief.display?.clockSeparator) : null
  return (
    <div>
      {w && (
        <Grid>
          {/* The next duty's report is the duty card's; a later one's is new here. */}
          {w && duty.index > 0 && <Fig label="Report" value={clock(w.startMs)} />}
          {w && <Fig label="Off Duty" value={clock(w.endMs)} />}
        </Grid>
      )}
      {duty.legs.length > 0 && (
        <div className={cn(w && "mt-1.5 border-t border-border/70 pt-1")}>
          {duty.legs.map((f, i) => {
            const g = duty.lookups?.gates[f.id]
            const done = g?.status === "done" ? g.gates : null
            const dep = done ? gateLabel(done.departure.gate, done.departure.terminal, done.departure.stand) : ""
            const arr = done ? gateLabel(done.arrival.gate, done.arrival.terminal, done.arrival.stand) : ""
            return (
              <TapRow
                key={f.id}
                onClick={() => ctx.openFlight(f.id)}
                lead={<Plane className={cn("h-4 w-4 shrink-0", f.inTime ? "text-foreground" : "text-muted-foreground")} aria-hidden />}
                title={
                  <>
                    {f.flightNumber || "Flight"}{" "}
                    <span className="font-normal text-muted-foreground">
                      {code(f.departureIcao, f.departureIata)} → {code(f.arrivalIcao, f.arrivalIata)}
                    </span>
                  </>
                }
                sub={
                  [
                    dep || arr ? `Gate ${dep || "–"} → ${arr || "–"}` : null,
                    // The airport names the flight the aeroplane comes in on.
                    done?.inboundFlight ? `Inbound ${done.inboundFlight}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                // The times are on the chain above; the row adds the tail.
                right={f.aircraftReg || undefined}
              />
            )
          })}
          {lines && (
            // The aeroplane coming in: which flight, its STD, where it is,
            // and the gate it arrives at — the gate means little apart from
            // the flight it belongs to.
            <TapRow
              lead={<PlaneLanding className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
              title={
                <>
                  {lines.flight} <span className="font-normal text-muted-foreground">{duty.lookups?.inboundRegistration}</span>
                </>
              }
              sub={[lines.std, lines.primary].filter(Boolean).join(" · ")}
              right={lines.gate || undefined}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** Who, and when last together — a tap opens their card. */
function CrewBody({ brief, go }: { brief: FlightBrief; go: (href: string) => void }) {
  return (
    <div>
      {brief.crew.map((m) => (
        <TapRow
          key={m.personId ?? m.name}
          onClick={m.personId ? () => go(`/crew?selected=${m.personId}`) : undefined}
          lead={<Initials name={m.name} />}
          title={m.name}
          sub={[m.role, m.count ? `${m.count} together` : null].filter(Boolean).join(" · ")}
          right={m.last ? shortDay(m.last.date) : "New"}
        />
      ))}
    </div>
  )
}

/**
 * Each destination as a picture of its weather and the wind on its runway
 * (`AirportPanel`), with when last there under it.
 */
function DestinationBody({ brief, openFlight }: { brief: FlightBrief; openFlight: (id: string) => void }) {
  return (
    <div className="divide-y divide-border/70">
      {destinationsOf(brief).map((d) => {
        const metar = brief.weather.briefs.find((b) => b.station === d.icao)?.metar ?? null
        const arrival = brief.duty.times.find((t) => t.arrivalIcao === d.icao)?.arriveMs ?? null
        const lastLine = [d.last ? `Last there ${shortDay(d.last.date)}` : "First time", d.year ? `${d.year}× this year` : null]
          .filter(Boolean)
          .join(" · ")
        return (
          <AirportPanel
            key={d.icao}
            icao={d.icao}
            code={brief.code(d.icao)}
            airport={brief.airports.get(d.icao)}
            metar={metar}
            arrivalMs={arrival}
            weatherAsked={brief.weather.asked}
            lastLine={lastLine}
            onLast={d.last ? () => openFlight(d.last!.flightId) : undefined}
          />
        )
      })}
    </div>
  )
}

/**
 * The Currencies page, brought to the card: the logbook's own requirements
 * first (90-day recency, sectors not logged), then every document as the page
 * groups them — what needs attention, then what is current, soonest first —
 * by name, with its expiry date and days left. A document that lapses before
 * the chosen duty says so. A tap opens it on the Currencies page.
 */
function CurrencyBody({ brief, go }: { brief: FlightBrief; go: (href: string) => void }) {
  const logbook = brief.status.legality.requirements.filter((r) => r.group === "currency" && !r.id.startsWith("doc-"))
  const { attention, current } = brief.currency
  if (logbook.length === 0 && attention.length === 0 && current.length === 0) return null
  const figure = (state: Requirement["state"], text: string) => (
    <span className={cn("font-semibold", state === "ok" ? "text-foreground" : REQ_TONE[state].icon)}>{text}</span>
  )
  // Dark cockpit: a met requirement draws no icon, only its place in the row.
  const lead = (state: Requirement["state"]) => {
    if (state === "ok") return <span className="w-4 shrink-0" aria-hidden />
    const Icon = STATE_ICON[state]
    return <Icon className={cn("h-4 w-4 shrink-0", REQ_TONE[state].icon)} aria-hidden />
  }
  const groups = [attention, current].filter((g) => g.length > 0)
  return (
    <div>
      {logbook.map((r) => (
        <TapRow
          key={r.id}
          onClick={r.href ? () => go(r.href) : undefined}
          lead={lead(r.state)}
          title={r.label}
          // Recency: both halves, and when it lapses; not logged: which sectors.
          sub={
            (r.detail ?? [])
              .filter((d) => d.label !== "Status")
              .map((d) => (r.id === "recency" ? `${d.label} ${d.value.replace(/ \/ /g, "/")}` : d.value))
              .join(" · ") || undefined
          }
          right={figure(r.state, r.value)}
        />
      ))}
      {groups.map((group, gi) => (
        <div key={gi} className={cn((logbook.length > 0 || gi > 0) && "mt-1 border-t border-border/70 pt-1")}>
          {group.map((l) => (
            <TapRow
              key={l.id}
              onClick={() => go(`/currencies?selected=${encodeURIComponent(l.id)}`)}
              lead={lead(l.state)}
              title={l.name}
              // With its year: a licence valid to 2030 is not "1 Jun".
              sub={[`Expires ${formatDay(l.expiryDate, { weekday: false })}`, l.lapsesBeforeDuty ? "before this duty" : null].filter(Boolean).join(" · ")}
              right={figure(l.state, l.figure)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Each limit: the hours left in it — and "Breach ahead" where the roster runs past it. */
function LimitsBody({ brief }: { brief: FlightBrief }) {
  return (
    <Grid>
      {limitsOf(brief).map((r) => {
        const left = r.detail?.find((d) => d.label === "Remaining")?.value
        const breach = r.detail?.some((d) => d.label === "Forecast")
        return (
          <Fig
            key={r.id}
            label={`${r.label} left`}
            value={breach ? "Breach ahead" : (left ?? r.value)}
            tone={r.state === "fail" || breach ? "over" : undefined}
          />
        )
      })}
    </Grid>
  )
}
