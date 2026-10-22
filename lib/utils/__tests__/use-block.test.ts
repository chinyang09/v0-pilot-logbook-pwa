/**
 * "USE x:xx" on an hour category means "this was the whole block" — it is not
 * a lock. The category follows the block when OUT or IN moves, from the form,
 * from a recalculation pass and from an import that rewrites the block. Only a
 * figure the pilot entered that DIFFERS from the block is theirs to keep.
 */

import { describe, it, expect } from "vitest"
import { blockFollowersPatch, categoryState, recalculateFlightFields } from "../flight-calculations"
import { DEFAULT_AUTO_FILL_PREFERENCES } from "@/types/db/stores.types"
import type { FlightLog } from "@/types/entities/flight.types"

const flight = (over: Partial<FlightLog>): Partial<FlightLog> => ({
  date: "2026-10-01",
  outTime: "02:00",
  inTime: "04:10",
  blockTime: "02:10",
  departureIcao: "WSSS",
  arrivalIcao: "VTBS",
  pilotRole: "SIC",
  aircraftType: "A320",
  manualOverrides: {},
  ...over,
})

describe("categoryState", () => {
  it("reads unset as auto, the block as block, anything else as pinned", () => {
    expect(categoryState(flight({ ifrTime: "02:10" }), "ifrTime")).toBe("auto")
    expect(categoryState(flight({ ifrTime: "02:10", manualOverrides: { ifrTime: true } }), "ifrTime")).toBe("block")
    expect(categoryState(flight({ ifrTime: "1:30", manualOverrides: { ifrTime: true } }), "ifrTime")).toBe("pinned")
    // Spelling does not matter, only the minutes.
    expect(categoryState(flight({ ifrTime: "2:10", manualOverrides: { ifrTime: true } }), "ifrTime")).toBe("block")
  })
})

describe("recalculation", () => {
  it("moves a USE'd category with the block when IN changes", () => {
    const used = flight({ inTime: "04:40", ifrTime: "02:10", manualOverrides: { ifrTime: true } })
    expect(recalculateFlightFields(used, null, null).ifrTime).toBe("02:40")
  })

  it("follows the block even with the category's auto-fill switched off", () => {
    const used = flight({ inTime: "04:40", ifrTime: "02:10", manualOverrides: { ifrTime: true } })
    const off = { ...DEFAULT_AUTO_FILL_PREFERENCES, ifr: false }
    expect(recalculateFlightFields(used, null, null, off).ifrTime).toBe("02:40")
  })

  it("leaves a figure the pilot entered apart from the block alone", () => {
    const pinned = flight({ inTime: "04:40", ifrTime: "01:00", manualOverrides: { ifrTime: true } })
    expect(recalculateFlightFields(pinned, null, null).ifrTime).toBeUndefined()
  })

  it("does not freeze the role split for a role set to the block", () => {
    // PIC set with USE on an SIC flight: PIC follows the block, and SIC is
    // still computed — only a real pin owns the split.
    const used = flight({ inTime: "04:40", picTime: "02:10", manualOverrides: { picTime: true } })
    const updates = recalculateFlightFields(used, null, null)
    expect(updates.picTime).toBe("02:40")
    expect(updates.sicTime).toBe("02:40")
  })

  it("freezes the whole split once a role is a real pin", () => {
    const pinned = flight({ inTime: "04:40", picTime: "01:00", manualOverrides: { picTime: true } })
    const updates = recalculateFlightFields(pinned, null, null)
    expect(updates.picTime).toBeUndefined()
    expect(updates.sicTime).toBeUndefined()
  })
})

describe("blockFollowersPatch — every writer, not only the form", () => {
  const used = flight({ ifrTime: "02:10", crossCountryTime: "01:00", manualOverrides: { ifrTime: true, crossCountryTime: true } })

  it("carries a USE'd category to the new block an import wrote", () => {
    expect(blockFollowersPatch(used, { inTime: "04:40", blockTime: "02:40" })).toEqual({ ifrTime: "02:40" })
  })

  it("does nothing when the block does not change, or the writer set the category itself", () => {
    expect(blockFollowersPatch(used, { remarks: "x" })).toEqual({})
    expect(blockFollowersPatch(used, { blockTime: "2:10" })).toEqual({})
    expect(blockFollowersPatch(used, { blockTime: "02:40", ifrTime: "00:30" })).toEqual({})
  })
})
