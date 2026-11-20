/**
 * An airport's RUNWAYS and FREQUENCIES, from aviationweather.gov's airport
 * data (`/api/data/airport`) — the source the weather already comes from.
 *
 * | | |
 * |---|---|
 * | runways | each with its TRUE heading (`alignment`: KSEA's 16/34 is 180, its magnetic 164 plus 16°E), length, width and surface — so the wind a METAR gives (true) is resolved onto the runway without the designator's rounding |
 * | frequencies | ATIS, tower and the rest, as the source names them |
 * | variation | "16E" → +16 |
 *
 * It is REFERENCE data: asked for a batch of airports in ONE request, kept in
 * MongoDB (`airportInfo`, one document per ICAO) for 30 days, and an airport
 * the source does not know is remembered as unknown for 7 — so a runway list
 * costs the source a request a month, never one per look. The weather itself
 * stays on the cache files (`server.ts`).
 */

import type { Db } from "mongodb"

export interface RunwayInfo {
  /** "02L/20R". */
  id: string
  /** The first end's TRUE heading, degrees; the other end is +180. Null when not given. */
  trueHeading: number | null
  lengthFt: number | null
  widthFt: number | null
  /** "Hard", "Grass"… as the source's code reads. */
  surface: string
}

export interface AirportInfo {
  icao: string
  name: string
  /** Magnetic variation, degrees east positive. */
  variationDeg: number | null
  runways: RunwayInfo[]
  /** [["ATIS", "128.6"], ["TWR", "118.6"]]. */
  freqs: [string, string][]
}

export const AIRPORT_INFO_SOURCE = "https://aviationweather.gov/api/data/airport"
export const AIRPORT_INFO_MAX_IDS = 12
const KEEP_MS = 30 * 86_400_000
const KEEP_UNKNOWN_MS = 7 * 86_400_000

const SURFACE: Record<string, string> = {
  H: "Hard",
  A: "Asphalt",
  C: "Concrete",
  G: "Grass",
  T: "Turf",
  D: "Dirt",
  W: "Water",
  S: "Snow",
  U: "",
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** "16E" → 16, "5W" → -5, "0" → 0. */
export function variationOf(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*([EW])?$/i)
  if (!m) return null
  const n = Number(m[1])
  return m[2]?.toUpperCase() === "W" ? -n : n
}

/** One record of the source, as the app keeps it; null when it is not one. */
export function readAirportInfo(raw: unknown): AirportInfo | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const icao = typeof r.icaoId === "string" ? r.icaoId.trim().toUpperCase() : ""
  if (!/^[A-Z0-9]{4}$/.test(icao)) return null
  const runways: RunwayInfo[] = []
  for (const w of Array.isArray(r.runways) ? r.runways : []) {
    if (!w || typeof w !== "object") continue
    const rw = w as Record<string, unknown>
    const id = typeof rw.id === "string" ? rw.id.trim() : ""
    if (!id) continue
    const [len, wid] = typeof rw.dimension === "string" ? rw.dimension.split("x").map(num) : [null, null]
    const heading = num(rw.alignment)
    runways.push({
      id,
      trueHeading: heading !== null && heading >= 0 && heading <= 360 ? heading % 360 : null,
      lengthFt: len ?? null,
      widthFt: wid ?? null,
      surface: SURFACE[String(rw.surface ?? "").toUpperCase()] ?? String(rw.surface ?? ""),
    })
  }
  const freqs: [string, string][] = []
  if (typeof r.freqs === "string") {
    for (const part of r.freqs.split(";")) {
      const [name, mhz] = part.split(",").map((s) => s.trim())
      if (name && mhz && /^\d{3}\.\d{1,3}$/.test(mhz)) freqs.push([name, mhz])
    }
  }
  return {
    icao,
    name: typeof r.name === "string" ? r.name.trim() : "",
    variationDeg: variationOf(r.magdec),
    // Longest first: the one a pilot thinks of first.
    runways: runways.sort((a, b) => (b.lengthFt ?? 0) - (a.lengthFt ?? 0)),
    freqs,
  }
}

/** Where kept answers live — MongoDB in the app, a map in the tests. */
export interface AirportInfoStore {
  read(ids: string[]): Promise<Map<string, { at: number; info: AirportInfo | null }>>
  write(entries: { icao: string; at: number; info: AirportInfo | null }[]): Promise<void>
}

export function mongoAirportInfoStore(db: Db): AirportInfoStore {
  const col = db.collection<{ _id: string; at: Date; info: AirportInfo | null }>("airportInfo")
  return {
    async read(ids) {
      const rows = await col.find({ _id: { $in: ids } }).toArray()
      return new Map(rows.map((r) => [r._id, { at: r.at.getTime(), info: r.info }]))
    },
    async write(entries) {
      if (entries.length === 0) return
      await col.bulkWrite(
        entries.map((e) => ({
          replaceOne: { filter: { _id: e.icao }, replacement: { at: new Date(e.at), info: e.info }, upsert: true },
        })),
      )
    },
  }
}

/**
 * The airports' info, from the store where it is fresh and from the source
 * (one request for all the rest) where it is not. A source that fails leaves
 * the kept answers standing and the rest unanswered — never an error for
 * what is already known.
 */
export async function getAirportInfo(
  ids: string[],
  { store, fetchImpl = fetch, now = Date.now() }: { store: AirportInfoStore; fetchImpl?: typeof fetch; now?: number },
): Promise<Record<string, AirportInfo | null>> {
  const kept = await store.read(ids)
  const out: Record<string, AirportInfo | null> = {}
  const ask: string[] = []
  for (const id of ids) {
    const k = kept.get(id)
    const fresh = k && now - k.at < (k.info ? KEEP_MS : KEEP_UNKNOWN_MS)
    if (k) out[id] = k.info
    if (!fresh) ask.push(id)
  }
  if (ask.length === 0) return out
  try {
    const res = await fetchImpl(`${AIRPORT_INFO_SOURCE}?ids=${ask.join(",")}&format=json`, {
      headers: { "user-agent": "OOOI-Logbook/1.0 (airport info; kept 30 days)" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`airport info answered ${res.status}`)
    const body = (await res.json()) as unknown
    if (!Array.isArray(body)) throw new Error("airport info was not a list")
    const found = new Map<string, AirportInfo>()
    for (const r of body) {
      const info = readAirportInfo(r)
      if (info) found.set(info.icao, info)
    }
    const entries = ask.map((icao) => ({ icao, at: now, info: found.get(icao) ?? null }))
    for (const e of entries) out[e.icao] = e.info
    await store.write(entries)
  } catch (e) {
    console.warn("[AirportInfo] source failed:", e)
  }
  return out
}
