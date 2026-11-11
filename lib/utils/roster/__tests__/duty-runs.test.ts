import { describe, expect, it } from "vitest"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { groupDutyRuns, isRestDay, isWholeDayDuty } from "../duty-runs"
import { buildCalendarSpans } from "../calendar-bars"
import { buildLogbookRows } from "@/lib/utils/logbook-rows"

const e = (id: string, date: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry =>
  ({ id, date, dutyType: "off", dutyCode: "LOFF", sectors: [], crew: [], timeReference: "UTC", importedAt: 0, ...over }) as ScheduleEntry

describe("duty runs", () => {
  it("treats a day off or leave as the whole day even with a window", () => {
    expect(isWholeDayDuty({ dutyType: "off", reportTime: "16:00" })).toBe(true)
    expect(isWholeDayDuty({ dutyType: "leave", reportTime: "16:00" })).toBe(true)
    expect(isWholeDayDuty({ dutyType: "standby", reportTime: "06:00" })).toBe(false)
    expect(isWholeDayDuty({ dutyType: "ground", reportTime: undefined })).toBe(true)
  })

  it("calls days off and every leave rest days", () => {
    expect(isRestDay({ dutyType: "off" })).toBe(true)
    expect(isRestDay({ dutyType: "leave" })).toBe(true)
    expect(isRestDay({ dutyType: "standby" })).toBe(false)
  })

  it("folds a same-day duplicate into its run, and a wrapped description into one", () => {
    const runs = groupDutyRuns([
      e("a", "2026-10-29", { dutyType: "leave", dutyCode: "TSPL", dutyDescription: "Temporary Shared Parental\nLeave" }),
      e("b", "2026-10-30", { dutyType: "leave", dutyCode: "TSPL", dutyDescription: "Temporary Shared Parental Leave" }),
      e("b2", "2026-10-30", { dutyType: "leave", dutyCode: "TSPL", dutyDescription: "Temporary Shared Parental Leave" }),
      e("c", "2026-10-31", { dutyType: "leave", dutyCode: "TSPL", dutyDescription: "Temporary Shared Parental Leave" }),
    ])
    expect(runs).toHaveLength(1)
    expect([runs[0].startDate, runs[0].endDate, runs[0].entries.length]).toEqual(["2026-10-29", "2026-10-31", 4])
  })

  it("keeps two codes that share a description apart", () => {
    const runs = groupDutyRuns([
      e("a", "2026-11-08", { dutyType: "leave", dutyCode: "PL", dutyDescription: "Paternal Leave" }),
      e("b", "2026-11-09", { dutyType: "leave", dutyCode: "AL", dutyDescription: "Paternal Leave" }),
    ])
    expect(runs).toHaveLength(2)
  })

  it("draws one bar on the calendar exactly where the list has one card", () => {
    const entries = [
      e("a", "2026-11-12", { reportTime: "16:00", debriefTime: "15:59" }),
      e("b", "2026-11-13", { reportTime: "16:00", debriefTime: "15:59" }),
      e("c", "2026-11-14"),
    ]
    const bars = buildCalendarSpans(entries, [], { zulu: true }, { duties: true, todayUtc: "2026-11-11" })
    expect(bars.map((b) => [b.startDay, b.endDay, b.startHalf, b.endHalf])).toEqual([["2026-11-12", "2026-11-14", 0, 2]])
    const rows = buildLogbookRows([], entries)
    expect(rows).toHaveLength(1)
  })
})
