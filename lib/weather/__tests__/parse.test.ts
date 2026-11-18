import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseMetarCache, parseTafCache } from "../parse"

// Real entries from the 18 Nov 26 14:50Z cache files, trimmed to six stations.
const metars = readFileSync(path.join(__dirname, "fixtures/metars.sample.xml"), "utf8")
const tafs = readFileSync(path.join(__dirname, "fixtures/tafs.sample.xml"), "utf8")

describe("the weather cache files", () => {
  it("reads every METAR, by station", () => {
    const m = parseMetarCache(metars)
    expect(Object.keys(m).sort()).toEqual(["EEKA", "LWOH", "VHHH", "VTCC", "WIII", "WSSS"])
    expect(m.WSSS).toEqual({
      raw: "METAR WSSS 181430Z 36006KT 9999 FEW016 FEW020CB BKN150 26/25 Q1013 NOSIG",
      at: Date.parse("2026-11-18T14:30:00Z"),
      category: "VFR",
    })
  })

  it("reads a TAF out of its CDATA, with its validity", () => {
    const t = parseTafCache(tafs)
    expect(t.WSSS.raw).toMatch(/^TAF WSSS 181100Z 1812\/1918 02005KT/)
    expect(t.WSSS.from).toBe(Date.parse("2026-11-18T12:00:00Z"))
    expect(t.WSSS.to).toBe(Date.parse("2026-11-19T18:00:00Z"))
  })

  it("keeps the latest TAF where a station has two (an amendment beside the original)", () => {
    const older = tafs.replace(/<TAF><raw_text><!\[CDATA\[TAF WSSS[\s\S]*?<\/TAF>/, (b) =>
      b.replace("TAF WSSS 181100Z", "TAF WSSS 180500Z").replace(/<issue_time>[^<]*<\/issue_time>/, "<issue_time>2026-11-18T05:00:00.000Z</issue_time>"),
    )
    const t = parseTafCache(older.replace("</data>", tafs.match(/<TAF><raw_text><!\[CDATA\[TAF WSSS[\s\S]*?<\/TAF>/)![0] + "</data>"))
    expect(t.WSSS.raw).toMatch(/^TAF WSSS 181100Z/)
  })

  it("reads nothing out of a page that is not a cache file", () => {
    expect(parseMetarCache("<html>Service unavailable</html>")).toEqual({})
  })
})
