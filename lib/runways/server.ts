/**
 * Where the runway geometry LIVES and how it is kept up to date (the owner,
 * Nov 2026: "the csv updates time to time, we need to be able to get our
 * database updated as well … consider the size of storage and the speed at
 * which we can retrieve for processing").
 *
 * | | |
 * |---|---|
 * | stored | MongoDB `runways`: ONE document per airport (`_id` the ICAO, its runways and a fingerprint) — ~10.6k airports, ~3.6MB of JSON before compression. A lookup is a primary-key `$in` for the few airports a duty touches: a few hundred bytes each, never the dataset |
 * | the file's state | one more document, `_id: "~meta"`: the source's ETag / Last-Modified, when it was last checked and loaded, and every airport's fingerprint |
 * | refreshed | at most once a WEEK (`REFRESH_MS`): a conditional GET (`If-None-Match`), so an unchanged file costs a 304 and nothing else; a changed one is read (~200ms) and only the airports whose fingerprint moved are rewritten, the ones gone deleted. Started by the weekly cron (`/api/reference/runways`) and, failing that, by the first lookup that finds the state a week old and wins a lock (`~lock`) — run after its answer is sent |
 * | safety | a file that reads fewer than `MIN_AIRPORTS` airports (an error page) changes nothing; the state is written LAST, so an import cut short is simply done again next time |
 *
 * Pure apart from the store and the fetch, both handed in, so it is tested
 * against a map and the saved file.
 */

import { createHash } from "node:crypto"
import type { Db } from "mongodb"
import { parseRunwaysCsv, RUNWAYS_SOURCE, type AirportRunways } from "./parse"

export const REFRESH_MS = 7 * 86_400_000
const LOCK_MS = 10 * 60_000
/** Fewer than this read off the file and it is not the file. */
export const MIN_AIRPORTS = 5_000
export const RUNWAYS_MAX_IDS = 24
const WRITE_BATCH = 1_000

export interface RunwayMeta {
  etag: string | null
  lastModified: string | null
  /** When the source was last asked — a 304 counts. */
  checkedAt: number
  /** When a file was last read in. */
  loadedAt: number
  airports: number
  hashes: Record<string, string>
}

export interface RunwayStore {
  read(ids: string[]): Promise<Map<string, AirportRunways>>
  /** The file's state — without the fingerprints unless `withHashes` (they are ~300KB; a lookup never needs them). */
  meta(withHashes?: boolean): Promise<RunwayMeta | null>
  /** Take the refresh for a while; false when another holds it. */
  lock(now: number): Promise<boolean>
  /** Write these airports (each with its fingerprint), delete those, then the state. */
  apply(upserts: { ap: AirportRunways; h: string }[], removed: string[], meta: RunwayMeta): Promise<void>
  touch(checkedAt: number): Promise<void>
}

type Doc =
  | { _id: string; h: string; runways: AirportRunways["runways"] }
  | ({ _id: "~meta" } & RunwayMeta)
  | { _id: "~lock"; until: Date }

export function mongoRunwayStore(db: Db): RunwayStore {
  const col = db.collection<Doc>("runways")
  return {
    async read(ids) {
      const rows = (await col.find({ _id: { $in: ids } }).toArray()) as { _id: string; runways: AirportRunways["runways"] }[]
      return new Map(rows.map((r) => [r._id, { icao: r._id, runways: r.runways }]))
    },
    async meta(withHashes = false) {
      const m = (await col.findOne({ _id: "~meta" }, withHashes ? {} : { projection: { hashes: 0 } })) as ({ _id: "~meta" } & RunwayMeta) | null
      if (!m) return null
      const { _id, ...rest } = m
      void _id
      return { ...rest, hashes: rest.hashes ?? {} }
    },
    async lock(now) {
      try {
        const res = await col.updateOne(
          { _id: "~lock", $or: [{ until: { $lt: new Date(now) } }, { until: { $exists: false } }] } as never,
          { $set: { until: new Date(now + LOCK_MS) } } as never,
          { upsert: true },
        )
        return res.upsertedCount > 0 || res.modifiedCount > 0
      } catch (e) {
        // Held: the upsert's insert collides with the lock row.
        if ((e as { code?: number }).code === 11000) return false
        throw e
      }
    },
    async apply(upserts, removed, meta) {
      for (let i = 0; i < upserts.length; i += WRITE_BATCH) {
        await col.bulkWrite(
          upserts.slice(i, i + WRITE_BATCH).map(({ ap, h }) => ({
            replaceOne: { filter: { _id: ap.icao }, replacement: { h, runways: ap.runways } as never, upsert: true },
          })),
          { ordered: false },
        )
      }
      for (let i = 0; i < removed.length; i += WRITE_BATCH) {
        await col.deleteMany({ _id: { $in: removed.slice(i, i + WRITE_BATCH) } })
      }
      await col.replaceOne({ _id: "~meta" }, meta as never, { upsert: true })
    },
    async touch(checkedAt) {
      await col.updateOne({ _id: "~meta" }, { $set: { checkedAt } } as never)
    },
  }
}

