import { describe, it, expect } from "vitest"
import { parseTaf } from "@/lib/weather/brief"
import { alternateConcerns, parseMinima } from "../alternate-wx"

const issued = Date.parse("2026-11-22T11:00:00Z")
const at = (h: number) => Date.parse("2026-11-22T00:00:00Z") + h * 3_600_000
const taf = parseTaf(
  "TAF WBKK 221100Z 2212/2318 VRB03KT 9999 FEW016 SCT150 TEMPO 2214/2218 4000 TSRA FEW015CB BECMG 2220/2222 3000 -RA BR BKN008 PROB30 TEMPO 2300/2303 0800 FG",
  issued,
)

describe("an alternate's forecast over the time it could be needed", () => {
  it("names a TEMPO thunderstorm and its visibility as a caution", () => {
    expect(alternateConcerns(taf, at(15), at(17), "630FT/2400M")).toEqual([
      { tag: "TEMPO", words: ["TSRA", "Vis 4000m"], fromMs: at(15), toMs: at(17), severity: "caution" },
    ])
  })

  it("leaves light rain unnamed, but not the ceiling and visibility that come with it", () => {
    const c = alternateConcerns(taf, at(21), at(22), "200FT/550M")
    expect(c.map((x) => [x.tag, x.words])).toEqual([["BECMG", ["Vis 3000m", "Ceiling 800ft"]]])
  })

  it("is UNSUITABLE where the forecast is below the alternate's own minima", () => {
    const c = alternateConcerns(taf, at(24), at(26), "200FT/1000M")
    expect(c.find((x) => x.tag === "PROB30 TEMPO")).toMatchObject({ words: ["FG", "Vis 800m"], severity: "unsuitable" })
  })

  it("says nothing of a quiet window", () => {
    expect(alternateConcerns(taf, at(12), at(13), "200FT/550M")).toEqual([])
  })

  it("reads the OFP's minima", () => {
    expect(parseMinima("312FT/1000M")).toEqual({ ft: 312, m: 1000 })
    expect(parseMinima("")).toEqual({ ft: null, m: null })
  })
})
