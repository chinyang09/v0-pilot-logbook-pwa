import { describe, expect, it, vi } from "vitest"
import { gzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import path from "node:path"
import { FRESH_MS, getWeather, REFRESH_MS, type WeatherKind, type WeatherStore } from "../server"

const sample = (f: string) => readFileSync(path.join(__dirname, "fixtures", f), "utf8")
// Pad the samples past the "is this the cache file" floor with filler stations.
const pad = (xml: string, tag: string) => {
  const one = xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`))![0]
  const filler = Array.from({ length: 250 }, (_, i) => one.replace(/<station_id>\w+<\/station_id>/, `<station_id>X${String(i).padStart(3, "0")}</station_id>`)).join("")
  return xml.replace("</data>", filler + "</data>")
}
const files = { metar: gzipSync(pad(sample("metars.sample.xml"), "METAR")), taf: gzipSync(pad(sample("tafs.sample.xml"), "TAF")) }

function memoryStore() {
  const docs = new Map<WeatherKind, { fetchedAt: number; stations: Record<string, unknown> }>()
  const locks = new Map<WeatherKind, number>()
  const store: WeatherStore = {
    async read(kind, ids) {
      const d = docs.get(kind)
      if (!d) return null
      return { fetchedAt: d.fetchedAt, stations: Object.fromEntries(ids.filter((i) => d.stations[i]).map((i) => [i, d.stations[i]])) as never }
    },
    async write(kind, fetchedAt, stations) {
      docs.set(kind, { fetchedAt, stations })
    },
    async lock(kind, now) {
      if ((locks.get(kind) ?? 0) > now) return false
      locks.set(kind, now + 60_000)
      return true
    },
  }
  return { store, docs, locks }
}

const okFetch = () =>
  vi.fn(async (url: string) => new Response(url.includes("metars") ? files.metar : files.taf, { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>

describe("the weather cache, refreshed on demand", () => {
  const t0 = Date.parse("2026-11-18T15:00:00Z")

  it("pulls both files once, then answers from the snapshot for ten minutes", async () => {
    const { store } = memoryStore()
    const fetchImpl = okFetch()
    const first = await getWeather(["WSSS", "VTCC"], { store, fetchImpl, now: t0 })
    expect(first.metar.WSSS.raw).toMatch(/^METAR WSSS/)
    expect(first.taf.VTCC.raw).toMatch(/^TAF VTCC/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await getWeather(["WIII"], { store, fetchImpl, now: t0 + REFRESH_MS - 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await getWeather(["WIII"], { store, fetchImpl, now: t0 + REFRESH_MS + 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it("answers only the stations asked for", async () => {
    const { store } = memoryStore()
    const w = await getWeather(["WSSS"], { store, fetchImpl: okFetch(), now: t0 })
    expect(Object.keys(w.metar)).toEqual(["WSSS"])
  })

  it("serves the old snapshot, said to be stale, when the source fails", async () => {
    const { store, locks } = memoryStore()
    await getWeather(["WSSS"], { store, fetchImpl: okFetch(), now: t0 })
    locks.clear()
    const down = vi.fn(async () => new Response("<html>Service Unavailable</html>", { status: 200 })) as unknown as typeof fetch
    const w = await getWeather(["WSSS"], { store, fetchImpl: down, now: t0 + REFRESH_MS + 1 })
    expect(w.stale).toBe(true)
    expect(w.metar.WSSS.raw).toMatch(/^METAR WSSS/)
    expect(w.fetchedAt.metar).toBe(t0)
  })

  it("lets one request refresh: another arriving meanwhile reads the snapshot there is", async () => {
    const { store, locks } = memoryStore()
    const fetchImpl = okFetch()
    await getWeather(["WSSS"], { store, fetchImpl, now: t0 })
    // Stale now, and another request holds both locks.
    locks.set("metar", Infinity)
    locks.set("taf", Infinity)
    const w = await getWeather(["WSSS"], { store, fetchImpl, now: t0 + REFRESH_MS + 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(w.metar.WSSS.raw).toMatch(/^METAR WSSS/)
    expect(w.stale).toBe(false)
  })

  it("a Refresh pulls a snapshot over two minutes old, not one newer", async () => {
    const { store, locks } = memoryStore()
    const fetchImpl = okFetch()
    await getWeather(["WSSS"], { store, fetchImpl, now: t0 })
    locks.clear()
    const recent = await getWeather(["WSSS"], { store, fetchImpl, now: t0 + FRESH_MS - 1, fresh: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(recent.checkedAt).toBe(t0 + FRESH_MS - 1)
    await getWeather(["WSSS"], { store, fetchImpl, now: t0 + FRESH_MS + 1, fresh: true })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})
