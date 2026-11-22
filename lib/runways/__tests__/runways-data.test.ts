import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isPlaced, parseRunwaysCsv, splitCsvLine } from "../parse"
import { getRunways, hashOf, MIN_AIRPORTS, REFRESH_MS, refreshRunways, type RunwayMeta, type RunwayStore } from "../server"
import type { AirportRunways } from "../parse"

// A real excerpt of OurAirports' runways.csv (public domain), Nov 2026.
const SAMPLE = readFileSync(join(__dirname, "fixtures/runways-sample.csv"), "utf8")

describe("parseRunwaysCsv", () => {
  const all = parseRunwaysCsv(SAMPLE)

  it("splits quoted fields", () => {
    expect(splitCsvLine('1,"a,b","say ""hi""",')).toEqual(["1", "a,b", 'say "hi"', ""])
  })

  it("keeps ICAO airports only, with their open runways, longest first", () => {
    expect(all.has("00AK")).toBe(false)
    expect(all.has("00A")).toBe(false)
    const ksea = all.get("KSEA")!
    // The closed "lower/high" row is gone.
    expect(ksea.runways.map((r) => r.id)).toEqual(["16L/34R", "16C/34C", "16R/34L"])
  })

  it("reads each end's threshold, elevation and displaced threshold", () => {
    const wsss = all.get("WSSS")!
    expect(wsss.runways.map((r) => r.id).sort()).toEqual(["02C/20C", "02L/20R", "02R/20L"])
    const r = wsss.runways.find((x) => x.id === "02L/20R")!
    expect(r.ends[0]).toMatchObject({ ident: "02L", lat: 1.34897, lon: 103.977997, elevFt: 22 })
    expect(r.ends[1]).toMatchObject({ ident: "20R", displacedFt: 2429 })
    expect(r.ends[0].displacedFt).toBeUndefined()
  })

  it("takes the TRUE heading from the line between the thresholds", () => {
    const r = all.get("WSSS")!.runways.find((x) => x.id === "02L/20R")!
    // The file says 23 / 203; the thresholds put it at 22.7.
    expect(r.ends[0].headingDeg).toBeCloseTo(22.7, 0)
    expect(r.ends[1]!.headingDeg).toBeCloseTo(202.7, 0)
    expect(r.ends[0].approx).toBeUndefined()
  })

  it("says whether an airport's thresholds are placed", () => {
    expect(isPlaced(all.get("WSSS"))).toBe(true)
    expect(isPlaced(null)).toBe(false)
  })

  it("fingerprints a record by its runways", () => {
    const a = all.get("WSSS")!
    expect(hashOf(a)).toBe(hashOf({ ...a }))
    expect(hashOf(a)).not.toBe(hashOf(all.get("VTBS")!))
  })
})

/** The store as a map, as MongoDB would hold it. */
function memoryStore() {
  const docs = new Map<string, AirportRunways>()
  let meta: RunwayMeta | null = null
  let lockedUntil = 0
  const writes = { upserts: 0, removed: 0 }
  const store: RunwayStore = {
    async read(ids) {
      return new Map(ids.filter((id) => docs.has(id)).map((id) => [id, docs.get(id)!]))
    },
    async meta(withHashes) {
      return meta && { ...meta, hashes: withHashes ? meta.hashes : {} }
    },
    async lock(now) {
      if (now < lockedUntil) return false
      lockedUntil = now + 600_000
      return true
    },
    async apply(upserts, removed, m) {
      for (const { ap } of upserts) docs.set(ap.icao, ap)
      for (const id of removed) docs.delete(id)
      writes.upserts += upserts.length
      writes.removed += removed.length
      meta = m
    },
    async touch(at) {
      if (meta) meta = { ...meta, checkedAt: at }
    },
  }
  return { store, docs, writes, getMeta: () => meta }
}

