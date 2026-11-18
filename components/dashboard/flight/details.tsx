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
import { Moon, Plane, RefreshCw, ShieldCheck, Sun, Timer, Users } from "lucide-react"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { dutyWindow, formatDutyClock, formatRestSpan, restMinimumText } from "@/lib/utils/dashboard/duty-status"
import type { Requirement } from "@/lib/utils/dashboard/legality"
import { isNight } from "@/lib/utils/night-time"
import { hasCoordinates } from "@/lib/utils/flight-calculations"
import { getAirportLocalTime } from "@/lib/db/stores/reference/airports.store"
import { cn } from "@/lib/utils"
import { REQ_TONE, STATE_ICON } from "./instruments"
import { destinationsOf, limitsOf, orderCurrency, shortDay, shortName } from "./faces"
import { WeatherBody } from "./weather"
import type { FlightBrief } from "./model"
import type { WidgetAction, WidgetId } from "./widget"

export const WIDGET_TITLE: Record<WidgetId, string> = {
  status: "Status",
  duty: "Duty",
  flight: "Flights",
  weather: "Weather",
  crew: "Crew",
  destination: "Last There",
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
          tone === "over" ? "text-destructive" : tone === "ok" ? "text-chart-2" : "text-foreground",
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
  const fdp: WidgetAction = { id: "fdp", label: "FDP", icon: <Timer className="h-5 w-5" />, run: () => ctx.go("/fdp") }
  switch (id) {
    case "status":
      return {
        header: "face",
        body: hasMoreFlagged(brief) ? <StatusBody brief={brief} /> : null,
        actions: [{ id: "cur", label: "Currency", icon: <ShieldCheck className="h-5 w-5" />, run: () => ctx.go("/currencies") }, fdp],
      }
    case "duty":
      return { header: "face", body: <DutyBody brief={brief} />, actions: [fdp] }
    case "flight": {
      const legs = brief.duty.legs
      return {
        header: "face",
        body: legs.length ? <FlightBody brief={brief} openFlight={ctx.openFlight} /> : null,
        actions: [
          ...legs.slice(0, 3).map((l) => ({
            id: l.id,
            label: l.flightNumber || "Flight",
            icon: <Plane className="h-5 w-5" />,
            run: () => ctx.openFlight(l.id),
          })),
          ...(legs.length
            ? [
                {
                  id: "refresh",
                  label: "Refresh",
                  icon: <RefreshCw className={cn("h-5 w-5", brief.duty.lookupsLoading && "animate-spin")} />,
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
                icon: <RefreshCw className={cn("h-5 w-5", brief.weather.refreshing && "animate-spin")} />,
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
        actions: [{ id: "crew", label: "Crew", icon: <Users className="h-5 w-5" />, run: () => ctx.go("/crew") }],
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
        body: <CurrencyBody brief={brief} />,
        actions: [{ id: "cur", label: "Currency", icon: <ShieldCheck className="h-5 w-5" />, run: () => ctx.go("/currencies") }],
      }
    case "limits":
      return { header: "face", body: <LimitsBody brief={brief} />, actions: [fdp] }
  }
}

/** The navigation every body needs, bound to the app's router and panel. */
export function useWidgetCtx(): WidgetCtx {
  const router = useRouter()
  const { setSelectedId } = useDetailPanel()
  return React.useMemo(() => ({ openFlight: (id) => setSelectedId(id), go: (href) => router.push(href) }), [router, setSelectedId])
}

function hasMoreFlagged(brief: FlightBrief): boolean {
  const named = new Set([brief.status.governing?.id, brief.status.also[0]?.id].filter(Boolean))
  return brief.status.legality.requirements.some((r) => r.state !== "ok" && !named.has(r.id))
}

/** Everything flagged the face does not already name, worst first. */
function StatusBody({ brief }: { brief: FlightBrief }) {
  // The face already names the governing requirement and the first "Also".
  const named = new Set([brief.status.governing?.id, brief.status.also[0]?.id].filter(Boolean))
  const flagged = brief.status.legality.requirements
    .filter((r) => r.state !== "ok" && !named.has(r.id))
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))
  if (flagged.length === 0) return null
  return (
    <div className="space-y-0.5">
      {flagged.map((r) => (
        <ReqLine key={r.id} requirement={r} />
      ))}
    </div>
  )
}

function ReqLine({ requirement: r }: { requirement: Requirement | null }) {
  if (!r) {
    const Icon = STATE_ICON.ok
    return (
      <p className="flex items-center gap-2 py-1 text-[14px] text-foreground">
        <Icon className={cn("h-4 w-4", REQ_TONE.ok.icon)} aria-hidden /> All met
      </p>
    )
  }
  const Icon = STATE_ICON[r.state]
  return (
    <p className="flex items-center gap-2 py-1 text-[14px]">
      <Icon className={cn("h-4 w-4 shrink-0", REQ_TONE[r.state].icon)} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-foreground">{r.label}</span>
      <span className={cn("shrink-0 font-semibold tabular-nums", REQ_TONE[r.state].icon)}>{r.value}</span>
    </p>
  )
}

/** The figures behind the duty clock, then what comes after it. */
function DutyBody({ brief }: { brief: FlightBrief }) {
  const { status, clock, day, upcoming } = brief
  const { active, next, rest } = status.duty
  const onDuty = status.duty.phase === "on_duty" && active
  return (
    <>
      <Grid>
        {onDuty && active ? (
          active.maxFdpMinutes > 0 ? (
            <>
              <Fig label="FDP" value={`${formatDutyClock(active.fdpElapsedMinutes)} / ${formatDutyClock(active.maxFdpMinutes)}`} tone={active.exceeded ? "over" : undefined} />
              <Fig
                label="Latest On-Blocks"
                value={clock(active.startMs - (active.fdpElapsedMinutes - active.elapsedMinutes) * 60_000 + active.maxFdpMinutes * 60_000)}
              />
              <Fig label="Table" value={[active.fdpTable, `${active.sectorCount} sector${active.sectorCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")} />
              <Fig label="Flight" value={formatDutyClock(active.flightMinutes)} />
            </>
          ) : (
            <Fig label="FDP" value={active.notFdp ? `${active.notFdp} — none` : "—"} />
          )
        ) : (
          <>
            {rest && <Fig label="Legal From" value={rest.isLegalNow ? "Now" : clock(Date.parse(rest.legalAtUtc))} tone={rest.isLegalNow ? "ok" : undefined} />}
            {rest && <Fig label="Minimum" value={restMinimumText(rest)} />}
            {next && <Fig label="Report" value={clock(next.reportMs)} />}
            {next && next.plannedFdpMinutes > 0 && (
              <Fig
                label="Next FDP"
                value={next.maxFdpMinutes > 0 ? `${formatDutyClock(next.plannedFdpMinutes)} / ${formatDutyClock(next.maxFdpMinutes)}` : formatDutyClock(next.plannedFdpMinutes)}
                tone={next.maxFdpMinutes > 0 && next.plannedFdpMinutes > next.maxFdpMinutes ? "over" : undefined}
              />
            )}
          </>
        )}
      </Grid>
      {upcoming.length > 0 && (
        <div className="mt-2 border-t border-border/70 pt-1.5">
          {upcoming.slice(0, 4).map((dp) => {
            const w = dutyWindow(dp)
            return (
              <p key={dp.id} className="flex items-baseline gap-2 py-1 text-[13px]" suppressHydrationWarning>
                <span className="w-24 shrink-0 text-muted-foreground">{w ? day(w.startMs) : dp.date}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{dp.route || dp.dutyKind || "Duty"}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{w ? clock(w.startMs) : ""}</span>
              </p>
            )
          })}
        </div>
      )}
      {!onDuty && rest && !next && (
        <p className="mt-1 text-xs text-muted-foreground" suppressHydrationWarning>
          {formatRestSpan(rest.elapsedMinutes)} rested
        </p>
      )}
    </>
  )
}

/** Each leg on a line — when, gates, aeroplane — a tap opens it. */
function FlightBody({ brief, openFlight }: { brief: FlightBrief; openFlight: (id: string) => void }) {
  const { duty, code, clock } = brief
  return (
    <div>
      {duty.legs.map((f, i) => {
        const t = duty.times[i]
        const g = duty.lookups?.gates[f.id]
        const gates = g?.status === "done" ? [g.gates.departure.gate, g.gates.arrival.gate] : null
        return (
          <TapRow
            key={f.id}
            onClick={() => openFlight(f.id)}
            lead={<Plane className={cn("h-4 w-4 shrink-0", f.inTime ? "text-chart-2" : "text-muted-foreground")} aria-hidden />}
            title={
              <>
                {f.flightNumber || "Flight"}{" "}
                <span className="font-normal text-muted-foreground">
                  {code(f.departureIcao, f.departureIata)} → {code(f.arrivalIcao, f.arrivalIata)}
                </span>
              </>
            }
            sub={[gates && (gates[0] || gates[1]) ? `Gate ${gates[0] || "–"} → ${gates[1] || "–"}` : null, f.aircraftReg].filter(Boolean).join(" · ") || undefined}
            right={
              t && t.departMs !== null
                ? `${clock(t.departMs)}${t.arriveMs !== null ? `–${clock(t.arriveMs)}` : ""}`
                : undefined
            }
          />
        )
      })}

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

/** Each destination: when last there, how often, the time there now, day or night on arrival. */
function DestinationBody({ brief, openFlight }: { brief: FlightBrief; openFlight: (id: string) => void }) {
  return (
    <div>
      {destinationsOf(brief).map((d) => {
        const airport = brief.airports.get(d.icao)
        const arrival = brief.duty.times.find((t) => t.arrivalIcao === d.icao)?.arriveMs ?? null
        const night =
          arrival !== null && airport && hasCoordinates(airport) ? isNight(new Date(arrival), airport.latitude, airport.longitude) : null
        const Arrive = night === null ? null : night ? Moon : Sun
        return (
          <TapRow
            key={d.icao}
            onClick={d.last ? () => openFlight(d.last!.flightId) : undefined}
            lead={
              <span className="w-12 shrink-0 text-[15px] font-semibold tabular-nums text-foreground">{brief.code(d.icao)}</span>
            }
            title={d.last ? shortDay(d.last.date) : "First time"}
            sub={[d.year ? `${d.year}× this year` : null, airport?.tz ? getAirportLocalTime(airport.tz) : null].filter(Boolean).join(" · ") || undefined}
            right={Arrive ? <Arrive className="h-4 w-4" aria-label={night ? "Arrive by night" : "Arrive by day"} /> : undefined}
          />
        )
      })}
    </div>
  )
}

/** Every currency, a cell each: its figure over its name, tinted only when flagged. */
function CurrencyBody({ brief }: { brief: FlightBrief }) {
  const reqs = orderCurrency(brief.status.legality.requirements.filter((r) => r.group === "currency"))
  if (reqs.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-1.5 @[26rem]:grid-cols-3">
      {reqs.map((r) => {
        const Icon = STATE_ICON[r.state]
        const flagged = r.state !== "ok"
        return (
          <div key={r.id} className={cn("min-w-0 rounded-lg px-2 py-1.5", flagged ? REQ_TONE[r.state].track : "bg-muted/40")}>
            <p className="flex items-center gap-1">
              <Icon className={cn("h-3 w-3 shrink-0", REQ_TONE[r.state].icon)} aria-hidden />
              <span className={cn("truncate text-sm font-semibold tabular-nums", flagged ? REQ_TONE[r.state].icon : "text-foreground")}>
                {r.value}
              </span>
            </p>
            <p className="truncate text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{r.label}</p>
          </div>
        )
      })}
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
