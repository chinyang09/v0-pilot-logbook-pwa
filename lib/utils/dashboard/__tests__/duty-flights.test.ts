/**
 * A duty's legs: the logbook's flights departing from half an hour before its
 * report to eighteen hours after, in the order they are FLOWN (the first leg's
 * aeroplane is the inbound that matters), never a simulator or a binned row.
 */

import { describe, expect, it } from "vitest"
import type { FlightLog } from "@/types/entities/flight.types"
import { dutyFlights, inboundLeg, legDepartureIso } from "../duty-flights"

const at = Date.parse("2026-10-30T01:25:00Z")
const leg = (id: string, scheduledOut: string, over: Partial<FlightLog> = {}) =>
  ({ id, date: "2026-10-30", scheduledOut, outTime: "", entryType: "flight", deletedAt: null, ...over }) as FlightLog

describe("a duty's legs", () => {
  it("are the flights inside the duty, first flown first", () => {
    const legs = dutyFlights(
      [leg("back", "06:20"), leg("out", "02:25"), leg("tomorrow", "02:25", { date: "2026-10-31" }), leg("before", "00:30")],
      at
    )
    expect(legs.map((l) => l.id)).toEqual(["out", "back"])
  })

  it("leave out simulators and binned flights, and read OUT when there is no schedule", () => {
    const legs = dutyFlights(
      [leg("sim", "03:00", { entryType: "simulator" }), leg("binned", "03:00", { deletedAt: 1 }), leg("flown", "", { outTime: "04:00" })],
      at
    )
    expect(legs.map((l) => l.id)).toEqual(["flown"])
  })

  it("stop at the first long time on the ground — that is the next duty", () => {
    const legs = dutyFlights(
      [
        leg("out", "02:25", { scheduledIn: "05:25" }),
        leg("back", "06:20", { scheduledIn: "08:55" }),
        leg("next-duty", "19:00", { scheduledIn: "21:00" }),
      ],
      at
    )
    expect(legs.map((l) => l.id)).toEqual(["out", "back"])
  })

  it("ask after the next leg still to fly, else the first", () => {
    const flown = leg("out", "02:25", { aircraftReg: "9V-NCA", outTime: "02:31" })
    const next = leg("back", "06:20", { aircraftReg: "9V-NCB" })
    expect(inboundLeg([flown, next])?.id).toBe("back")
    expect(inboundLeg([flown])?.id).toBe("out")
    expect(inboundLeg([leg("x", "02:25")])).toBeNull()
  })

  it("departs at its scheduled OUT on its UTC date", () => {
    expect(legDepartureIso(leg("x", "02:25"))).toBe("2026-10-30T02:25:00.000Z")
    expect(legDepartureIso(leg("x", ""))).toBeNull()
  })
})
