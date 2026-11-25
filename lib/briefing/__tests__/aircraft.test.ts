import { describe, expect, it } from "vitest"
import { briefingAircraftPatch, icaoTypeOfOfp } from "../aircraft"
import { briefingId, flightBriefingId } from "../ids"

const OFP = { registration: "9V-TNG", aircraftType: "A320-271N" }
const blank = { aircraftReg: "", aircraftType: "", outTime: "", isLocked: false, signature: undefined }

describe("icaoTypeOfOfp", () => {
  it("reads the A320 family's ceo and neo", () => {
    expect(icaoTypeOfOfp("A320-271N")).toBe("A20N")
    expect(icaoTypeOfOfp("A321-271NX")).toBe("A21N")
    expect(icaoTypeOfOfp("A320-232")).toBe("A320")
    expect(icaoTypeOfOfp("A321-211")).toBe("A321")
    expect(icaoTypeOfOfp("787-9")).toBe("B789")
  })
  it("leaves what it does not know", () => {
    expect(icaoTypeOfOfp("ATR72-600")).toBe("")
    expect(icaoTypeOfOfp("")).toBe("")
  })
})

describe("briefingAircraftPatch", () => {
  it("fills a rostered flight with no aeroplane", () => {
    expect(briefingAircraftPatch(blank, OFP)).toEqual({ aircraftReg: "9V-TNG", aircraftType: "A20N" })
  })
  it("takes the aircraft database's spelling and type", () => {
    expect(briefingAircraftPatch(blank, { ...OFP, registration: "9VTNG" }, { registration: "9V-TNG", typecode: "A20N" })).toEqual({
      aircraftReg: "9V-TNG",
      aircraftType: "A20N",
    })
  })
  it("replaces a different aeroplane on a flight still to fly — the OFP is the newer plan", () => {
    expect(briefingAircraftPatch({ ...blank, aircraftReg: "9V-NCA", aircraftType: "A320" }, OFP)).toEqual({ aircraftReg: "9V-TNG", aircraftType: "A20N" })
  })
  it("writes nothing when the flight already names it", () => {
    expect(briefingAircraftPatch({ ...blank, aircraftReg: "9VTNG", aircraftType: "A20N" }, OFP)).toBeNull()
  })
  it("only fills blanks once off blocks", () => {
    expect(briefingAircraftPatch({ ...blank, outTime: "02:00", aircraftReg: "9V-NCA", aircraftType: "A320" }, OFP)).toBeNull()
    expect(briefingAircraftPatch({ ...blank, outTime: "02:00" }, OFP)).toEqual({ aircraftReg: "9V-TNG", aircraftType: "A20N" })
  })
  it("never touches a signed or locked entry, or writes from an OFP with no registration", () => {
    expect(briefingAircraftPatch({ ...blank, isLocked: true }, OFP)).toBeNull()
    expect(briefingAircraftPatch({ ...blank, signature: {} as never }, OFP)).toBeNull()
    expect(briefingAircraftPatch(blank, { registration: "", aircraftType: "A320-271N" })).toBeNull()
  })
})

describe("flightBriefingId", () => {
  it("dates a flight by its scheduled OUT, as the OFP does", () => {
    // TR274: scheduled 23:55 on the 24th, off blocks 00:28 — keyed on the 25th.
    const f = { flightNumber: "TR274", date: "2026-11-25", departureIcao: "WSSS", scheduledOut: "23:55", outTime: "00:28" }
    expect(flightBriefingId(f)).toBe(briefingId("TR274", "2026-11-24", "WSSS"))
  })
  it("is the flight's own date with no schedule", () => {
    expect(flightBriefingId({ flightNumber: "TR438", date: "2026-11-20", departureIcao: "WSSS" })).toBe("brief:438:2026-11-20:WSSS")
  })
})
