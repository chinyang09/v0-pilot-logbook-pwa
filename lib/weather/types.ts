/**
 * METAR and TAF, as the app keeps and shows them: the RAW report a pilot
 * reads, with the few fields the app orders and ages them by. Everything
 * decoded (wind, cloud, category) can be read off the raw text later; the
 * raw text is what a briefing uses.
 */

export interface MetarReport {
  /** "METAR WSSS 181430Z 36006KT …" */
  raw: string
  /** Observation time, ms. */
  at: number
  /** VFR / MVFR / IFR / LIFR as the source classed it, "" where it did not. */
  category: string
}

export interface TafReport {
  /** "TAF WSSS 181100Z 1812/1918 …" */
  raw: string
  /** Issue time, ms. */
  issued: number
  /** Valid from / to, ms. */
  from: number
  to: number
  /** Where the aerodrome is — read from the file to build the alternates index, never stored on the report. */
  lat?: number
  lon?: number
}

/** The answer for a set of stations. A station the source has nothing for is absent. */
export interface WeatherAnswer {
  metar: Record<string, MetarReport>
  taf: Record<string, TafReport>
  /** When each cache was last pulled from the source, ms (0 = never). */
  fetchedAt: { metar: number; taf: number }
  /** When the server answered, ms — what "Checked 14:32Z" says. */
  checkedAt: number
  /** True when a refresh was due but could not run (the source was down, or another request holds it). */
  stale: boolean
}

/** At most this many stations in one request — a duty touches a handful. */
export const WEATHER_MAX_IDS = 24

/** A station identifier: four letters or digits (ICAO). */
export const isStationId = (s: string) => /^[A-Z0-9]{4}$/.test(s)
