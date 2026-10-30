"use client"

/**
 * The duty the legal page's sector chain draws, in the DETAIL panel: each of
 * its flights with its gates, and where the aeroplane for the first leg is.
 * The same answer the duty band shows (`useDutyLookups`, one cache); a tap on
 * either row asks again. Nothing is stored.
 */

import { DoorOpen, Plane } from "lucide-react"
import { DetailFormPanel } from "@/components/ui/detail-form-panel"
import { FormSection } from "@/components/ui/form-section"
import { ActionRow, ActionStack } from "@/components/ui/action-row"
import { CheckRow } from "@/components/check-row"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { gatesValue } from "@/hooks/use-flight-gates"
import { whereaboutsValue } from "@/hooks/use-aircraft-whereabouts"
import { useDutyLookups } from "@/hooks/use-duty-lookups"
import { usePreferences } from "@/components/providers/preferences-provider"
import { getAirportDisplayCode } from "@/lib/utils/airport-display"

export function DutyFlightsPanel({ atMs }: { atMs: number }) {
  const { preferences } = usePreferences()
  const pref = preferences.display.airportIdentifier
  const separator = preferences.display.clockSeparator
  const { setSelectedId } = useDetailPanel()
  const { legs, lookups, loading, refresh } = useDutyLookups(atMs, { auto: true })
  const day = new Date(atMs).toISOString().slice(0, 10)
  const inboundLeg = legs.find((f) => f.aircraftReg)

  return (
    <DetailFormPanel title={`Duty · ${day}`} dirty={false} canSave={false} saving={false} onSave={() => {}} onCancel={() => {}}>
      {legs.length === 0 ? (
        <FormSection>
          <p className="px-4 py-3.5 text-sm text-muted-foreground">
            No flights in the logbook for this duty yet. Add them, or import the roster, to see their gates.
          </p>
        </FormSection>
      ) : (
        <>
          {inboundLeg && (
            <FormSection title={`Aircraft · ${inboundLeg.aircraftReg}`}>
              <CheckRow
                label="Inbound"
                value={lookups ? whereaboutsValue(lookups.inbound, separator) : null}
                loading={loading}
                onCheck={refresh}
                icon={<Plane className="h-4 w-4" />}
              />
            </FormSection>
          )}
          {legs.map((flight) => {
            const route = `${getAirportDisplayCode(flight.departureIcao, flight.departureIata, pref) || "?"} → ${getAirportDisplayCode(flight.arrivalIcao, flight.arrivalIata, pref) || "?"}`
            return (
              <div key={flight.id}>
                <FormSection title={[flight.flightNumber || "Flight", route, flight.aircraftReg].filter(Boolean).join(" · ")}>
                  {flight.flightNumber && (
                    <CheckRow
                      label="Gates"
                      value={gatesValue(lookups?.gates[flight.id])}
                      loading={loading}
                      onCheck={refresh}
                      icon={<DoorOpen className="h-4 w-4" />}
                    />
                  )}
                </FormSection>
                <ActionStack>
                  <ActionRow label="Open flight" onClick={() => setSelectedId(flight.id)} />
                </ActionStack>
              </div>
            )
          })}
        </>
      )}
    </DetailFormPanel>
  )
}
