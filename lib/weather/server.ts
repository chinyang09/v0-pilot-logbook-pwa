/**
 * The weather cache — SERVER only (MongoDB, Node's zlib).
 *
 * aviationweather.gov rewrites a file of every current METAR and every
 * current TAF once a minute (~350KB gzipped each). Its API allows 100
 * requests a minute and asks heavy users onto those files, so this is the
 * shape that stays inside every free limit:
 *
 * | | |
 * |---|---|
 * | what is stored | ONE snapshot document per kind in `weatherCache` (`_id: "metar"` / `"taf"`): the raw report of every station, ~0.7MB and ~1.1MB, replaced whole |
 * | when it is refreshed | ON DEMAND: a request that finds its snapshot older than `REFRESH_MS` pulls the file — at most two upstream requests per 10 minutes, and none while nobody looks |
 * | who refreshes | the one request that wins a short lock (`lock:metar`); every other request is answered from the snapshot it has |
 * | what a request reads | only its stations, by projection — a few hundred bytes, not the document |
 *
 * Cloudflare was considered and is not it: a free Worker has 10ms of CPU per
 * invocation, and unzipping and reading 9MB of XML takes longer than that. A
 * Vercel cron on the free plan runs once a day. Everything stored is the whole
 * world, not just the pilot's airports, because a later feature (alternates,
 * en-route) will want stations nobody asked for yet, and it costs one document.
 */

import { gunzipSync } from "node:zlib"
import type { Db } from "mongodb"
import { parseMetarCache, parseTafCache } from "./parse"
import type { MetarReport, TafReport, WeatherAnswer } from "./types"

export type WeatherKind = "metar" | "taf"
type Report<K extends WeatherKind> = K extends "metar" ? MetarReport : TafReport

export const WEATHER_SOURCE = "https://aviationweather.gov/data/cache/"
const FILE: Record<WeatherKind, string> = { metar: "metars.cache.xml.gz", taf: "tafs.cache.xml.gz" }
/** METARs come half-hourly or hourly, TAFs six-hourly with amendments: ten minutes is fresh. */
export const REFRESH_MS = 10 * 60_000
/**
 * How old a snapshot may be when the pilot asks for FRESH weather (Refresh):
 * the source rewrites its files every minute, so a snapshot two minutes old is
 * as new as asking again would get — and a refresh tapped twice stays one pull.
 */
export const FRESH_MS = 2 * 60_000
/** Long enough for one pull; short enough that a crashed refresh frees itself. */
const LOCK_MS = 60_000
/** Fewer stations than this is not the cache file — an error page, a truncated download. */
const MIN_STATIONS = 200

/** Where snapshots live — MongoDB in the app, a map in the tests. */
export interface WeatherStore {
  /** The snapshot's age and the asked-for stations, or null when there is none. */
  read<K extends WeatherKind>(kind: K, ids: string[]): Promise<{ fetchedAt: number; stations: Record<string, Report<K>> } | null>
  write<K extends WeatherKind>(kind: K, fetchedAt: number, stations: Record<string, Report<K>>): Promise<void>
  /** True when this caller may refresh `kind` now. */
  lock(kind: WeatherKind, now: number): Promise<boolean>
}

export function mongoWeatherStore(db: Db): WeatherStore {
  const col = db.collection<{ _id: string; fetchedAt?: Date; stations?: Record<string, unknown>; until?: Date }>("weatherCache")
  return {
    async read(kind, ids) {
      const projection: Record<string, 1> = { fetchedAt: 1 }
      for (const id of ids) projection[`stations.${id}`] = 1
      const doc = await col.findOne({ _id: kind }, { projection })
      if (!doc?.fetchedAt) return null
      return { fetchedAt: doc.fetchedAt.getTime(), stations: (doc.stations ?? {}) as never }
    },
    async write(kind, fetchedAt, stations) {
      await col.replaceOne({ _id: kind }, { fetchedAt: new Date(fetchedAt), stations }, { upsert: true })
    },
    async lock(kind, now) {
      try {
        const res = await col.updateOne(
          { _id: `lock:${kind}`, $or: [{ until: { $lt: new Date(now) } }, { until: { $exists: false } }] },
          { $set: { until: new Date(now + LOCK_MS) } },
          { upsert: true },
        )
        return res.upsertedCount > 0 || res.modifiedCount > 0
      } catch (e) {
        // The lock row exists and is held: the upsert's insert collides.
        if ((e as { code?: number }).code === 11000) return false
        throw e
      }
    },
  }
}

/** Pull and read one cache file. Throws when it is not the file. */
export async function pullCache<K extends WeatherKind>(kind: K, fetchImpl: typeof fetch = fetch): Promise<Record<string, Report<K>>> {
  const res = await fetchImpl(WEATHER_SOURCE + FILE[kind], {
    headers: { "user-agent": "OOOI-Logbook/1.0 (weather cache; on demand)" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`${FILE[kind]} answered ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // gzip, unless something on the way already inflated it.
  const xml = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8")
  const stations = (kind === "metar" ? parseMetarCache(xml) : parseTafCache(xml)) as Record<string, Report<K>>
  if (Object.keys(stations).length < MIN_STATIONS) throw new Error(`${FILE[kind]} held no reports`)
  return stations
}

const pick = <T>(all: Record<string, T>, ids: string[]) => {
  const out: Record<string, T> = {}
  for (const id of ids) if (all[id]) out[id] = all[id]
  return out
}

/**
 * The METARs and TAFs for `ids`, refreshing a stale snapshot first when this
 * request may. A refresh that fails answers from the snapshot there is,
 * marked `stale` — old weather said to be old beats none.
 */
export async function getWeather(
  ids: string[],
  {
    store,
    fetchImpl = fetch,
    now = Date.now(),
    fresh = false,
  }: { store: WeatherStore; fetchImpl?: typeof fetch; now?: number; fresh?: boolean },
): Promise<WeatherAnswer> {
  let stale = false
  const maxAge = fresh ? FRESH_MS : REFRESH_MS
  const answer = async <K extends WeatherKind>(kind: K) => {
    const snap = await store.read(kind, ids)
    if (snap && now - snap.fetchedAt <= maxAge) return snap
    if (!(await store.lock(kind, now))) {
      // Another request is pulling it; this one answers from what there is.
      if (!snap || now - snap.fetchedAt > 2 * REFRESH_MS) stale = true
      return snap
    }
    try {
      const stations = await pullCache(kind, fetchImpl)
      await store.write(kind, now, stations)
      return { fetchedAt: now, stations: pick(stations, ids) }
    } catch (e) {
      console.warn(`[Weather] ${kind} refresh failed:`, e)
      stale = true
      return snap
    }
  }
  const [metar, taf] = await Promise.all([answer("metar"), answer("taf")])
  return {
    metar: metar?.stations ?? {},
    taf: taf?.stations ?? {},
    fetchedAt: { metar: metar?.fetchedAt ?? 0, taf: taf?.fetchedAt ?? 0 },
    checkedAt: now,
    stale,
  }
}
