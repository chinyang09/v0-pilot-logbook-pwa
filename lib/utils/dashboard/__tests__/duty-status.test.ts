import { describe, expect, it } from "vitest"

import { deriveDutyStatus, deriveSectorLegs, dutyWindow, formatDutyClock } from "../duty-status"
import type { DutyPeriod } from "@/types/entities/roster.types"

/**
 * The legal dashboard's live half. Everything here is about reading the duty
 * the pilot is actually in — and about NOT inventing an FDP maximum, which is
 * the one number on that screen a wrong answer could put someone over a limit.
 */

function duty(over: Partial<DutyPeriod>): DutyPeriod {
  return {
    id: over.id ?? "dp",
    date: "2026-08-14",
    reportTime: "06:00",
    debriefTime: "16:00",
    dutyMinutes: 600,
    flightMinutes: 420,
    sectorCount: 2,
    maxFdpMinutes: 780,
    fdpExtensionUsed: false,
    source: "logbook",
    isFuture: false,
    scheduleEntryIds: [],
    flightIds: [],
    ...over,
  } as DutyPeriod
}

describe("dutyWindow", () => {
  it("builds an absolute UTC window from the date and HH:MM times", () => {
    const w = dutyWindow({ date: "2026-08-14", reportTime: "06:00", debriefTime: "16:00" })!
    expect(new Date(w.startMs).toISOString()).toBe("2026-08-14T06:00:00.000Z")
    expect(new Date(w.endMs).toISOString()).toBe("2026-08-14T16:00:00.000Z")
  })

  it("carries a past-midnight debrief into the next day", () => {
    // A debrief earlier than its report is the duty crossing midnight, not a
    // duty that ran backwards. Without the wrap this window is negative and the
    // duty can never contain "now".
    const w = dutyWindow({ date: "2026-08-14", reportTime: "21:00", debriefTime: "03:30" })!
    expect(new Date(w.endMs).toISOString()).toBe("2026-08-15T03:30:00.000Z")
  })
})

describe("deriveDutyStatus — phase", () => {
  it("is on duty when now falls inside the window", () => {
    const s = deriveDutyStatus([duty({})], new Date("2026-08-14T11:42:00Z"))
    expect(s.phase).toBe("on_duty")
    expect(s.active?.elapsedMinutes).toBe(342) // 5:42
  })

  it("stays on the duty just flown for a few hours after debrief", () => {
    const s = deriveDutyStatus([duty({})], new Date("2026-08-14T17:00:00Z"))
    expect(s.phase).toBe("post_duty")
    expect(s.justFinished?.id).toBe("dp")
  })

  it("falls back to off duty once that window has passed", () => {
    const s = deriveDutyStatus([duty({})], new Date("2026-08-15T06:00:00Z"))
    expect(s.phase).toBe("off")
    expect(s.justFinished).toBeNull()
  })

  it("reads a SCHEDULED duty that has started as the one being flown", () => {
    // Waiting for logbook entries to exist would leave the panel blank for
    // exactly the hours it is most wanted.
    const s = deriveDutyStatus(
      [duty({ id: "sched", source: "schedule", isFuture: true })],
      new Date("2026-08-14T09:00:00Z"),
    )
    expect(s.phase).toBe("on_duty")
    expect(s.active?.id).toBe("sched")
  })

  it("prefers the later-starting duty when two windows contain now", () => {
    // A merged overnight and a sector inside it both contain the instant; the
    // pilot is in the inner one.
    const s = deriveDutyStatus(
      [
        duty({ id: "outer", reportTime: "06:00", debriefTime: "22:00" }),
        duty({ id: "inner", reportTime: "12:00", debriefTime: "20:00" }),
      ],
      new Date("2026-08-14T13:00:00Z"),
    )
    expect(s.active?.id).toBe("inner")
  })
})

