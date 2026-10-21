import { describe, it, expect } from "vitest"
import { suggestToLdg } from "../to-ldg-suggestion"

const none = { dayTakeoffs: 0, nightTakeoffs: 0, dayLandings: 0, nightLandings: 0 }

describe("suggestToLdg", () => {
  it("says nothing when the report agrees with the sun", () => {
    expect(suggestToLdg({ ...none, dayTakeoffs: 1, dayLandings: 1 }, true, false, false)).toEqual({})
  })

  it("moves the report's split to the sun's", () => {
    // eCrew: day takeoff, the sun 78° below the horizon.
    expect(suggestToLdg({ ...none, dayTakeoffs: 1, nightLandings: 1 }, true, true, true)).toEqual({
      suggestedDayTakeoffs: 0,
      suggestedNightTakeoffs: 1,
    })
  })

  it("gives a PF sector the landing the report left out", () => {
    // 05/08/25 SWA→SIN: eCrew records a night landing and no takeoff.
    expect(suggestToLdg({ ...none, nightLandings: 1 }, true, true, true)).toEqual({
      suggestedDayTakeoffs: 0,
      suggestedNightTakeoffs: 1,
    })
    // 22/07/25 BKI→SIN: a day takeoff and no landing.
    expect(suggestToLdg({ ...none, dayTakeoffs: 1 }, true, false, false)).toEqual({
      suggestedDayLandings: 1,
      suggestedNightLandings: 0,
    })
  })

  it("gives a monitoring sector nothing", () => {
    expect(suggestToLdg(none, false, true, true)).toEqual({})
  })
})
