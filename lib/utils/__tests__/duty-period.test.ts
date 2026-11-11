import { describe, expect, it } from "vitest"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { daysBetween, planDutyPeriod } from "../duty-period"

const off = (id: string, date: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry =>
  ({ id, date, dutyType: "off", dutyCode: "LOFF", sectors: [], crew: [], timeReference: "UTC", importedAt: 0, ...over }) as ScheduleEntry
const LOFF = { dutyType: "off" as const, dutyCode: "LOFF" }

describe("duty periods", () => {
  it("lists the days of a period, across a month end", () => {
    expect(daysBetween("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"])
    expect(daysBetween("2026-11-12", "2026-11-12")).toEqual(["2026-11-12"])
    expect(daysBetween("2026-11-12", "2026-11-11")).toEqual([])
  })

  it("writes nothing for a period saved as it was", () => {
    const run = [off("a", "2026-11-12"), off("b", "2026-11-13"), off("c", "2026-11-14")]
    expect(planDutyPeriod({ editing: run, all: run, from: "2026-11-12", to: "2026-11-14", fields: LOFF })).toEqual({
      updates: [],
      creates: [],
      deletes: [],
      firstId: "a",
    })
  })

  it("bins the days a shortened period lost and creates the days a longer one gained", () => {
    const run = [off("a", "2026-11-12"), off("b", "2026-11-13"), off("c", "2026-11-14")]
    const shorter = planDutyPeriod({ editing: run, all: run, from: "2026-11-13", to: "2026-11-14", fields: LOFF })
    expect(shorter.deletes).toEqual(["a"])
    expect(shorter.firstId).toBe("b")
    const longer = planDutyPeriod({ editing: run, all: run, from: "2026-11-12", to: "2026-11-16", fields: LOFF })
    expect(longer.creates).toEqual(["2026-11-15", "2026-11-16"])
    expect(longer.deletes).toEqual([])
  })

  it("changes every day of the period at once", () => {
    const run = [off("a", "2026-11-12"), off("b", "2026-11-13")]
    const plan = planDutyPeriod({
      editing: run,
      all: run,
      from: "2026-11-12",
      to: "2026-11-13",
      fields: { dutyType: "leave", dutyCode: "AL", dutyDescription: "Annual Leave" },
    })
    expect(plan.updates.map((u) => [u.id, u.patch])).toEqual([
      ["a", { dutyType: "leave", dutyCode: "AL", dutyDescription: "Annual Leave" }],
      ["b", { dutyType: "leave", dutyCode: "AL", dutyDescription: "Annual Leave" }],
    ])
  })

  it("adopts the same duty already on a day the period grows into, rather than doubling it", () => {
    const run = [off("a", "2026-11-12"), off("b", "2026-11-13")]
    const neighbour = off("n", "2026-11-14")
    const otherDuty = off("s", "2026-11-15", { dutyType: "standby", dutyCode: "SBY" })
    const plan = planDutyPeriod({
      editing: run,
      all: [...run, neighbour, otherDuty],
      from: "2026-11-12",
      to: "2026-11-15",
      fields: LOFF,
    })
    expect(plan.updates).toEqual([])
    // The 14th is the neighbouring LOFF; the 15th holds a standby, which is
    // another duty — the day off is created beside it, the standby untouched.
    expect(plan.creates).toEqual(["2026-11-15"])
  })

  it("clears a window a whole-day duty no longer has", () => {
    const sby = off("s", "2026-11-12", { dutyType: "standby", dutyCode: "SBY", reportTime: "06:00", debriefTime: "18:00" })
    const plan = planDutyPeriod({ editing: [sby], all: [sby], from: "2026-11-12", to: "2026-11-12", fields: LOFF })
    expect(plan.updates[0].patch).toEqual({ dutyType: "off", dutyCode: "LOFF", reportTime: null, debriefTime: null })
  })

  it("is a new duty's days when nothing is being edited", () => {
    const plan = planDutyPeriod({ editing: [], all: [], from: "2026-11-12", to: "2026-11-13", fields: LOFF })
    expect(plan.creates).toEqual(["2026-11-12", "2026-11-13"])
    expect(plan.firstId).toBeNull()
  })
})