/** A record's fingerprint — what a refresh compares to rewrite only what changed. */
export function hashOf(ap: AirportRunways): string {
  return createHash("sha1").update(JSON.stringify(ap.runways)).digest("base64url").slice(0, 12)
}

export interface RefreshResult {
  status: "unchanged" | "updated"
  airports: number
  changed: number
  removed: number
}

/**
 * Bring the store up to the source. `force` reads the file even when the
 * source says it has not changed. Throws when the source fails or answers
 * something that is not the file — the store is then left as it was.
 */
export async function refreshRunways({
  store,
  fetchImpl = fetch,
  now = Date.now(),
  force = false,
}: {
  store: RunwayStore
  fetchImpl?: typeof fetch
  now?: number
  force?: boolean
}): Promise<RefreshResult> {
  const meta = await store.meta(true)
  const headers: Record<string, string> = { "user-agent": "OOOI-Logbook/1.0 (runway geometry; weekly)" }
  if (meta && !force && meta.airports > 0) {
    if (meta.etag) headers["if-none-match"] = meta.etag
    if (meta.lastModified) headers["if-modified-since"] = meta.lastModified
  }
  const res = await fetchImpl(RUNWAYS_SOURCE, { headers, signal: AbortSignal.timeout(20_000), cache: "no-store" })
  if (res.status === 304 && meta) {
    await store.touch(now)
    return { status: "unchanged", airports: meta.airports, changed: 0, removed: 0 }
  }
  if (!res.ok) throw new Error(`runways.csv answered ${res.status}`)
  const parsed = parseRunwaysCsv(await res.text())
  if (parsed.size < MIN_AIRPORTS) throw new Error(`runways.csv read only ${parsed.size} airports`)
  const before = meta?.hashes ?? {}
  const hashes: Record<string, string> = {}
  const upserts: { ap: AirportRunways; h: string }[] = []
  for (const ap of parsed.values()) {
    const h = hashOf(ap)
    hashes[ap.icao] = h
    if (before[ap.icao] !== h) upserts.push({ ap, h })
  }
  const removed = Object.keys(before).filter((icao) => !(icao in hashes))
  await store.apply(upserts, removed, {
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    checkedAt: now,
    loadedAt: now,
    airports: parsed.size,
    hashes,
  })
  return { status: upserts.length || removed.length ? "updated" : "unchanged", airports: parsed.size, changed: upserts.length, removed: removed.length }
}

/**
 * The airports' runways, as the store has them. `loaded` is false until a
 * file has been read in at all — the device must not keep "no runways" from
 * a store that is still empty. A store a week behind the source (or empty)
 * hands `refresh` to `schedule`, once, to the request that wins the lock.
 */
export async function getRunways(
  ids: string[],
  { store, now = Date.now(), schedule }: { store: RunwayStore; now?: number; schedule?: (refresh: () => Promise<unknown>) => void },
): Promise<{ loaded: boolean; data: Record<string, AirportRunways["runways"] | null> }> {
  const [rows, meta] = await Promise.all([store.read(ids), store.meta()])
  if (schedule && (!meta || now - meta.checkedAt > REFRESH_MS) && (await store.lock(now))) {
    schedule(() => refreshRunways({ store, now }))
  }
  const data: Record<string, AirportRunways["runways"] | null> = {}
  for (const id of ids) data[id] = rows.get(id)?.runways ?? null
  return { loaded: !!meta && meta.airports > 0, data }
}
