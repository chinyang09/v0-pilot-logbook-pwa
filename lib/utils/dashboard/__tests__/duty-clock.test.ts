import { describe, expect, it } from "vitest"
import { clockTicks, dutyClock } from "../duty-clock"

const at = (s: string) => Date.parse(`${s}Z`)
const utcHour = (ms: number) => new Date(ms).getUTCHours()

describe("the duty clock", () => {
  // Rest from 20 Nov 10:00Z, legal at 22:00Z; report 21 Nov 01:00Z, FDP to
  // 07:30Z, off duty 08:00Z, a 12:15 maximum.
  const input = {
    nowMs: at("2026-11-20T18:00:00"),
    rest: { startMs: at("2026-11-20T10:00:00"), legalMs: at("2026-11-20T22:00:00") },
    duty: {
      reportMs: at("2026-11-21T01:00:00"),
      fdpStartMs: at("2026-11-21T01:00:00"),
      fdpEndMs: at("2026-11-21T07:30:00"),
      endMs: at("2026-11-21T08:00:00"),
      maxFdpMinutes: 735,
    },
    legs: [],
  }

  it("runs from the rest's start to an hour past the FDP maximum", () => {
    const c = dutyClock(input)!
    expect(c.fromMs).toBe(at("2026-11-20T10:00:00"))
    expect(c.duty!.maxEndMs).toBe(at("2026-11-21T13:15:00"))
    expect(c.toMs).toBe(at("2026-11-21T15:00:00"))
    expect(c.rest!.short).toBe(false)
    expect(c.tickHours).toBe(1)
    expect(c.labelHours).toBe(6)
  })

  it("marks a report inside the rest's minimum as short", () => {
    const c = dutyClock({ ...input, rest: { ...input.rest, legalMs: at("2026-11-21T03:00:00") } })!
    expect(c.rest).toMatchObject({ endMs: input.duty.reportMs, short: true })
  })

  it("draws only the last sixteen hours of a long rest", () => {
    const c = dutyClock({ ...input, rest: { startMs: at("2026-11-18T00:00:00"), legalMs: at("2026-11-18T12:00:00") } })!
    expect(c.fromMs).toBe(at("2026-11-20T09:00:00"))
  })

  it("has no maximum to draw on a duty that carries none", () => {
    const c = dutyClock({ ...input, duty: { ...input.duty, maxFdpMinutes: 0 } })!
    expect(c.duty!.maxEndMs).toBeNull()
    expect(c.toMs).toBe(at("2026-11-21T09:00:00"))
  })

  it("ticks hourly, labelling every few hours on the hour", () => {
    const c = dutyClock(input)!
    const ticks = clockTicks(c, utcHour)
    expect(ticks.length).toBe(30)
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toEqual(["12", "18", "00", "06", "12"])
  })
})
