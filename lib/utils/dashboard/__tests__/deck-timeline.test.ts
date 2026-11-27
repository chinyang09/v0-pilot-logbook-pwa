/**
 * The Flight Deck's timeline: which duty its pointer selects, and the four
 * rolling limits read at the pointer — the same continuous windows the FDP
 * page reads, the roster's forecast ahead of now.
 */
import { describe, expect, it } from "vitest"
import { deckRange, deckSteps, hourMarks, limitsAt, limitsTone, neighbourDuty, selectAt } from "../deck-timeline"
import { buildDutyTimeline } from "@/lib/utils/roster/duty-timeline"
import { createRollingIndex, rollingAt } from "@/lib/utils/roster/rolling-at"
import type { DutyPeriod } from "@/types/entities/roster.types"

const H = 3_600_000
const DAY = 24 * H
const at = (iso: string) => Date.parse(iso)

function duty(over: Partial<DutyPeriod>): DutyPeriod {
  return {
    id: "d",
    date: "2026-11-03",
    reportTime: "01:00",
    debriefTime: "09:00",
    dutyMinutes: 480,
    flightMinutes: 300,
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

const a = { id: "a", startMs: at("2026-11-03T01:00:00Z"), endMs: at("2026-11-03T09:00:00Z") }
const b = { id: "b", startMs: at("2026-11-04T22:00:00Z"), endMs: at("2026-11-05T08:00:00Z") }
const c = { id: "c", startMs: at("2026-11-07T01:00:00Z"), endMs: at("2026-11-07T05:00:00Z") }

describe("selectAt — the duty the pointer is on", () => {
  it("is the duty the pointer is inside", () => {
    expect(selectAt([a, b, c], at("2026-11-03T05:00:00Z"))).toBe("a")
    expect(selectAt([a, b, c], at("2026-11-05T01:00:00Z"))).toBe("b")
  })
  it("between duties, is the one the rest is FOR — the next", () => {
    expect(selectAt([a, b, c], at("2026-11-03T12:00:00Z"))).toBe("b")
    expect(selectAt([a, b, c], at("2026-11-06T00:00:00Z"))).toBe("c")
    // At the report itself it is inside the duty.
    expect(selectAt([a, b, c], b.startMs)).toBe("b")
  })
  it("before the first, the first; after the last, the last", () => {
    expect(selectAt([a, b, c], at("2026-11-01T00:00:00Z"))).toBe("a")
    expect(selectAt([a, b, c], at("2026-11-20T00:00:00Z"))).toBe("c")
    expect(selectAt([], at("2026-11-20T00:00:00Z"))).toBeNull()
  })
  it("where two overlap, the later-starting one wins (a duty inside another)", () => {
    const inner = { id: "inner", startMs: at("2026-11-03T03:00:00Z"), endMs: at("2026-11-03T06:00:00Z") }
    expect(selectAt([a, inner], at("2026-11-03T04:00:00Z"))).toBe("inner")
    expect(selectAt([a, inner], at("2026-11-03T07:00:00Z"))).toBe("a")
  })
})

describe("limitsAt — the four limits at the pointer", () => {
  const periods = [
    duty({ id: "d1", date: "2026-11-01", dutyMinutes: 600, flightMinutes: 420 }),
    duty({ id: "d2", date: "2026-11-03", dutyMinutes: 600, flightMinutes: 420 }),
    duty({ id: "d3", date: "2026-11-20", dutyMinutes: 600, flightMinutes: 420, isFuture: true }),
  ]
  const index = createRollingIndex(buildDutyTimeline(periods, new Map()))

  it("reads the continuous windows the FDP page reads", () => {
    const t = at("2026-11-04T00:00:00Z")
    const rows = limitsAt(index, t)
    expect(rows.map((r) => r.id)).toEqual(["duty-14", "duty-28", "flight-28", "flight-365"])
    expect(rows[0].usedMinutes).toBe(Math.round(rollingAt(index, "duty14", t)))
    expect(rows[0].usedMinutes).toBe(1200)
    expect(rows[2].usedMinutes).toBe(840)
    expect(rows[0].remainingMinutes).toBe(90 * 60 - 1200)
  })

  it("counts a duty by the part of it done at the pointer — it rolls, not jumps", () => {
    const mid = at("2026-11-03T05:00:00Z")
    const rows = limitsAt(index, mid)
    // d1 whole; d2 (01:00–11:00Z) 4 of its 10 hours done: 240 of 600, pro rata.
    expect(rows[0].usedMinutes).toBe(600 + 240)
  })

  it("ahead of now it is the roster's forecast; days later a duty has rolled out", () => {
    const later = at("2026-11-21T00:00:00Z")
    const rows = limitsAt(index, later)
    // 14 × 24h back from 21 Nov 00:00Z reaches 7 Nov: only d3 is inside.
    expect(rows[0].usedMinutes).toBe(600)
    // 28 days: all three.
    expect(rows[1].usedMinutes).toBe(1800)
  })

  it("is amber from 80% and red at the limit — dark cockpit otherwise", () => {
    const heavy = Array.from({ length: 9 }, (_, i) =>
      duty({ id: `h${i}`, date: `2026-11-${String(i + 1).padStart(2, "0")}`, reportTime: "00:00", dutyMinutes: 600, flightMinutes: 0 }),
    )
    const idx = createRollingIndex(buildDutyTimeline(heavy, new Map()))
    const rows = limitsAt(idx, at("2026-11-10T00:00:00Z"))
    expect(rows[0].usedMinutes).toBe(5400)
    expect(rows[0].state).toBe("fail")
    expect(limitsTone(rows)).toBe("fail")
    // Seven whole duties (70h) is 78% of 90h: no colour; the eighth's first hours make it amber.
    expect(limitsAt(idx, at("2026-11-07T12:00:00Z"))[0].state).toBe("ok")
    expect(limitsAt(idx, at("2026-11-08T03:00:00Z"))[0].state).toBe("caution")
    expect(limitsTone(limitsAt(createRollingIndex([]), at("2026-11-10T00:00:00Z")))).toBeNull()
  })
})

describe("deckRange — what the timeline draws", () => {
  const midnight = (ms: number) => Math.floor(ms / DAY) * DAY
  it("runs two days before the first duty to three after the last, now inside, on midnights", () => {
    const now = at("2026-11-04T12:00:00Z")
    const { fromMs, toMs } = deckRange([a, b, c], now, midnight)
    expect(fromMs).toBe(at("2026-11-01T00:00:00Z"))
    expect(toMs).toBe(at("2026-11-11T00:00:00Z"))
  })
  it("reaches no further than 90 days back and 120 ahead of now", () => {
    const now = at("2026-11-04T12:00:00Z")
    const old = { id: "old", startMs: now - 400 * DAY, endMs: now - 400 * DAY + 8 * H }
    const far = { id: "far", startMs: now + 400 * DAY, endMs: now + 400 * DAY + 8 * H }
    const { fromMs, toMs } = deckRange([old, a, far], now, midnight)
    expect(fromMs).toBeGreaterThanOrEqual(midnight(now - 90 * DAY))
    expect(toMs).toBeLessThanOrEqual(midnight(now + 120 * DAY) + DAY)
  })
})

describe("hourMarks — the labels under the strip", () => {
  it("every third hour of the display clock, midnights marked", () => {
    const from = at("2026-11-03T22:00:00Z")
    const marks = hourMarks(from, from + 9 * H, at("2026-11-03T00:00:00Z"), (ms) => new Date(ms).getUTCHours())
    expect(marks.map((m) => m.hour)).toEqual([0, 3, 6])
    expect(marks[0].midnight).toBe(true)
  })
  it("in a half-hour zone the hours fall where its clock says", () => {
    // UTC+5:30: local midnight is 18:30Z the day before.
    const anchor = at("2026-11-02T18:30:00Z")
    const hourOf = (ms: number) => new Date(ms + 5.5 * H).getUTCHours()
    const marks = hourMarks(anchor, anchor + 7 * H, anchor, hourOf)
    expect(marks.map((m) => [new Date(m.ms).toISOString().slice(11, 16), m.hour])).toEqual([
      ["18:30", 0],
      ["21:30", 3],
      ["00:30", 6],
    ])
  })
})

describe("neighbourDuty — the < and > buttons", () => {
  it("steps from the chosen duty to the one before or after it", () => {
    expect(neighbourDuty([c, a, b], "b", 0, 1)?.id).toBe("c")
    expect(neighbourDuty([c, a, b], "b", 0, -1)?.id).toBe("a")
    expect(neighbourDuty([a, b, c], "c", 0, 1)).toBeNull()
    expect(neighbourDuty([a, b, c], "a", 0, -1)).toBeNull()
  })
  it("with nothing chosen, from the instant", () => {
    expect(neighbourDuty([a, b, c], null, at("2026-11-04T00:00:00Z"), 1)?.id).toBe("b")
    expect(neighbourDuty([a, b, c], null, at("2026-11-04T00:00:00Z"), -1)?.id).toBe("a")
  })
})

describe("deckSteps — ticks and labels at every zoom", () => {
  it("a tick an hour while an hour has room, labels as often as they fit", () => {
    expect(deckSteps(30)).toEqual({ tick: 1, label: 1 })
    expect(deckSteps(17)).toEqual({ tick: 1, label: 3 })
    expect(deckSteps(8)).toEqual({ tick: 1, label: 6 })
    expect(deckSteps(3)).toEqual({ tick: 6, label: 24 })
  })
})
