/**
 * Seeding the airports table from the bundled dataset — the part that runs the
 * same on the page and in `airport-seed.worker.ts`. No window, no React: just
 * Dexie and the data.
 */

import { referenceDb } from "../../reference-db"
import type { Airport } from "@/types/entities/airport.types"

export const AIRPORT_DATA_VERSION = "2026.10.29-min"
/**
 * Versioned, because the service worker serves other same-origin files
 * stale-while-revalidate: a bare URL handed the first seed after a data change
 * the PREVIOUS file, which was then stamped with the new version and never
 * looked at again. A new version is a new URL, so it misses the cache.
 */
export const AIRPORT_SOURCE_URL = `/airports.min.json?v=${AIRPORT_DATA_VERSION}`

/** What the seed worker reports. */
export type AirportSeedMessage =
  | { type: "progress"; done: number }
  | { type: "done"; count: number }
  | { type: "error"; error: string }

/**
 * Rows per write transaction while seeding, and the pause between them. The
 * bundled dataset is ~29k airports, and Chromium serves every IndexedDB
 * database on an origin from ONE backing store: written as a single
 * transaction it held EVERY request on the origin — the user database and the
 * sync engine included — for the whole write. Measured on a fresh profile:
 * ~26 seconds in which the first flight a new device created could not even
 * be queued, let alone pushed.
 *
 * Chunking alone was not enough, because nothing in the app is ONE
 * transaction. Adding a flight is a chain of about eight (the crew card, the
 * preferences, the flight, the queue …), each started when the last one
 * finishes — and with only a `setTimeout(0)` between chunks the next chunk was
 * always queued first, so the chain waited a whole chunk at EVERY step. At
 * 1000 rows (~550ms a chunk in headless Chromium) adding a flight took 2–6s
 * for the 15-odd seconds after the first flight form opened on a new install,
 * which is what read as "adding gets slower while sync is failing".
 *
 * Smaller chunks bound each wait, and the gap is long enough for a whole
 * chain to run between two of them. The seed takes a few seconds longer; it
 * is a once-per-install background job and the pilot is not waiting on it.
 */
export const SEED_CHUNK = 250
export const SEED_GAP_MS = 48

/** Map the raw airports JSON into our Airport rows, re-flagging known favorites. */
export function mapRawAirports(rawData: Record<string, any>, favoriteIcaos: Set<string>): Airport[] {
  return Object.values(rawData)
    .map((airport: any, index: number) => ({
      id: index + 1,
      icao: airport.icao || "",
      iata: airport.iata || "",
      name: airport.name || "",
      city: airport.city || "",
      state: airport.state || "",
      country: airport.country || "",
      latitude: airport.lat || 0,
      longitude: airport.lon || 0,
      elevation: airport.elevation || 0,
      tz: airport.tz || "UTC",
      isFavorite: favoriteIcaos.has(airport.icao) ? true : undefined,
    }))
    .filter((a) => a.icao)
}

/**
 * Write the dataset into the table, preserving the user's favorites and custom
 * airports (both derived from one full scan). Overwrites in place rather than
 * clear-then-fill, so a reader during the seed sees old-or-new rows and never
 * an empty table, and drops the airports the dataset no longer has once every
 * chunk is in. The version is stamped LAST: a seed interrupted part-way is
 * redone next time instead of being taken for a complete table.
 */
export async function writeAirportRows(
  rawData: Record<string, any>,
  onProgress: (done: number) => void,
): Promise<Airport[]> {
  const existing = await referenceDb.airports.toArray()
  const favoriteIcaos = new Set(existing.filter((a) => a.isFavorite).map((a) => a.icao))
  const customAirports = existing.filter((a) => a.isCustom === true)

  const airports = mapRawAirports(rawData, favoriteIcaos)
  const newIcaos = new Set(airports.map((a) => a.icao))
  const customToPreserve = customAirports.filter((a) => !newIcaos.has(a.icao))
  const rows = [...airports, ...customToPreserve]

  for (let i = 0; i < rows.length; i += SEED_CHUNK) {
    await referenceDb.airports.bulkPut(rows.slice(i, i + SEED_CHUNK))
    onProgress(Math.min(1, (i + SEED_CHUNK) / rows.length))
    await new Promise((resolve) => setTimeout(resolve, SEED_GAP_MS))
  }
  const keep = new Set(rows.map((a) => a.icao))
  const stale = ((await referenceDb.airports.toCollection().primaryKeys()) as string[]).filter((k) => !keep.has(k))
  if (stale.length > 0) await referenceDb.airports.bulkDelete(stale)

  await referenceDb.setMetadata("airport_version", AIRPORT_DATA_VERSION)
  return airports
}
