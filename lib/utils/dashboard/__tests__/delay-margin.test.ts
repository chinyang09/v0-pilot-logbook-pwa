import { describe, expect, it } from "vitest"
import { delayMargin } from "../delay-margin"
import type { DutyPeriod } from "@/types/entities/roster.types"

const dp = (over: Partial<DutyPeriod>): DutyPeriod =>
  ({
    id: over.id ?? "dp",
    date: "2026-11-20",
    reportTime: "09:00",
    debriefTime: "17:00",
    dutyMinutes: 480,
    flightMinutes: 360,
    sectorCount: 1,
    maxFdpMinutes: 0,
    fdpExtensionUsed: false,
    source: "logbook",
    isFuture: false,
    scheduleEntryIds: [],
    flightIds: [],
    ...over,
  }) as DutyPeriod

describe("delayMargin", () => {
  it("is the FDP margin when the rolling limits have room", () => {
    const duty = dp({ id: "next" })
    const m = delayMargin([duty], duty, 95)
    expect(m).toMatchObject({ minutes: 95, binding: "FDP" })
  })

  it("is the 14-day duty limit when it is nearer than the FDP's", () => {
    // 10 earlier duties of 8:30 (85h) + this duty's 8h = 93h of a 90h limit → over.
    const earlier = Array.from({ length: 10 }, (_, i) => dp({ id: `e${i}`, date: `2026-11-${String(10 + i).padStart(2, "0")}`, dutyMinutes: 8 * 60 + 30 - 48, flightMinutes: 0 }))
    const duty = dp({ id: "next", dutyMinutes: 300, flightMinutes: 0 })
    // 10 × 7:42 = 77h + 5h = 82h → 8h of 90 left.
    const m = delayMargin([...earlier, duty], duty, 600)!
    expect(m.binding).toBe("Duty 14d")
    expect(m.minutes).toBe(8 * 60)
  })

  it("counts the duties rostered AFTER it inside the same window", () => {
    const duty = dp({ id: "next", dutyMinutes: 600, flightMinutes: 0 })
    const later = Array.from({ length: 8 }, (_, i) => dp({ id: `l${i}`, date: `2026-11-${21 + i}`, dutyMinutes: 600, flightMinutes: 0, isFuture: true }))
    // 9 × 10h = 90h in the 14 days from the 20th: no margin at all.
    const m = delayMargin([duty, ...later], duty, 200)!
    expect(m).toMatchObject({ minutes: 0, binding: "Duty 14d" })
  })

  it("floors a breach at zero and works with no FDP maximum", () => {
    const duty = dp({ id: "next", dutyMinutes: 100 * 60 })
    expect(delayMargin([duty], duty, null)).toMatchObject({ minutes: 0, binding: "Duty 14d" })
  })
})
