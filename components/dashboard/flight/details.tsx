"use client"

/**
 * What each widget opens into — the same body in a phone's sheet and in the
 * detail panel beside a tablet's page. Grouped sections, read-only rows and
 * capsule actions: the app's panels, not a second design.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, DoorOpen, Plane } from "lucide-react"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import { CheckRow } from "@/components/check-row"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { gatesValue } from "@/hooks/use-flight-gates"
import { whereaboutsValue } from "@/hooks/use-aircraft-whereabouts"
import type { GateState } from "@/hooks/use-duty-lookups"
import { inboundLeg } from "@/lib/utils/dashboard/duty-flights"
import { formatDutyClock, formatRestSpan } from "@/lib/utils/dashboard/duty-status"
import { dutyWindow } from "@/lib/utils/dashboard/duty-status"
import type { Requirement, RequirementState } from "@/lib/utils/dashboard/legality"
import { isNight } from "@/lib/utils/night-time"
import { hasCoordinates } from "@/lib/utils/flight-calculations"
import { getAirportLocalTime } from "@/lib/db/stores/reference/airports.store"
import { cn } from "@/lib/utils"
import { REQ_TONE, STATE_ICON } from "./instruments"
import { destinationsOf, limitsOf, orderCurrency, shortDay, shortName } from "./faces"
import { WeatherDetail } from "./weather"
import type { FlightBrief } from "./model"
import type { WidgetId } from "./widget"

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

const STATE_WORD: Record<RequirementState, string> = { ok: "Current", caution: "Caution", fail: "Not met", unknown: "Unknown" }

/** Where a link goes, in words. */
function destinationLabel(href: string): string {
  if (href.includes("selected=")) return "Open Flight"
  if (href.startsWith("/currencies")) return "Open Currencies"
  if (href.startsWith("/logbook")) return "Open Logbook"
  if (href.startsWith("/fdp")) return "Open FDP"
  return "Open"
}

/**
 * A widget's body. `onNavigate` runs before a link is followed — a phone's
 * sheet closes first, so the back gesture does not have to undo it.
 */
export function WidgetDetail({
  id,
  brief,
  onNavigate,
}: {
  id: WidgetId
  brief: FlightBrief
  onNavigate: (go: () => void) => void
}) {
  const router = useRouter()
  const { setSelectedId } = useDetailPanel()
  const go = (href: string) => onNavigate(() => router.push(href))
  const openFlight = (flightId: string) => onNavigate(() => setSelectedId(flightId))
  switch (id) {
    case "status":
      return <StatusDetail brief={brief} go={go} />
    case "duty":
      return <DutyDetail brief={brief} go={go} />
    case "flight":
      return <FlightDetail brief={brief} openFlight={openFlight} />
    case "weather":
      return <WeatherDetail weather={brief.weather} code={brief.code} clock={brief.clock} now={brief.now} />
    case "crew":
      return <CrewDetail brief={brief} go={go} openFlight={openFlight} />
    case "destination":
      return <DestinationDetail brief={brief} openFlight={openFlight} />
    case "currency":
      return <CurrencyDetail brief={brief} go={go} />
    case "limits":
      return <LimitsDetail brief={brief} go={go} />
  }
}

/* ── Status ──────────────────────────────────────────────────────────────── */

function StatusDetail({ brief, go }: { brief: FlightBrief; go: (href: string) => void }) {
  const { status } = brief
  const flagged = status.legality.requirements
    .filter((r) => r.state !== "ok")
    .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))
  return (
    <>
      <FormSection title="Now">
        <ReadOnlyRow label={status.nextAction.headline} value="" />
        {status.nextAction.detail && (
          <p className="row-divider relative px-4 py-3 text-sm text-muted-foreground">{status.nextAction.detail}</p>
        )}
      </FormSection>
      <FormSection title={flagged.length ? "Needs Attention" : "Requirements"}>
        {flagged.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted-foreground">Every requirement is met.</p>
        ) : (
          flagged.map((r) => <RequirementRow key={r.id} requirement={r} go={go} />)
        )}
      </FormSection>
    </>
  )
}

/* ── Duty ────────────────────────────────────────────────────────────────── */

