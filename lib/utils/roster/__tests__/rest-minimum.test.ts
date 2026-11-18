import { describe, expect, it } from "vitest"
import { earliestLegalRestEnd } from "../fdp-calculator"
import { restMinimumText } from "@/lib/utils/dashboard/duty-status"

describe("a rest's minimum is said as its rule, not as the wait for the night", () => {
  it("the owner's 18 Nov 26: rest from 10:04Z is 10 hours + a night, legal at 22:00Z", () => {
    const start = Date.parse("2026-11-18T10:04:00Z")
    const r = earliestLegalRestEnd(start, 9 * 60 + 4, null)
    // The local night (8h inside 22:00–08:00 SGT) is not in until 06:00 SGT.
    expect(new Date(r.legalAtMs).toISOString()).toBe("2026-11-18T22:00:00.000Z")
    expect(r.requiredRestMinutes).toBe(11 * 60 + 56)
    expect(r.rule).toBe("3a")
    expect(r.minimumMinutes).toBe(600)
    expect(r.withNight).toBe(true)
    expect(restMinimumText({ requiredMinutes: r.requiredRestMinutes, minimumMinutes: r.minimumMinutes, withNight: r.withNight })).toBe("10:00 + night")
  })

  it("without a night in reach, the 12 hours of 3(1)(b)", () => {
    // Rest from 07:00 SGT: the next night is not in until 06:00 SGT tomorrow,
    // so 12 hours comes first.
    const start = Date.parse("2026-11-18T23:00:00Z")
    const r = earliestLegalRestEnd(start, 8 * 60, null)
    expect(r.withNight).toBe(false)
    expect(restMinimumText({ requiredMinutes: r.requiredRestMinutes, minimumMinutes: r.minimumMinutes, withNight: r.withNight })).toBe("12:00")
  })
})
