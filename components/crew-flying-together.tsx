"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { FormSection } from "@/components/ui/form-section"
import { ReadOnlyRow } from "@/components/ui/settings-row"
import { useCrewHistory } from "@/hooks/data"
import { formatDay } from "@/lib/utils/date"
import type { FlightTogether } from "@/lib/utils/crew-history"

/**
 * When the pilot last flew with this crew member, how often, and the next
 * rostered flight together (`crewFlyingHistory`). Each flight opens in the
 * logbook. Nothing shows for a card never flown with — an empty section is
 * one more thing to read.
 */
export function CrewFlyingTogether({ crewId }: { crewId: string }) {
  const history = useCrewHistory().get(crewId)
  if (!history || (!history.last && !history.next)) return null
  return (
    <FormSection title="Flying Together">
      {history.last && <FlightLink label="Last Flown" flight={history.last} />}
      <ReadOnlyRow label="Flights Together" value={String(history.count)} />
      {history.next && <FlightLink label="Next" flight={history.next} />}
    </FormSection>
  )
}

function FlightLink({ label, flight }: { label: string; flight: FlightTogether }) {
  return (
    <Link
      href={`/logbook?selected=${encodeURIComponent(flight.flightId)}`}
      className="row-divider relative flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-secondary/50"
    >
      <span className="text-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right">
        <span className="min-w-0">
          <span className="block truncate text-foreground">{formatDay(flight.date)}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[flight.flightNumber, flight.route].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </span>
    </Link>
  )
}