describe("deriveDutyStatus — FDP", () => {
  it("takes the maximum from the duty period, never a fixed figure", () => {
    // An 06:00 two-sector duty and a 23:00 four-sector duty have different
    // maxima under Reg 14. The dashboard must read whichever was computed for
    // THIS duty.
    const early = deriveDutyStatus(
      [duty({ maxFdpMinutes: 780, fdpTableUsed: "A" })],
      new Date("2026-08-14T11:42:00Z"),
    )
    const late = deriveDutyStatus(
      [duty({ maxFdpMinutes: 660, fdpTableUsed: "B", sectorCount: 4 })],
      new Date("2026-08-14T11:42:00Z"),
    )

    expect(early.active?.maxFdpMinutes).toBe(780)
    expect(early.active?.remainingMinutes).toBe(438)
    expect(early.active?.fdpTable).toBe("A")

    expect(late.active?.maxFdpMinutes).toBe(660)
    expect(late.active?.remainingMinutes).toBe(318)
    expect(late.active?.fdpTable).toBe("B")
  })

  it("flags an exceeded FDP rather than reporting negative time remaining", () => {
    const s = deriveDutyStatus(
      [duty({ maxFdpMinutes: 300, debriefTime: "23:00" })],
      new Date("2026-08-14T12:00:00Z"), // 6h elapsed against a 5h max
    )
    expect(s.active?.exceeded).toBe(true)
    expect(s.active?.remainingMinutes).toBe(0)
  })

  it("reports no maximum rather than a made-up one when the duty carries none", () => {
    // A duty period built without an FDP calculation must read as "no limit
    // known", not as a limit of zero (already exceeded) and not as a default.
    const s = deriveDutyStatus(
      [duty({ maxFdpMinutes: 0 })],
      new Date("2026-08-14T11:42:00Z"),
    )
    expect(s.active?.maxFdpMinutes).toBe(0)
    expect(s.active?.exceeded).toBe(false)
    expect(s.active?.remainingMinutes).toBe(0)
  })
})

describe("deriveDutyStatus — next duty", () => {
  it("finds the earliest duty still ahead, in any phase", () => {
    const s = deriveDutyStatus(
      [
        duty({ id: "now", reportTime: "06:00", debriefTime: "16:00" }),
        duty({ id: "far", date: "2026-08-20", reportTime: "08:00" }),
        duty({ id: "soon", date: "2026-08-15", reportTime: "07:30" }),
      ],
      new Date("2026-08-14T11:42:00Z"),
    )
    expect(s.phase).toBe("on_duty")
    expect(s.next?.id).toBe("soon")
    expect(s.next?.inMinutes).toBe(1188) // 19h48m
  })

  it("has no next duty when the roster is empty ahead", () => {
    const s = deriveDutyStatus([duty({})], new Date("2026-08-20T00:00:00Z"))
    expect(s.next).toBeNull()
  })
})

describe("formatDutyClock", () => {
  it("pads minutes but not hours, and floors at zero", () => {
    expect(formatDutyClock(342)).toBe("5:42")
    expect(formatDutyClock(60)).toBe("1:00")
    expect(formatDutyClock(-5)).toBe("0:00")
    expect(formatDutyClock(780)).toBe("13:00")
  })
})

describe("deriveSectorLegs", () => {
  it("splits a chained route into legs and marks progress", () => {
    // A duty is not one route — it is up to four sectors across several
    // airports, and "where am I in the pattern" is the question the panel has
    // to answer during a duty.
    const legs = deriveSectorLegs("WSSS-VTBS-WSSS-WMKK", 1, true)

    expect(legs.map((l) => `${l.from}-${l.to}`)).toEqual([
      "WSSS-VTBS",
      "VTBS-WSSS",
      "WSSS-WMKK",
    ])
    expect(legs.map((l) => l.status)).toEqual(["complete", "active", "scheduled"])
  })

  it("marks nothing active when the duty is not in progress", () => {
    const legs = deriveSectorLegs("WSSS-VTBS-WSSS", 2, false)
    expect(legs.map((l) => l.status)).toEqual(["complete", "complete"])
  })

  it("returns nothing for a duty with no usable route", () => {
    expect(deriveSectorLegs(undefined, 0, true)).toEqual([])
    expect(deriveSectorLegs("WSSS", 0, true)).toEqual([])
  })
})

describe("deriveDutyStatus — sectors and rest", () => {
  it("marks a leg complete once its flight is on blocks", () => {
    const arrivals = new Map([["f1", Date.parse("2026-08-14T09:30:00Z")]])
    const s = deriveDutyStatus(
      [duty({ route: "WSSS-VTBS-WSSS", flightIds: ["f1", "f2"], sectorCount: 2 })],
      new Date("2026-08-14T11:42:00Z"),
      null,
      arrivals,
    )
    expect(s.active?.legs.map((l) => l.status)).toEqual(["complete", "active"])
  })

  it("does not count a flight that has not landed yet", () => {
    const arrivals = new Map([["f1", Date.parse("2026-08-14T15:00:00Z")]])
    const s = deriveDutyStatus(
      [duty({ route: "WSSS-VTBS-WSSS", flightIds: ["f1", "f2"], sectorCount: 2 })],
      new Date("2026-08-14T11:42:00Z"),
      null,
      arrivals,
    )
    expect(s.active?.legs.map((l) => l.status)).toEqual(["active", "scheduled"])
  })

  it("carries rest through as duty state rather than a standing requirement", () => {
    const rest = {
      isLegalNow: false,
      elapsedMinutes: 120,
      requiredMinutes: 720,
      legalAtUtc: "2026-08-14T20:00:00Z",
    }
    const s = deriveDutyStatus([duty({})], new Date("2026-08-15T06:00:00Z"), rest)
    expect(s.phase).toBe("off")
    expect(s.rest).toEqual(rest)
  })
})