/** The sample, then each of its rows again under a made-up ident, so it reads as a whole file. */
function bigFile(drop: string[] = []) {
  const [head, ...rows] = SAMPLE.trim().split("\n")
  const out = [head, ...rows]
  for (let n = 0; out.length < MIN_AIRPORTS * 1.3; n++) {
    const row = rows[n % rows.length]
    const tag = String.fromCharCode(65 + (n % 26), 65 + (Math.floor(n / 26) % 26), 65 + (Math.floor(n / 676) % 26))
    out.push(row.replace(/"([A-Z]{4})"/, `"Q${tag}"`))
  }
  return out.filter((line) => !drop.some((d) => line.includes(`"${d}"`))).join("\n")
}

const fetchFrom = (body: string, etag = '"v1"', calls: RequestInit[] = []) =>
  (async (_url: string, init: RequestInit) => {
    calls.push(init)
    const h = (init.headers ?? {}) as Record<string, string>
    if (h["if-none-match"] === etag) return new Response(null, { status: 304 })
    return new Response(body, { status: 200, headers: { etag } })
  }) as unknown as typeof fetch

describe("refreshRunways", () => {
  it("loads the file, then asks conditionally and writes nothing when it has not changed", async () => {
    const { store, writes, docs } = memoryStore()
    const calls: RequestInit[] = []
    const first = await refreshRunways({ store, fetchImpl: fetchFrom(bigFile(), '"v1"', calls), now: 1 })
    expect(first.status).toBe("updated")
    expect(docs.get("WSSS")?.runways.length).toBe(3)
    const after = writes.upserts
    const second = await refreshRunways({ store, fetchImpl: fetchFrom(bigFile(), '"v1"', calls), now: 2 })
    expect(second.status).toBe("unchanged")
    expect(writes.upserts).toBe(after)
    expect((calls[1].headers as Record<string, string>)["if-none-match"]).toBe('"v1"')
  })

  it("rewrites only what changed, and deletes what the file dropped", async () => {
    const { store, writes, docs } = memoryStore()
    await refreshRunways({ store, fetchImpl: fetchFrom(bigFile(), '"v1"'), now: 1 })
    const before = writes.upserts
    const changed = bigFile(["YSSY"]).replace('"WSSS",13123', '"WSSS",13200')
    const r = await refreshRunways({ store, fetchImpl: fetchFrom(changed, '"v2"'), now: 2 })
    expect(r.changed).toBe(1)
    expect(writes.upserts - before).toBe(1)
    expect(r.removed).toBeGreaterThan(0)
    expect(docs.has("YSSY")).toBe(false)
  })

  it("keeps the store when the source answers something that is not the file", async () => {
    const { store, getMeta } = memoryStore()
    await expect(refreshRunways({ store, fetchImpl: fetchFrom("<html>oops</html>"), now: 1 })).rejects.toThrow()
    expect(getMeta()).toBeNull()
  })
})

describe("getRunways", () => {
  it("answers from the store and is not loaded before a file is read", async () => {
    const { store } = memoryStore()
    const scheduled: unknown[] = []
    const r = await getRunways(["WSSS"], { store, now: 1, schedule: (f) => scheduled.push(f) })
    expect(r).toEqual({ loaded: false, data: { WSSS: null } })
    // An empty store is refreshed — once, by the request that wins the lock.
    expect(scheduled.length).toBe(1)
    await getRunways(["WSSS"], { store, now: 2, schedule: (f) => scheduled.push(f) })
    expect(scheduled.length).toBe(1)
  })

  it("refreshes a week-old store after answering", async () => {
    const { store } = memoryStore()
    await refreshRunways({ store, fetchImpl: fetchFrom(bigFile()), now: 1 })
    const scheduled: unknown[] = []
    const fresh = await getRunways(["WSSS", "ZZZZ"], { store, now: 2, schedule: (f) => scheduled.push(f) })
    expect(fresh.loaded).toBe(true)
    expect(fresh.data.WSSS?.length).toBe(3)
    expect(fresh.data.ZZZZ).toBeNull()
    expect(scheduled.length).toBe(0)
    await getRunways(["WSSS"], { store, now: 2 + REFRESH_MS + 1, schedule: (f) => scheduled.push(f) })
    expect(scheduled.length).toBe(1)
  })
})
