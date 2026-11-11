import { describe, expect, it } from "vitest"
import { logbookNowIndex } from "../logbook-now"

const f = (date: string, flown: boolean) => ({ date, outTime: flown ? "01:00" : "", inTime: flown ? "03:00" : "" })

describe("logbookNowIndex — where the logbook opens", () => {
  const today = "2026-11-10"

  it("is the top when nothing is ahead", () => {
    expect(logbookNowIndex([f("2026-11-09", true), f("2026-11-01", true)], today)).toBe(0)
    expect(logbookNowIndex([], today)).toBe(0)
  })

  it("is the NEXT flight to fly — the last of the rows still ahead", () => {
    const list = [f("2026-11-20", false), f("2026-11-15", false), f("2026-11-12", false), f("2026-11-09", true)]
    expect(logbookNowIndex(list, today)).toBe(2)
  })

  it("on a part-flown day is the leg still to fly, with the flown one beneath", () => {
    const list = [f("2026-11-15", false), f("2026-11-10", false), f("2026-11-10", true), f("2026-11-09", true)]
    expect(logbookNowIndex(list, today)).toBe(1)
  })

  it("takes a leg in progress (OUT, no IN) as still to fly", () => {
    const list = [f("2026-11-15", false), { date: today, outTime: "02:00", inTime: "" }, f("2026-11-09", true)]
    expect(logbookNowIndex(list, today)).toBe(1)
  })

  it("ignores an old row that was never completed", () => {
    const list = [f("2026-11-12", false), f("2026-11-09", true), f("2026-10-01", false)]
    expect(logbookNowIndex(list, today)).toBe(0)
  })
})
