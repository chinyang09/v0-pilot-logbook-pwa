import { describe, expect, it } from "vitest"
import { ageText, cloudBase, tafLines } from "../format"

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

describe("cloudBase", () => {
  it("writes thousands as k and keeps hundreds", () => {
    expect(cloudBase(800)).toBe("800")
    expect(cloudBase(1100)).toBe("1.1k")
    expect(cloudBase(1500)).toBe("1.5k")
    expect(cloudBase(2000)).toBe("2k")
    expect(cloudBase(10000)).toBe("10k")
    expect(cloudBase(30000)).toBe("30k")
    expect(cloudBase(25000)).toBe("25k")
  })
})
