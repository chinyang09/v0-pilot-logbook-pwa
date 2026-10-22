/**
 * What a stored flight field is CALLED where a pilot reads it.
 *
 * A comparison, an import note and the import review all name the field that
 * differs, and each surface kept its own short list — so anything off that
 * list reached the screen as the stored key ("outTime", "departureIcao").
 * Hour categories are not here: they are named by the pilot's logbook rules
 * (`TIME_CATEGORIES`), and a surface that shows them asks that table first.
 */

const FIELD_LABELS: Record<string, string> = {
  flightNumber: "Flight number",
  date: "Date",
  outTime: "OUT",
  offTime: "OFF",
  onTime: "ON",
  inTime: "IN",
  scheduledOut: "Scheduled out",
  scheduledIn: "Scheduled in",
  reportTime: "Report",
  blockTime: "Block time",
  flightTime: "Flight time",
  dayTime: "Day",
  nightTime: "Night",
  aircraftReg: "Registration",
  aircraftType: "Aircraft type",
  departureIcao: "Departure (ICAO)",
  arrivalIcao: "Arrival (ICAO)",
  departureIata: "Departure (IATA)",
  arrivalIata: "Arrival (IATA)",
  pilotFlying: "Pilot flying",
  pilotRole: "Role",
  dayTakeoffs: "Day takeoffs",
  nightTakeoffs: "Night takeoffs",
  dayLandings: "Day landings",
  nightLandings: "Night landings",
  picName: "PIC",
  sicName: "SIC",
  remarks: "Remarks",
}

/** The pilot-facing name of a flight field; an unknown key is spelled out ("someField" → "Some field"). */
export function flightFieldLabel(field: string): string {
  const known = FIELD_LABELS[field]
  if (known) return known
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : field
}
