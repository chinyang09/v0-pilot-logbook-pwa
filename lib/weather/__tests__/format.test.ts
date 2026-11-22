import { describe, expect, it } from "vitest"
import { ageText, cloudLayer, tafLines } from "../format"

describe("reading a report on a phone", () => {
  it("starts each TAF change group on its own line", () => {
    expect(
      tafLines("TAF WSSS 181100Z 1812/1918 02005KT 9999 FEW015 SCT020 BECMG 1904/1906 18010KT TEMPO 1905/1908 3000 TSRA FEW012CB BKN015 PROB30 1910/1912 4000 FM191400 33003KT"),
    ).toEqual([
      "TAF WSSS 181100Z 1812/1918 02005KT 9999 FEW015 SCT020",
      "BECMG 1904/1906 18010KT",
      "TEMPO 1905/1908 3000 TSRA FEW012CB BKN015",
      "PROB30 1910/1912 4000",
      "FM191400 33003KT",
    ])
  })

  it("says how old an observation is", () => {
    const t = Date.parse("2026-11-18T15:00:00Z")
    expect(ageText(t - 25 * 60_000, t)).toBe("25m ago")
    expect(ageText(t - 125 * 60_000, t)).toBe("2h 5m ago")
  })
})

describe("cloudLayer", () => {
  it("writes a layer as the METAR does", () => {
    expect(cloudLayer("SCT", 800)).toBe("SCT008")
    expect(cloudLayer("BKN", 1100)).toBe("BKN011")
    expect(cloudLayer("BKN", 30000)).toBe("BKN300")
    expect(cloudLayer("OVC", 10000)).toBe("OVC100")
    expect(cloudLayer("VV", 200)).toBe("VV002")
  })
})
