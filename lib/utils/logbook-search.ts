/**
 * The logbook's search — what a typed term matches.
 *
 * It was `field.toLowerCase().includes(term.toLowerCase())`: "9VNCA" found
 * nothing on a flight flown on 9V-NCA, "TR 288" nothing on TR288, and a route
 * typed the way a pilot says it ("WSSS-WICA", "SIN CGK") nothing at all,
 * because no single field held both ends. The owner: the search has to be
 * smarter than exact match.
 *
 * Both sides are SQUASHED — lowercase, letters and digits only — so spacing,
 * dashes and case stop mattering. Each flight carries a few derived fields
 * besides its own: the route both ways of naming it, the flight number with
 * its digits alone, the date in the forms a pilot writes one. A term matches
 * when its squashed whole is inside one field, or — for a term of several
 * words — when every word is inside some field ("wsss wica", "tan sim").
 *
 * Pure, and the haystack is built ONCE per flights array (`flightSearchFields`)
 * so a keystroke costs only the comparisons.
 */

import type { FlightLog } from "@/types/entities/flight.types"

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/** Lowercase, letters and digits only. */
export function squash(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/** "tr0288" → "tr288": a flight number's leading zeros say nothing. */
function dropFlightZeros(value: string): string {
  return value.replace(/^([a-z]{1,3})0+(?=\d)/, "$1")
}

/** The forms a pilot writes a date in, squashed: "7nov", "07nov", "nov7", "7nov26", "2026-11-07"… */
function dateForms(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso ? [squash(iso)] : []
  const [, yyyy, mm, dd] = m
  const mon = MONTHS[Number(mm) - 1] ?? ""
  const d = String(Number(dd))
  const yy = yyyy.slice(2)
  return [
    `${yyyy}${mm}${dd}`,
    `${d}${mon}${yy}`,
    `${dd}${mon}${yy}`,
    `${d}${mon}${yyyy}`,
    `${mon}${d}`,
    `${mon}${yyyy}`,
    `${mon}${yy}`,
  ]
}

/** Every squashed field one flight can be found by. */
export function flightSearchFields(f: FlightLog): string[] {
  const out = new Set<string>()
  const add = (v?: string | null) => {
    if (!v) return
    const s = squash(v)
    if (s) out.add(s)
  }
  if (f.flightNumber) {
    const fn = dropFlightZeros(squash(f.flightNumber))
    if (fn) out.add(fn)
    const digits = fn.replace(/^[a-z]+/, "")
    if (digits) out.add(digits)
  }
  add(f.aircraftReg)
  add(f.aircraftType)
  add(f.departureIcao)
  add(f.arrivalIcao)
  add(f.departureIata)
  add(f.arrivalIata)
  // The route, as one field, in both codes — so "WSSS-WICA" and "SIN CGK"
  // match as a whole.
  add(`${f.departureIcao ?? ""}${f.arrivalIcao ?? ""}`)
  add(`${f.departureIata ?? ""}${f.arrivalIata ?? ""}`)
  add(f.picName)
  add(f.sicName)
  for (const c of f.additionalCrew ?? []) add(c.name)
  add(f.remarks)
  add(f.entryType)
  if (f.entryType === "simulator" || f.isSimulator) out.add("sim")
  for (const d of dateForms(f.date ?? "")) out.add(d)
  return [...out]
}

/** A duty's fields, squashed the same way. */
export function squashFields(values: Array<string | null | undefined>): string[] {
  return values.map((v) => (v ? squash(v) : "")).filter(Boolean)
}

export interface SearchTerm {
  whole: string
  words: string[]
}

/** A typed term, ready to compare. */
export function prepareTerm(raw: string): SearchTerm {
  const words = raw
    .split(/[\s\-–—>→/,.]+/)
    .map((w) => dropFlightZeros(squash(w)))
    .filter(Boolean)
  return { whole: dropFlightZeros(squash(raw)), words }
}

function termMatches(fields: string[], term: SearchTerm): boolean {
  if (!term.whole) return true
  if (fields.some((f) => f.includes(term.whole))) return true
  // Word by word, for a term naming two things ("wsss wica", "ming tan").
  // Not when a word is a bare day number: "8 nov" split into "8" and "nov"
  // found TR288 in November — a date has to match as a date.
  if (term.words.length < 2 || term.words.some((w) => /^\d{1,2}$/.test(w))) return false
  return term.words.every((w) => fields.some((f) => f.includes(w)))
}

/** Every term must match (chips AND together). */
export function matchesTerms(fields: string[], terms: SearchTerm[]): boolean {
  return terms.every((t) => termMatches(fields, t))
}