function DutyDetail({ brief, go }: { brief: FlightBrief; go: (href: string) => void }) {
  const { status, clock, day, upcoming, now } = brief
  const { active, lastDuty, next, rest, standby } = status.duty
  const onDuty = status.duty.phase === "on_duty" && active
  return (
    <>
      {onDuty && active && (
        <FormSection title={`On Duty · ${active.route || "Duty"}`}>
          <ReadOnlyRow label="Reported" value={clock(active.startMs)} />
          {active.maxFdpMinutes > 0 ? (
            <>
              <ReadOnlyRow label="FDP" value={`${formatDutyClock(active.fdpElapsedMinutes)} of ${formatDutyClock(active.maxFdpMinutes)}`} />
              <ReadOnlyRow
                label={active.exceeded ? "FDP Exceeded By" : "FDP Left"}
                value={formatDutyClock(Math.abs(active.maxFdpMinutes - active.fdpElapsedMinutes))}
              />
              <ReadOnlyRow
                label="Latest On-Blocks"
                value={clock(active.startMs - (active.fdpElapsedMinutes - active.elapsedMinutes) * 60_000 + active.maxFdpMinutes * 60_000)}
              />
              <ReadOnlyRow label="Maximum From" value={[active.fdpTable && `Table ${active.fdpTable}`, `${active.sectorCount} sector${active.sectorCount === 1 ? "" : "s"}`, active.augmented && "augmented"].filter(Boolean).join(" · ")} />
            </>
          ) : (
            <ReadOnlyRow label="FDP" value={active.notFdp ? `${active.notFdp} — not an FDP` : "No limit computed"} />
          )}
          <ReadOnlyRow label="Flight Time" value={formatDutyClock(active.flightMinutes)} />
        </FormSection>
      )}
      {standby && (
        <FormSection title={`Standby · ${standby.code}`}>
          <ReadOnlyRow label="Window" value={`${clock(standby.startMs)} – ${clock(standby.endMs)}`} />
          <ReadOnlyRow label="Left" value={formatDutyClock(Math.max(0, standby.remainingMinutes))} />
          <ReadOnlyRow label="Called Out" value={standby.activated ? "Yes" : "No"} />
        </FormSection>
      )}
      {!onDuty && rest && (
        <FormSection title="Rest">
          {lastDuty && <ReadOnlyRow label="Last Duty" value={`${lastDuty.route || "Duty"} · ended ${clock(lastDuty.debriefMs)}`} />}
          <ReadOnlyRow label="So Far" value={formatRestSpan(rest.elapsedMinutes)} />
          <ReadOnlyRow label="Minimum" value={formatDutyClock(rest.requiredMinutes)} />
          <ReadOnlyRow label="Legal From" value={rest.isLegalNow ? "Now" : clock(Date.parse(rest.legalAtUtc))} />
        </FormSection>
      )}
      {!onDuty && next && (
        <FormSection title={`Next Duty · ${day(next.reportMs)}`}>
          <ReadOnlyRow label="Route" value={next.route || "—"} />
          <ReadOnlyRow label="Report" value={`${clock(next.reportMs)} · in ${formatRestSpan(Math.max(0, Math.round((next.reportMs - now) / 60_000)))}`} />
          {next.restRequiredMinutes > 0 && (
            <ReadOnlyRow
              label="Rest Before It"
              value={`${formatRestSpan(next.restAvailableMinutes)} · needs ${formatDutyClock(next.restRequiredMinutes)}${next.legalAtReport === false ? ` · short ${formatDutyClock(next.restShortfallMinutes)}` : ""}`}
            />
          )}
          {next.plannedFdpMinutes > 0 && (
            <ReadOnlyRow
              label="FDP"
              value={next.maxFdpMinutes > 0 ? `${formatDutyClock(next.plannedFdpMinutes)} of ${formatDutyClock(next.maxFdpMinutes)}` : `${formatDutyClock(next.plannedFdpMinutes)}, no limit computed`}
            />
          )}
        </FormSection>
      )}
      {upcoming.length > 0 && (
        <FormSection title="Coming Up">
          {upcoming.map((dp) => {
            const w = dutyWindow(dp)
            return (
              <ReadOnlyRow
                key={dp.id}
                label={w ? day(w.startMs) : dp.date}
                value={[dp.route || dp.dutyKind || "Duty", w && `report ${clock(w.startMs)}`].filter(Boolean).join(" · ")}
              />
            )
          })}
        </FormSection>
      )}
      <ActionStack>
        <ActionRow label="Open FDP" onClick={() => go("/fdp")} />
      </ActionStack>
    </>
  )
}

/* ── This / next duty's flights ──────────────────────────────────────────── */

function departureGateShown(g: GateState | undefined): boolean {
  return g?.status === "done" && !!g.gates.departure.gate
}

