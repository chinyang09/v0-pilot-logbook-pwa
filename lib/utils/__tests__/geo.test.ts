import { describe, expect, it } from "vitest"
import { greatCircleNm, initialCourse, offTrack } from "../geo"

const WSSS = { lat: 1.3592, lon: 103.9893 }
const VTBS = { lat: 13.6826, lon: 100.7485 }
const WMKK = { lat: 2.7456, lon: 101.7099 }

describe("great-circle geometry", () => {
  it("measures Singapore–Bangkok as the charts do (~765nm)", () => {
    expect(Math.round(greatCircleNm(WSSS, VTBS))).toBeGreaterThan(755)
    expect(Math.round(greatCircleNm(WSSS, VTBS))).toBeLessThan(775)
    expect(Math.round(initialCourse(WSSS, VTBS))).toBe(346)
  })

  it("puts Kuala Lumpur off the Singapore–Bangkok track, a short way along it", () => {
    const { crossNm, alongNm } = offTrack(WMKK, WSSS, VTBS)
    expect(crossNm).toBeGreaterThan(80)
    expect(crossNm).toBeLessThan(140)
    expect(alongNm).toBeGreaterThan(60)
    expect(alongNm).toBeLessThan(150)
  })

  it("says a point behind the start is behind it", () => {
    expect(offTrack({ lat: -2, lon: 104.8 }, WSSS, VTBS).alongNm).toBeLessThan(0)
  })
})
