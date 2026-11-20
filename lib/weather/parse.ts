/**
 * Reading aviationweather.gov's cache files (`metars.cache.xml.gz`,
 * `tafs.cache.xml.gz`): every current METAR and TAF in the world, rewritten
 * once a minute. One download of each answers every airport, where the API
 * would take a request per few stations at 100 a minute — so the cache files
 * ARE the prudent way in, and these keep what the app shows.
 *
 * The files are one long line of XML; each report is its own element, read
 * by tag. A station with more than one TAF (an amendment beside the original)
 * keeps the latest issued; a METAR the latest observed.
 */

import type { MetarReport, TafReport } from "./types"

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`).exec(block)
  return m ? m[1].trim() : ""
}
const time = (s: string) => {
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

export function parseMetarCache(xml: string): Record<string, MetarReport> {
  const out: Record<string, MetarReport> = {}
  for (const m of xml.matchAll(/<METAR>([\s\S]*?)<\/METAR>/g)) {
    const block = m[1]
    const id = tag(block, "station_id").toUpperCase()
    const raw = tag(block, "raw_text")
    if (!/^[A-Z0-9]{3,4}$/.test(id) || !raw) continue
    const report: MetarReport = { raw, at: time(tag(block, "observation_time")), category: tag(block, "flight_category") }
    if (!out[id] || report.at > out[id].at) out[id] = report
  }
  return out
}

export function parseTafCache(xml: string): Record<string, TafReport> {
  const out: Record<string, TafReport> = {}
  for (const m of xml.matchAll(/<TAF>([\s\S]*?)<\/TAF>/g)) {
    const block = m[1]
    const id = tag(block, "station_id").toUpperCase()
    const raw = tag(block, "raw_text")
    if (!/^[A-Z0-9]{3,4}$/.test(id) || !raw) continue
    const report: TafReport = {
      raw,
      issued: time(tag(block, "issue_time")),
      from: time(tag(block, "valid_time_from")),
      to: time(tag(block, "valid_time_to")),
    }
    const lat = Number(tag(block, "latitude"))
    const lon = Number(tag(block, "longitude"))
    if (tag(block, "latitude") && Number.isFinite(lat) && Number.isFinite(lon)) {
      report.lat = lat
      report.lon = lon
    }
    if (!out[id] || report.issued > out[id].issued) out[id] = report
  }
  return out
}