function FlightDetail({ brief, openFlight }: { brief: FlightBrief; openFlight: (id: string) => void }) {
  const { duty, code, clock, display } = brief
  const lookups = duty.lookups
  const separator = display?.clockSeparator
  const inbound = inboundLeg(duty.legs)
  if (duty.legs.length === 0) {
    return (
      <FormSection>
        <p className="px-4 py-3.5 text-sm text-muted-foreground">
          {duty.atMs === null
            ? "Nothing is rostered. Add flights, or import your roster, to see the next duty here."
            : "No flights in the logbook for this duty yet. Add them, or import the roster, to see their gates and aircraft."}
        </p>
      </FormSection>
    )
  }
  return (
    <>
      {inbound && (
        <FormSection title={`Aircraft · ${inbound.aircraftReg}${inbound.aircraftType ? ` · ${inbound.aircraftType}` : ""}`}>
          <CheckRow
            label="Inbound"
            // The leg's own Gates row says the gate once it is published; the
            // inbound's arrival gate stands in until then.
            value={lookups ? whereaboutsValue(lookups.inbound, separator, { gate: !departureGateShown(lookups.gates[inbound.id]) }) : null}
            loading={duty.lookupsLoading}
            onCheck={duty.refreshLookups}
            icon={<Plane className="h-4 w-4" />}
          />
        </FormSection>
      )}
      {duty.legs.map((f, i) => {
        const t = duty.times[i]
        const route = `${code(f.departureIcao, f.departureIata) || "?"} → ${code(f.arrivalIcao, f.arrivalIata) || "?"}`
        return (
          <div key={f.id} className="space-y-2">
            <FormSection title={[f.flightNumber || "Flight", route].join(" · ")}>
              {(f.scheduledOut || f.scheduledIn) && (
                <ReadOnlyRow label="Scheduled" value={`${f.scheduledOut || "—"} – ${f.scheduledIn || "—"}Z`} />
              )}
              {f.outTime && <ReadOnlyRow label="Out / In" value={`${f.outTime} – ${f.inTime || "…"}Z`} />}
              {f.outTime && !f.inTime && t?.arriveMs != null && <ReadOnlyRow label="Expected In" value={clock(t.arriveMs)} />}
              {f.aircraftReg && <ReadOnlyRow label="Aircraft" value={[f.aircraftReg, f.aircraftType].filter(Boolean).join(" · ")} />}
              {f.flightNumber && (
                <CheckRow
                  label="Gates"
                  value={gatesValue(lookups?.gates[f.id])}
                  loading={duty.lookupsLoading}
                  onCheck={duty.refreshLookups}
                  icon={<DoorOpen className="h-4 w-4" />}
                />
              )}
            </FormSection>
            <ActionStack>
              <ActionRow label="Open Flight" onClick={() => openFlight(f.id)} />
            </ActionStack>
          </div>
        )
      })}
    </>
  )
}

/* ── Crew ────────────────────────────────────────────────────────────────── */

function CrewDetail({ brief, go, openFlight }: { brief: FlightBrief; go: (href: string) => void; openFlight: (id: string) => void }) {
  if (brief.crew.length === 0) {
    return (
      <FormSection>
        <p className="px-4 py-3.5 text-sm text-muted-foreground">
          {brief.duty.legs.length ? "No crew on these flights yet — a roster import names them." : "No duty ahead."}
        </p>
      </FormSection>
    )
  }
  return (
    <>
      {brief.crew.map((m) => (
        <div key={m.personId ?? m.name} className="space-y-2">
          <FormSection title={`${m.role} · ${m.name}`}>
            <ReadOnlyRow
              label="Last Flown Together"
              value={m.last ? `${shortDay(m.last.date)} · ${[m.last.flightNumber, m.last.route].filter(Boolean).join(" ")}` : "First flight"}
            />
            <ReadOnlyRow label="Flights Together" value={String(m.count)} />
          </FormSection>
          <ActionStack>
            {m.last && <ActionRow label="Open Last Flight Together" onClick={() => openFlight(m.last!.flightId)} />}
            {m.personId && <ActionRow label={`Open ${shortName(m.name)}`} onClick={() => go(`/crew?selected=${m.personId}`)} />}
          </ActionStack>
        </div>
      ))}
    </>
  )
}

/* ── Destinations ────────────────────────────────────────────────────────── */

