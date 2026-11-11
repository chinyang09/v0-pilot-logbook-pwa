import { describe, expect, it } from "vitest"
import { isUnloggedPast, logbookNowIndex } from "../logbook-now"

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

describe("isUnloggedPast — a past sector still waiting for its times", () => {
  const today = "2026-11-10"
  const sector = (over: Record<string, unknown>) => ({ date: "2026-11-07", outTime: "", inTime: "", scheduledOut: "04:10", scheduledIn: "06:35", entryType: "flight" as const, isSimulator: false, ...over })

  it("flags a sector from an earlier day with no OUT and IN", () => {
    expect(isUnloggedPast(sector({}), today)).toBe(true)
    expect(isUnloggedPast(sector({ outTime: "04:12" }), today)).toBe(true)
  })

  it("leaves a flown sector, today's, and the roster ahead alone", () => {
    expect(isUnloggedPast(sector({ outTime: "04:12", inTime: "06:30" }), today)).toBe(false)
    expect(isUnloggedPast(sector({ date: today }), today)).toBe(false)
    expect(isUnloggedPast(sector({ date: "2026-11-15" }), today)).toBe(false)
  })

  it("gives an overnight sector until the day it arrives has ended", () => {
    const overnight = sector({ date: "2026-11-09", scheduledOut: "23:30", scheduledIn: "03:00" })
    expect(isUnloggedPast(overnight, today)).toBe(false)
    expect(isUnloggedPast(overnight, "2026-11-11")).toBe(true)
  })

  it("never flags a simulator session", () => {
    expect(isUnloggedPast(sector({ entryType: "simulator", isSimulator: true }), today)).toBe(false)
  })
})
