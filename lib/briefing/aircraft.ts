/**
 * The aeroplane an OFP is planned on, as the AIRCRAFT IN USE for its logbook
 * flight (the owner, Nov 2026: "flight brief as aircraft in use … can be used
 * to hydrate logbook flight card"). A rostered sector carries no
 * registration until the day it is assigned, so the Flight Deck read
 * "Aircraft TBA" over a flight whose briefing named it.
 *
 * Pure: which fields a briefing writes onto which flight.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import { normalizeRegistration } from "@/lib/utils/string"

/**
 * The ICAO designator for the type an OFP prints ("A320-271N" → "A20N"). Only
 * the families whose model numbers say ceo / neo unambiguously; anything else
 * is "" and the type is left to the aircraft database or the flight.
 */
export function icaoTypeOfOfp(raw: string): string {
  const t = (raw || "").trim().toUpperCase()
  const a32 = t.match(/^A(318|319|320|321)(?:-(\d{3})(N)?X?)?/)
  if (a32) {
    const neo = !!a32[3]
    if (a32[1] === "320") return neo ? "A20N" : "A320"
    if (a32[1] === "321") return neo ? "A21N" : "A321"
    if (a32[1] === "319") return neo ? "A19N" : "A319"
    return "A318"
  }
  const b78 = t.match(/^B?787-(8|9|10)/)
  if (b78) return b78[1] === "10" ? "B78X" : `B78${b78[1]}`
  return ""
}

export interface BriefingAircraft {
  /** As the OFP prints it ("9V-TNG"). */
  registration: string
  /** As the OFP prints it ("A320-271N"). */
  aircraftType: string
}

/**
 * What a briefing writes onto its flight, or null when nothing. A signed or
 * locked entry is the pilot's record and is never touched; a flight already
 * off blocks has only its BLANKS filled (the aeroplane it flew is a fact by
 * then); a flight still to fly takes the OFP's aeroplane — the plan issued
 * on the day is newer than any roster. `known` is the aircraft database's
 * record of the registration, whose spelling and type win.
 */
export function briefingAircraftPatch(
  flight: Pick<FlightLog, "aircraftReg" | "aircraftType" | "outTime" | "isLocked" | "signature">,
  b: BriefingAircraft,
  known?: { registration: string; typecode: string } | null,
): Pick<FlightLog, "aircraftReg" | "aircraftType"> | null {
  if (!b.registration?.trim() || flight.isLocked || flight.signature) return null
  const reg = known?.registration || b.registration.trim().toUpperCase()
  const type = known?.typecode || icaoTypeOfOfp(b.aircraftType)
  const flown = !!flight.outTime
  const haveReg = !!flight.aircraftReg?.trim()
  const sameReg = haveReg && normalizeRegistration(flight.aircraftReg) === normalizeRegistration(reg)
  const patch: Partial<Pick<FlightLog, "aircraftReg" | "aircraftType">> = {}
  if (!haveReg || (!flown && !sameReg)) patch.aircraftReg = reg
  const regChanges = patch.aircraftReg !== undefined && !sameReg
  if (type && (!flight.aircraftType?.trim() || (regChanges && !flown)) && flight.aircraftType !== type) patch.aircraftType = type
  return Object.keys(patch).length ? (patch as Pick<FlightLog, "aircraftReg" | "aircraftType">) : null
}