function DestinationDetail({ brief, openFlight }: { brief: FlightBrief; openFlight: (id: string) => void }) {
  const dests = destinationsOf(brief)
  if (dests.length === 0) {
    return (
      <FormSection>
        <p className="px-4 py-3.5 text-sm text-muted-foreground">No duty ahead.</p>
      </FormSection>
    )
  }
  return (
    <>
      {dests.map((d) => {
        const airport = brief.airports.get(d.icao)
        const arrival = brief.duty.times.find((t) => t.arrivalIcao === d.icao)?.arriveMs ?? null
        const night =
          arrival !== null && airport && hasCoordinates(airport) ? isNight(new Date(arrival), airport.latitude, airport.longitude) : null
        return (
          <div key={d.icao} className="space-y-2">
            <FormSection title={[brief.code(d.icao), airport?.name].filter(Boolean).join(" · ")}>
              <ReadOnlyRow
                label="Last Arrived"
                value={d.last ? `${shortDay(d.last.date)} · ${[d.last.flightNumber, d.last.from && `from ${brief.code(d.last.from)}`].filter(Boolean).join(" ")}` : "First time"}
              />
              <ReadOnlyRow label="Last 12 Months" value={`${d.year} arrival${d.year === 1 ? "" : "s"}`} />
              <ReadOnlyRow label="In the Logbook" value={`${d.total} arrival${d.total === 1 ? "" : "s"}`} />
              {airport?.tz && <ReadOnlyRow label="Local Time Now" value={getAirportLocalTime(airport.tz)} />}
              {arrival !== null && night !== null && (
                <ReadOnlyRow label="Arriving" value={`${brief.clock(arrival)} · by ${night ? "night" : "day"}`} />
              )}
            </FormSection>
            {d.last && (
              <ActionStack>
                <ActionRow label="Open Last Flight There" onClick={() => openFlight(d.last!.flightId)} />
              </ActionStack>
            )}
          </div>
        )
      })}
    </>
  )
}

/* ── Currency and limits ─────────────────────────────────────────────────── */

/** One requirement: its figure, and — a tap — what it is made of and what to do. */
function RequirementRow({ requirement, go }: { requirement: Requirement; go: (href: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const { label, state, value, detail, action, href } = requirement
  const Icon = STATE_ICON[state]
  const rows = (detail ?? []).filter((d) => !(d.label === "Status" && d.value === STATE_WORD[state]))
  const remedy = action && !action.toLowerCase().endsWith(value.toLowerCase()) ? action : null
  const id = React.useId()
  return (
    <div className="row-divider relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Icon className={cn("h-4 w-4 shrink-0", REQ_TONE[state].icon)} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-foreground">{label}</span>
          {remedy && <span className="block truncate text-xs text-muted-foreground">{remedy}</span>}
        </span>
        <span className={cn("shrink-0 font-semibold tabular-nums", state === "ok" ? "text-foreground" : REQ_TONE[state].icon)}>{value}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} className={cn("grid transition-[grid-template-rows] duration-200", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="space-y-1 px-4 pb-3 pl-10">
            <p className="flex justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Status</span>
              <span className="text-foreground">{STATE_WORD[state]}</span>
            </p>
            {rows.map((d) => (
              <p key={d.label} className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{d.label}</span>
                <span className="text-right text-foreground">{d.value}</span>
              </p>
            ))}
            <button type="button" onClick={() => go(href)} className="pt-1 text-sm font-medium text-primary" tabIndex={open ? 0 : -1}>
              {destinationLabel(href)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CurrencyDetail({ brief, go }: { brief: FlightBrief; go: (href: string) => void }) {
  const reqs = orderCurrency(brief.status.legality.requirements.filter((r) => r.group === "currency"))
  return (
    <>
      <FormSection>
        {reqs.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted-foreground">Nothing tracked yet.</p>
        ) : (
          reqs.map((r) => <RequirementRow key={r.id} requirement={r} go={go} />)
        )}
      </FormSection>
      <ActionStack>
        <ActionRow label="Open Currencies" onClick={() => go("/currencies")} />
      </ActionStack>
    </>
  )
}

function LimitsDetail({ brief, go }: { brief: FlightBrief; go: (href: string) => void }) {
  const limits = limitsOf(brief)
  return (
    <>
      <FormSection>
        {limits.map((r) => (
          <RequirementRow key={r.id} requirement={r} go={go} />
        ))}
      </FormSection>
      <ActionStack>
        <ActionRow label="Open FDP" onClick={() => go("/fdp")} />
      </ActionStack>
    </>
  )
}
