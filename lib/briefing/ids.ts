/**
 * The briefing records' ids are DERIVED from what they are about, so two
 * devices importing the same PDF — or the same route's notes — land on ONE
 * record, and a flight finds its briefing without a link stored on either.
 */

import { scheduledOutMs } from "@/lib/utils/flight-day"

/** "TR438" / "TGW438" → "438": the digits a flight number and a callsign share. */
export const flightDigits = (n: string) => (n.match(/(\d+)[A-Z]?$/)?.[0] ?? n).replace(/^0+(?=\d)/, "")

export const briefingId = (flightNumber: string, date: string, dep: string) =>
  `brief:${flightDigits(flightNumber.toUpperCase())}:${date}:${dep.toUpperCase()}`

/**
 * A logbook flight's briefing id. The OFP dates a flight by its SCHEDULED
 * departure (ETD), while the logbook keys it on the actual OUT once there is
 * one — a red-eye scheduled 23:55 and off blocks at 00:28 is a day apart —
 * so the date is the scheduled OUT's (`scheduledOutMs`), else the flight's.
 */
export function flightBriefingId(f: {
  flightNumber: string
  date: string
  departureIcao?: string | null
  outTime?: string | null
  scheduledOut?: string | null
}): string {
  const ms = scheduledOutMs(f)
  const date = ms === null ? f.date : new Date(ms).toISOString().slice(0, 10)
  return briefingId(f.flightNumber, date, f.departureIcao || "")
}

export const notamRecordId = (key: string) => `notam:${key}`

export const routeRef = (dep: string, arr: string) => `${dep.toUpperCase()}-${arr.toUpperCase()}`
export const noteId = (scope: "route" | "airport", ref: string) => `note:${scope}:${ref.toUpperCase()}`
