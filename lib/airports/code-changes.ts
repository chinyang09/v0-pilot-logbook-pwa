/**
 * IATA codes that have MOVED from one airport to another, with the instant
 * each move took effect.
 *
 * A company report names an airport by its IATA code only, and a code is not
 * an airport for all time: on 17 Aug 2026 VTZ moved from Visakhapatnam's old
 * airport (VOVZ, now the naval air station INS Dega) to the new Alluri
 * Sitarama Raju International at Bhogapuram (VOVI). Resolving VTZ without a
 * date took whichever row IndexedDB happened to return, and filed flights
 * after the move at an airport that no longer had airline traffic — the wrong
 * position for night time and day/night takeoffs and landings.
 *
 * So the question is never "which airport is VTZ" but "which airport was VTZ
 * WHEN THIS FLIGHT FLEW", and this table answers it. A code with no entry here
 * has only ever meant one airport, as far as the app knows. `effectiveAt` is
 * UTC; the source's own local wording is in `note`.
 *
 * Both sides of a move are assumed to share a timezone — every move of this
 * kind is within one city. The importers convert a report's local times on
 * whichever airport the code first resolves to, before the date is known.
 *
 * Add a move here, with its source, and add the new airport to
 * `public/airports.min.json` (bumping `AIRPORT_DATA_VERSION`) so every device
 * can resolve it offline. `code-changes.test.ts` pins each entry.
 */

export interface IataReassignment {
  iata: string
  /** The airport the code meant until `effectiveAt`. */
  fromIcao: string
  /** The airport it means from `effectiveAt` on. */
  toIcao: string
  /** ISO 8601, UTC. */
  effectiveAt: string
  note: string
  source: string
}

export const IATA_REASSIGNMENTS: readonly IataReassignment[] = [
  {
    iata: "VTZ",
    fromIcao: "VOVZ",
    toIcao: "VOVI",
    effectiveAt: "2026-08-16T18:31:00Z",
    note: "Commercial flights moved to Bhogapuram from 00:01 IST on 17 Aug 2026",
    source: "https://ourairports.com/airports/VOVI/changes.html",
  },
]

const BY_IATA = new Map<string, { at: number; from: string; to: string }[]>()
for (const r of IATA_REASSIGNMENTS) {
  const list = BY_IATA.get(r.iata) ?? []
  list.push({ at: Date.parse(r.effectiveAt), from: r.fromIcao, to: r.toIcao })
  list.sort((a, b) => a.at - b.at)
  BY_IATA.set(r.iata, list)
}

/** Whether the code has ever been handed from one airport to another. */
export function isReassignedIata(iata: string | null | undefined): boolean {
  return !!iata && BY_IATA.has(iata.trim().toUpperCase())
}

/**
 * The ICAO the code meant at `atMs` (epoch ms; now when omitted), or null when
 * the code has never moved — then any airport carrying it is the answer.
 */
export function icaoForIataAt(iata: string | null | undefined, atMs: number = Date.now()): string | null {
  if (!iata) return null
  const moves = BY_IATA.get(iata.trim().toUpperCase())
  if (!moves) return null
  let icao = moves[0].from
  for (const move of moves) {
    if (atMs >= move.at) icao = move.to
    else break
  }
  return icao
}

/** Every airport the code has meant, oldest first. Empty for a code that never moved. */
export function icaosForIata(iata: string | null | undefined): string[] {
  if (!iata) return []
  const moves = BY_IATA.get(iata.trim().toUpperCase())
  if (!moves) return []
  return [moves[0].from, ...moves.map((m) => m.to)].filter((icao, i, all) => all.indexOf(icao) === i)
}

/**
 * The instant a flight's clock time stands for, in epoch ms: `date` is the
 * flight's UTC date (the date of its OUT), `time` an "HH:MM" UTC time. A time
 * earlier in the day than `after` (the OUT, for an arrival) is the NEXT day,
 * which is how the app keys a flight that lands after midnight UTC. Without a
 * time it is the date's noon — nearer the flight than midnight either side.
 */
export function flightInstantMs(date: string, time?: string | null, after?: string | null): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null
  const clock = (t?: string | null) => (t && /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : null)
  const hhmm = clock(time)
  const base = Date.parse(`${date}T${hhmm ?? "12:00"}:00Z`)
  if (Number.isNaN(base)) return null
  const start = clock(after)
  return hhmm && start && hhmm < start ? base + 86_400_000 : base
}

/**
 * Pick the airport a code meant at an instant out of a map keyed by code —
 * the shape the enrichment chain hands back, which carries the dated ICAOs of
 * a moved code as keys of their own. A code that never moved, or an instant
 * that is unknown, gets the map's own entry for the code.
 */
export function pickAirportAt<T>(airports: ReadonlyMap<string, T>, code: string, atMs: number | null): T | undefined {
  const key = code.trim().toUpperCase()
  if (atMs != null) {
    const icao = icaoForIataAt(key, atMs)
    if (icao) return airports.get(icao)
  }
  return airports.get(key)
}

/**
 * Which side of a stored flight a code move has put at the wrong airport: the
 * flight holds one of the code's airports, and not the one it meant when that
 * side happened. A flight holding some unrelated ICAO is left alone — that is
 * the pilot's own entry, not a stale resolution of the code.
 */
export interface AirportCodeCorrection {
  side: "departure" | "arrival"
  iata: string
  stored: string
  correct: string
}

export function airportCodeCorrections(flight: {
  date: string
  outTime?: string
  inTime?: string
  scheduledOut?: string
  scheduledIn?: string
  departureIata?: string
  departureIcao?: string
  arrivalIata?: string
  arrivalIcao?: string
}): AirportCodeCorrection[] {
  const out = flight.outTime || flight.scheduledOut
  const sides = [
    { side: "departure" as const, iata: flight.departureIata, icao: flight.departureIcao, at: flightInstantMs(flight.date, out) },
    {
      side: "arrival" as const,
      iata: flight.arrivalIata,
      icao: flight.arrivalIcao,
      at: flightInstantMs(flight.date, flight.inTime || flight.scheduledIn || out, out),
    },
  ]
  const corrections: AirportCodeCorrection[] = []
  for (const { side, iata, icao, at } of sides) {
    if (!iata || !icao || at == null) continue
    const correct = icaoForIataAt(iata, at)
    const stored = icao.trim().toUpperCase()
    if (!correct || correct === stored || !icaosForIata(iata).includes(stored)) continue
    corrections.push({ side, iata: iata.trim().toUpperCase(), stored, correct })
  }
  return corrections
}
