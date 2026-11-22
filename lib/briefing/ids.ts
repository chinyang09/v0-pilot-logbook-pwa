/**
 * The briefing records' ids are DERIVED from what they are about, so two
 * devices importing the same PDF — or the same route's notes — land on ONE
 * record, and a flight finds its briefing without a link stored on either.
 */

/** "TR438" / "TGW438" → "438": the digits a flight number and a callsign share. */
export const flightDigits = (n: string) => (n.match(/(\d+)[A-Z]?$/)?.[0] ?? n).replace(/^0+(?=\d)/, "")

export const briefingId = (flightNumber: string, date: string, dep: string) =>
  `brief:${flightDigits(flightNumber.toUpperCase())}:${date}:${dep.toUpperCase()}`

export const notamRecordId = (key: string) => `notam:${key}`

export const routeRef = (dep: string, arr: string) => `${dep.toUpperCase()}-${arr.toUpperCase()}`
export const noteId = (scope: "route" | "airport", ref: string) => `note:${scope}:${ref.toUpperCase()}`
