"use client"

/**
 * The duty the legal page's sector chain draws, in the DETAIL panel: each of
 * its flights with its gates and where its aeroplane is — the two things a
 * pilot wants on the way in — checked on a tap, never stored. Opened by
 * tapping the chain, so the one-screen legal page gains no row.
 *
 * The duty is found by its start (`atMs`, the report on duty or the next
 * duty's): the logbook's flights departing from half an hour before it to
 * eighteen hours after, which is any duty paragraph 14 allows.
 */

import { useMemo } from "react"
import { DoorOpen, Plane } from "lucide-react"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import { CheckRow } from "@/components/check-row"
import { useFlights } from "@/hooks/data"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { gatesValue, useFlightGates } from "@/hooks/use-flight-gates"
import { useAircraftWhereabouts, whereaboutsValue } from "@/hooks/use-aircraft-whereabouts"
import { usePreferences } from "@/components/providers/preferences-provider"
import { flightInstantMs } from "@/lib/airports/code-changes"
import { isLiveFlight } from "@/lib/db"
import { sortFlights } from "@/lib/utils/flight-sort"
import { getEntryType } from "@/lib/utils/entry-type"
import { getAirportDisplayCode } from "@/lib/utils/airport-display"
import type { FlightLog } from "@/types/entities/flight.types"

const BEFORE_MS = 30 * 60_000
const DUTY_SPAN_MS = 18 * 3600_000

/** The flights of the duty starting at `atMs`, in logbook order. */
export function dutyFlights(flights: FlightLog[], atMs: number): FlightLog[] {
  return sortFlights(
    flights.filter((f) => {
      if (!isLiveFlight(f) || getEntryType(f) === "simulator" || !f.date) return false
      const departs = flightInstantMs(f.date, f.outTime || f.scheduledOut)
      return departs !== null && departs >= atMs - BEFORE_MS && departs <= atMs + DUTY_SPAN_MS
    })
  )
}

export function DutyFlightsPanel({ atMs }: { atMs: number }) {
  const { flights } = useFlights()
  const legs = useMemo(() => dutyFlights(flights ?? [], atMs), [flights, atMs])
  const day = new Date(atMs).toISOString().slice(0, 10)

  return (
    <DetailFormPanel title={`Duty · ${day}`} dirty={false} canSave={false} saving={false} onSave={() => {}} onCancel={() => {}}>
      {legs.length === 0 ? (
        <FormSection>
          <p className="px-4 py-3.5 text-sm text-muted-foreground">
            No flights in the logbook for this duty yet. Add them, or import the roster, to check their gates.
          </p>
        </FormSection>
      ) : (
        legs.map((f) => <DutyLeg key={f.id} flight={f} />)
      )}
    </DetailFormPanel>
  )
}

function DutyLeg({ flight }: { flight: FlightLog }) {
  const { preferences } = usePreferences()
  const pref = preferences.display.airportIdentifier
  const separator = preferences.display.clockSeparator
  const { setSelectedId } = useDetailPanel()
  const gates = useFlightGates(flight.flightNumber, flight.date, flight.scheduledOut)
  const departsAtMs = flightInstantMs(flight.date, flight.scheduledOut || flight.outTime)
  const inbound = useAircraftWhereabouts(
    flight.aircraftReg,
    departsAtMs !== null && (flight.scheduledOut || flight.outTime) ? new Date(departsAtMs).toISOString() : null
  )
  const route = `${getAirportDisplayCode(flight.departureIcao, flight.departureIata, pref) || "?"} → ${getAirportDisplayCode(flight.arrivalIcao, flight.arrivalIata, pref) || "?"}`

  return (
    <>
      <FormSection title={[flight.flightNumber || "Flight", route, flight.aircraftReg].filter(Boolean).join(" · ")}>
        {flight.flightNumber && (
          <CheckRow
            label="Gates"
            value={gatesValue(gates.state)}
            loading={gates.state?.status === "loading"}
            onCheck={() => void gates.check()}
            icon={<DoorOpen className="h-4 w-4" />}
          />
        )}
        {flight.aircraftReg && (
          <CheckRow
            label="Inbound"
            value={whereaboutsValue(inbound.state, separator)}
            loading={inbound.state?.status === "loading"}
            onCheck={() => void inbound.check()}
            icon={<Plane className="h-4 w-4" />}
          />
        )}
      </FormSection>
      <ActionStack>
        <ActionRow label="Open flight" onClick={() => setSelectedId(flight.id)} />
      </ActionStack>
    </>
  )
}