describe("deriveDutyStatus — a part-flown duty is still a duty", () => {
  /**
   * The bug this pins: `mergeDutyPeriods` prefers the logbook for today, and
   * mid-duty the logbook holds only the sectors already flown. A two-sector day
   * with sector one in the book therefore produced a duty that "ended" on
   * arrival, and the dashboard fell straight through to a rest countdown while
   * the pilot was still in the cruise on sector two.
   */
  const NOW = new Date("2026-08-14T11:00:00Z")

  /** What the logbook holds after sector 1 of 2 — it ended at 09:30. */
  const flownSoFar = duty({
    id: "log",
    reportTime: "06:00",
    debriefTime: "09:30",
    sectorCount: 1,
    maxFdpMinutes: 780,
    route: "WSSS-VTBS",
    flightIds: ["f1"],
    flightMinutes: 131,
  })

  /** What the roster planned: two sectors, debrief 18:00. */
  const planned = duty({
    id: "sched",
    source: "schedule",
    reportTime: "06:00",
    debriefTime: "18:00",
    sectorCount: 2,
    maxFdpMinutes: 720,
    fdpTableUsed: "B",
    route: "WSSS-VTBS-WSSS",
  })

  it("stays ON DUTY between sectors instead of counting down rest", () => {
    const s = deriveDutyStatus([flownSoFar], NOW, null, undefined, [planned])
    expect(s.phase).toBe("on_duty")
    expect(s.active?.elapsedMinutes).toBe(300) // 5:00 since the 06:00 report
  })

  it("without the plan it wrongly reads as finished — which is the bug", () => {
    const s = deriveDutyStatus([flownSoFar], NOW)
    expect(s.phase).toBe("post_duty")
  })

  it("takes the FDP maximum from the PLAN, since Reg 14 counts planned sectors", () => {
    // The logbook duty carries a one-sector maximum because one sector is all
    // it knows about. Flying to that number would be flying to the wrong limit.
    const s = deriveDutyStatus([flownSoFar], NOW, null, undefined, [planned])
    expect(s.active?.maxFdpMinutes).toBe(720)
    expect(s.active?.fdpTable).toBe("B")
    expect(s.active?.remainingMinutes).toBe(420) // 12:00 max − 5:00 elapsed
  })

  it("shows every planned sector, with the flown ones marked", () => {
    // "Not smart enough to detect 2 or 4 sector flights": the chain came off
    // the logbook route, so it only ever showed what was already flown.
    const arrivals = new Map([["f1", Date.parse("2026-08-14T09:20:00Z")]])
    const s = deriveDutyStatus([flownSoFar], NOW, null, arrivals, [planned])
    expect(s.active?.sectorCount).toBe(2)
    expect(s.active?.legs.map((l) => `${l.from}-${l.to}:${l.status}`)).toEqual([
      "WSSS-VTBS:complete",
      "VTBS-WSSS:active",
    ])
  })

  it("counts a four-sector day as four, not as however many are logged", () => {
    const four = duty({
      id: "sched4",
      source: "schedule",
      reportTime: "06:00",
      debriefTime: "20:00",
      sectorCount: 4,
      route: "WSSS-VTBS-WSSS-WMKK-WSSS",
    })
    const s = deriveDutyStatus([flownSoFar], NOW, null, undefined, [four])
    expect(s.active?.legs).toHaveLength(4)
  })

  it("reports a duty that has started with nothing logged yet", () => {
    // Every duty's first hour: the pilot has reported, no sector has landed.
    const s = deriveDutyStatus([], NOW, null, undefined, [planned])
    expect(s.phase).toBe("on_duty")
    expect(s.active?.id).toBe("sched")
  })

  it("still finishes the duty once the PLANNED debrief has passed", () => {
    const s = deriveDutyStatus(
      [flownSoFar],
      new Date("2026-08-14T19:00:00Z"),
      null,
      undefined,
      [planned],
    )
    expect(s.phase).toBe("post_duty")
  })
})
