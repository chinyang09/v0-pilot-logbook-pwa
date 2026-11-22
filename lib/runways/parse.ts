/**
 * Runway GEOMETRY, from OurAirports' `runways.csv` (the owner, Nov 2026:
 * "this gives coordinates for the runways … for calculation of runway in use
 * together with the FR24 API"). Public domain, updated from time to time at
 * `RUNWAYS_SOURCE`.
 *
 * What the app keeps of each runway is what telling a runway in USE needs —
 * each end's THRESHOLD position, its TRUE heading, its elevation and any
 * displaced threshold — plus the length, width and surface a pilot reads:
 *
 * | kept | |
 * |---|---|
 * | airports | ICAO idents (four letters) only — the app keys airports by ICAO, and the ~38k FAA-local fields and heliports are not where an airline goes |
 * | runways | open ones with a runway designator ("H1" helipads are not); an airport with no placed threshold is kept only with a runway of `MIN_LENGTH_FT` or more |
 * | heading | from the two thresholds' coordinates where both are given (the great circle between them — exact), else the file's `heading_degT`, else the designator ×10 (magnetic, marked `approx`) |
 *
 * One airport's runways are one RECORD (`AirportRunways`), longest first, so
 * the store holds one small document per airport and a lookup is one
 * primary-key read.
 *
 * Pure and browser-safe (the device reads its types and `isPlaced`): the CSV
 * is read without the network.
 */

import { initialCourse } from "@/lib/utils/geo"

export const RUNWAYS_SOURCE = "https://davidmegginson.github.io/ourairports-data/runways.csv"

export interface RunwayEndGeo {
  /** "02L". */
  ident: string
  /** The threshold — null when the file gives no position for this end. */
  lat: number | null
  lon: number | null
  /** Feet; absent when not given. */
  elevFt?: number
  /** TRUE heading, degrees. */
  headingDeg: number
  /** The heading is the designator's (magnetic, rounded), not the file's. */
  approx?: true
  /** Feet the landing threshold is moved down the runway; absent when none. */
  displacedFt?: number
}

export interface RunwayGeo {
  /** "02L/20R". */
  id: string
  lengthFt: number | null
  widthFt: number | null
  /** As the file codes it: "ASP", "CON", "PEM", "GRS"… */
  surface: string
  lighted: boolean
  /** The low end and the high end. */
  ends: [RunwayEndGeo, RunwayEndGeo | null]
}

export interface AirportRunways {
  icao: string
  runways: RunwayGeo[]
}

/** One CSV line into its fields — quoted fields may hold commas and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const ICAO = /^[A-Z]{4}$/
/** An airport none of whose ends is placed is kept only with a runway at least this long. */
export const MIN_LENGTH_FT = 3000
const DESIGNATOR = /^(\d{1,2})([LCR]?)$/

/** "2" → "02", "02l" → "02L"; null for anything that is not a runway designator. */
function designator(raw: string): { ident: string; magnetic: number } | null {
  const m = DESIGNATOR.exec(raw.trim().toUpperCase())
  if (!m) return null
  const n = Number(m[1])
  if (n < 1 || n > 36) return null
  return { ident: `${String(n).padStart(2, "0")}${m[2]}`, magnetic: (n * 10) % 360 }
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp

/**
 * Every airport's runways in the file. Lines that are not runways the app
 * can use are skipped, never fatal — a file with a bad line still reads.
 */
export function parseRunwaysCsv(text: string): Map<string, AirportRunways> {
  const lines = text.split(/\r?\n/)
  const head = splitCsvLine(lines[0] ?? "")
  const col = (name: string) => head.indexOf(name)
  const I = {
    ident: col("airport_ident"),
    length: col("length_ft"),
    width: col("width_ft"),
    surface: col("surface"),
    lighted: col("lighted"),
    closed: col("closed"),
    le: ["le_ident", "le_latitude_deg", "le_longitude_deg", "le_elevation_ft", "le_heading_degT", "le_displaced_threshold_ft"].map(col),
    he: ["he_ident", "he_latitude_deg", "he_longitude_deg", "he_elevation_ft", "he_heading_degT", "he_displaced_threshold_ft"].map(col),
  }
  const out = new Map<string, AirportRunways>()
  if (I.ident < 0 || I.le[0] < 0) return out
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n]
    if (!line) continue
    const f = splitCsvLine(line)
    const icao = (f[I.ident] ?? "").trim().toUpperCase()
    if (!ICAO.test(icao)) continue
    if (f[I.closed] === "1") continue
    const raw = (idx: number[]) => ({
      d: designator(f[idx[0]] ?? ""),
      lat: num(f[idx[1]]),
      lon: num(f[idx[2]]),
      elev: num(f[idx[3]]),
      hdg: num(f[idx[4]]),
      disp: num(f[idx[5]]) ?? 0,
    })
    const lo = raw(I.le)
    const hi = raw(I.he)
    if (!lo.d && !hi.d) continue
    const placed = (e: typeof lo) => e.lat !== null && e.lon !== null && (e.lat !== 0 || e.lon !== 0)
    // Both thresholds placed: the heading is the line between them.
    const both = placed(lo) && placed(hi)
    const courseLo = both ? initialCourse({ lat: lo.lat!, lon: lo.lon! }, { lat: hi.lat!, lon: hi.lon! }) : null
    const courseHi = both ? initialCourse({ lat: hi.lat!, lon: hi.lon! }, { lat: lo.lat!, lon: lo.lon! }) : null
    const endOf = (e: typeof lo, course: number | null, other: typeof lo): RunwayEndGeo | null => {
      if (!e.d) return null
      const fromFile = e.hdg !== null && e.hdg >= 0 && e.hdg <= 360 ? e.hdg % 360 : other.hdg !== null ? (other.hdg + 180) % 360 : null
      const heading = course ?? fromFile
      return {
        ident: e.d.ident,
        lat: placed(e) ? round(e.lat!, 6) : null,
        lon: placed(e) ? round(e.lon!, 6) : null,
        ...(e.elev !== null ? { elevFt: e.elev } : {}),
        headingDeg: round(heading ?? e.d.magnetic, 1),
        ...(heading === null ? { approx: true as const } : {}),
        ...(e.disp > 0 ? { displacedFt: e.disp } : {}),
      }
    }
    const a = endOf(lo, courseLo, hi)
    const b = endOf(hi, courseHi, lo)
    const first = a ?? b!
    const second = a ? b : null
    const rw: RunwayGeo = {
      id: second ? `${first.ident}/${second.ident}` : first.ident,
      lengthFt: num(f[I.length]),
      widthFt: num(f[I.width]),
      surface: (f[I.surface] ?? "").trim().toUpperCase(),
      lighted: f[I.lighted] === "1",
      ends: [first, second],
    }
    const ap = out.get(icao) ?? { icao, runways: [] }
    ap.runways.push(rw)
    out.set(icao, ap)
  }
  for (const [icao, ap] of out) {
    // A strip too short for anything the app logs, with no placed end, is not kept.
    if (!isPlaced(ap) && !ap.runways.some((r) => (r.lengthFt ?? 0) >= MIN_LENGTH_FT)) {
      out.delete(icao)
      continue
    }
    ap.runways.sort((x, y) => (y.lengthFt ?? 0) - (x.lengthFt ?? 0) || x.id.localeCompare(y.id))
  }
  return out
}

/** Whether any end of an airport's runways is placed — what the in-use reading needs. */
export function isPlaced(ap: AirportRunways | null | undefined): boolean {
  return !!ap?.runways.some((r) => r.ends.some((e) => e && e.lat !== null))
}
