import { describe, expect, it } from "vitest"
import { favouredRunway, runwayEnds, runwayEndsFrom, windOn } from "../runway-wind"

describe("runwayEnds", () => {
  it("reads both ends of each runway off its designator", () => {
    expect(runwayEnds(["02L/20R", "02C/20C", "15/33"])).toEqual([
      { ident: "02L", headingDeg: 20 },
      { ident: "20R", headingDeg: 200 },
      { ident: "02C", headingDeg: 20 },
      { ident: "20C", headingDeg: 200 },
      { ident: "15", headingDeg: 150 },
      { ident: "33", headingDeg: 330 },
    ])
  })

  it("skips what is not a designator and never lists an end twice", () => {
    expect(runwayEnds(["H1", "2/20", "02/20"]).map((e) => e.ident)).toEqual(["02", "20"])
  })
})

describe("runwayEndsFrom", () => {
  it("puts both ends on the TRUE heading given, else the designator", () => {
    expect(
      runwayEndsFrom([
        { id: "16L/34R", trueHeading: 180 },
        { id: "09/27", trueHeading: null },
      ]),
    ).toEqual([
      { ident: "16L", headingDeg: 180 },
      { ident: "34R", headingDeg: 0 },
      { ident: "09", headingDeg: 90 },
      { ident: "27", headingDeg: 270 },
    ])
  })
})

describe("windOn", () => {
  it("splits the wind into head and cross, with the side it comes from", () => {
    // Addison's picture: 050°/14kt on runway 34 is a tail, on 16 a head.
    const on16 = windOn({ ident: "16", headingDeg: 160 }, 50, 14)
    expect(on16.headKt).toBe(-5)
    expect(on16.crossKt).toBe(13)
    expect(on16.crossFrom).toBe("L")
    const straight = windOn({ ident: "02", headingDeg: 20 }, 20, 15)
    expect(straight).toMatchObject({ headKt: 15, crossKt: 0, crossFrom: null })
    expect(windOn({ ident: "02", headingDeg: 20 }, 110, 10)).toMatchObject({ headKt: 0, crossKt: 10, crossFrom: "R" })
  })
})

describe("favouredRunway", () => {
  const ends = runwayEnds(["02L/20R", "15/33"])

  it("takes the end with the most headwind", () => {
    expect(favouredRunway(ends, 340, 20)?.end.ident).toBe("33")
    expect(favouredRunway(ends, 190, 12)?.end.ident).toBe("20R")
  })

  it("says nothing for a calm or variable wind, or no runways", () => {
    expect(favouredRunway(ends, null, 5)).toBeNull()
    expect(favouredRunway(ends, 90, 0)).toBeNull()
    expect(favouredRunway([], 90, 10)).toBeNull()
  })
})
