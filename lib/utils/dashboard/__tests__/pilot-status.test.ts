import { describe, expect, it } from "vitest"

import { buildPilotStatus } from "../pilot-status"
import { buildLegalityModel, type LegalityInput } from "../legality"
import { deriveDutyStatus } from "../duty-status"
import type { CurrencyWithStatus } from "@/types/entities/roster.types"
import type { DutyPeriod } from "@/types/entities/roster.types"

/**
 * The annunciator and the "next action" line — the two things on the legal
 * dashboard a pilot reads before any number.
 */

function currency(over: Partial<CurrencyWithStatus>): CurrencyWithStatus {
  return {
    id: over.code ?? "c",
    code: "MEDIC",
    description: "Medical",
    expiryDate: "2027-01-01",
    warningDays: 30,
    criticalDays: 7,
    autoUpdate: false,
    createdAt: 0,
    syncStatus: "synced",
    status: "valid",
    daysRemaining: 200,
    ...over,
  } as CurrencyWithStatus
}

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

const NOW = new Date("2026-08-14T11:42:00Z")

const CLEAR: LegalityInput = {
  recency: { takeoffs: 6, landings: 6, current: true, lapseIso: "2026-11-01" },
  capacity: {
    duty14Days: { used: 20, limit: 90, remaining: 70 },
    duty28Days: { used: 40, limit: 180, remaining: 140 },
    flight28Days: { used: 30, limit: 100, remaining: 70 },
    flight365Days: { used: 300, limit: 1000, remaining: 700 },
  },
  currencies: [],
  now: NOW,
}

function status(
  legalityOver: Partial<LegalityInput>,
  dps: DutyPeriod[] = [],
  rest: Parameters<typeof deriveDutyStatus>[2] = null,
) {
  return buildPilotStatus({
    legality: buildLegalityModel({ ...CLEAR, ...legalityOver }),
    duty: deriveDutyStatus(dps, NOW, rest),
    timeZone: "UTC",
    now: NOW,
  })
}

describe("buildPilotStatus — annunciator", () => {
  it("reads CURRENT when every requirement is met", () => {
    expect(status({}).state).toBe("current")
  })

  it("reads ACTION REQUIRED on any failed requirement", () => {
    const s = status({
      currencies: [currency({ code: "MEDIC", status: "expired", daysRemaining: -2 })],
    })
    expect(s.state).toBe("action_required")
  })

  it("treats an UNKNOWN requirement as a warning, not its own state", () => {
    // A limit the app cannot answer for is something to check, not a fourth
    // colour on a warning panel.
    const s = status({
      capacity: { ...CLEAR.capacity, duty14Days: { used: 0, limit: 0, remaining: 0 } },
    })
    expect(s.state).toBe("warning")
  })

  it("an exceeded FDP outranks a clean requirement set", () => {
    // Everything standing is met, but the duty in progress has run past its
    // maximum. That is happening NOW, so it wins.
    const s = status({}, [duty({ maxFdpMinutes: 300, debriefTime: "23:00" })])
    expect(s.state).toBe("action_required")
    expect(s.nextAction.headline).toBe("FDP exceeded")
  })
})

describe("buildPilotStatus — governing constraint", () => {
  it("names the tightest constraint rather than a count of what is fine", () => {
    // "12 / 12 current" is noise. The answer a pilot wants is which one bites
    // first.
    const s = status({
      recency: { takeoffs: 3, landings: 3, current: true, lapseIso: "2026-08-20" },
    })
    expect(s.governing?.label).toBe("90-day recency")
    expect(s.governing?.value).toBe("6d")
  })
})

describe("buildPilotStatus — next action", () => {
  it("states the remedy, not the reading", () => {
    const s = status({
      recency: { takeoffs: 1, landings: 6, current: false, lapseIso: null },
    })
    expect(s.nextAction.headline).toBe("2 takeoffs required")
    expect(s.nextAction.tone).toBe("action_required")
  })

  it("uses the singular for a shortfall of one", () => {
    const s = status({
      recency: { takeoffs: 6, landings: 2, current: false, lapseIso: null },
    })
    expect(s.nextAction.headline).toBe("1 landing required")
  })

  it("leads with rest whenever rest is outstanding", () => {
    // Rest outranks a document three weeks out: it is the thing standing
    // between the pilot and the aircraft right now.
    const s = status(
      { currencies: [currency({ code: "OPC320", status: "warning", daysRemaining: 20 })] },
      [],
      {
        isLegalNow: false,
        elapsedMinutes: 60,
        requiredMinutes: 720,
        legalAtUtc: "2026-08-14T22:42:00Z",
      },
    )
    expect(s.nextAction.headline).toBe("Rest until 22:42")
    expect(s.legalAtUtc).toBe("2026-08-14T22:42:00Z")
  })

  it("raises an otherwise-clear pilot to CAUTION while rest is outstanding", () => {
    // Rest lives in the duty state now, so it is not one of the requirements
    // the verdict is drawn from — the annunciator has to fold it in itself or a
    // resting pilot reads as CURRENT.
    const s = status({}, [], {
      isLegalNow: false,
      elapsedMinutes: 60,
      requiredMinutes: 720,
      legalAtUtc: "2026-08-14T22:42:00Z",
    })
    expect(s.state).toBe("warning")
  })

  it("says where the pilot is in the duty rather than 'nothing required'", () => {
    // Mid-duty, everything clear. "Nothing required" is true and useless while
    // sitting at the gate between sectors.
    const s = status({}, [
      duty({
        reportTime: "06:00",
        debriefTime: "18:00",
        sectorCount: 2,
        route: "WSSS-VTCC-WSSS",
      }),
    ])
    expect(s.duty.phase).toBe("on_duty")
    expect(s.nextAction.headline).toBe("Sector 1 of 2")
    expect(s.nextAction.detail).toBe("WSSS-VTCC-WSSS")
  })

  it("points at the next report when nothing is outstanding", () => {
    const s = status({}, [duty({ id: "next", date: "2026-08-15", reportTime: "07:30" })])
    expect(s.nextAction.headline).toBe("Report 07:30")
    expect(s.nextAction.tone).toBe("current")
  })

  it("says so plainly when there is nothing to do and nothing rostered", () => {
    const s = status({})
    expect(s.nextAction.headline).toBe("Nothing required")
  })

  it("names the nearest expiry, not the fullest limit, when nothing is flagged", () => {
    // The first version answered "Flight 1y 604 / 1000h" here — 41% used, six
    // months of headroom — which is the least urgent thing on the page.
    const s = status({
      recency: { takeoffs: 6, landings: 6, current: true, lapseIso: "2027-01-01" },
      currencies: [
        currency({ code: "MEDIC", daysRemaining: 190 }),
        currency({ code: "OPC320", daysRemaining: 58 }),
      ],
    })
    expect(s.state).toBe("current")
    expect(s.governing?.label).toBe("OPC320")
  })

  it("names an expiring document with its remedy", () => {
    const s = status({
      currencies: [currency({ code: "OPC320", status: "critical", daysRemaining: 6 })],
    })
    expect(s.nextAction.headline).toBe("OPC320 expires in 6d")
    expect(s.nextAction.tone).toBe("warning")
  })
})

/**
 * A next duty the rest requirement does not reach.
 *
 * This is the one thing on the panel whose remedy is EXTERNAL — the duty is
 * rostered inside the rest period and only the company can move it — so it
 * outranks the rest countdown itself, which the pilot can do nothing about
 * except wait.
 */
describe("buildPilotStatus — a duty rostered inside the rest period", () => {
  const flownAndNext = (nextReport: string): DutyPeriod[] => [
    duty({ id: "flown", date: "2026-08-14", reportTime: "00:00", debriefTime: "10:00" }),
    duty({ id: "next", date: "2026-08-14", reportTime: nextReport, debriefTime: "23:00" }),
  ]

  /** Rest complete at 21:00Z; NOW is 12:00Z on the 14th. */
  const rest = {
    isLegalNow: false,
    elapsedMinutes: 60,
    requiredMinutes: 11 * 60,
    legalAtUtc: "2026-08-14T21:00:00Z",
  }

  it("raises ACTION REQUIRED even when every standing requirement is met", () => {
    const s = buildPilotStatus({
      legality: buildLegalityModel({ ...CLEAR }),
      duty: deriveDutyStatus(flownAndNext("18:00"), NOW, rest),
      timeZone: "UTC",
      now: NOW,
    })
    expect(s.state).toBe("action_required")
  })

  it("names the shortfall and the remedy", () => {
    const s = buildPilotStatus({
      legality: buildLegalityModel({ ...CLEAR }),
      duty: deriveDutyStatus(flownAndNext("18:00"), NOW, rest),
      timeZone: "UTC",
      now: NOW,
    })
    // Reports 18:00, legal at 21:00 — three hours short.
    expect(s.nextAction.headline).toBe("Rest short by 3:00")
    expect(s.nextAction.detail).toContain("notify company")
  })

  it("falls back to the plain rest countdown when the next duty clears it", () => {
    const s = buildPilotStatus({
      legality: buildLegalityModel({ ...CLEAR }),
      duty: deriveDutyStatus(flownAndNext("22:00"), NOW, rest),
      timeZone: "UTC",
      now: NOW,
    })
    expect(s.state).toBe("warning")
    expect(s.nextAction.headline).toBe("Rest until 21:00")
  })
})

/**
 * Standby is a DUTY. It is not a flight duty period — paragraph 14's tables
 * never applied to it — but reading it as "off duty" is the worse error: the
 * crew member is committed, contactable, and could be called at any moment.
 */
describe("buildPilotStatus — on standby", () => {
  const standbyDay: DutyPeriod[] = [
    duty({
      id: "sb",
      date: "2026-08-14",
      reportTime: "06:00",
      debriefTime: "18:00",
      dutyMinutes: 12 * 60,
      flightMinutes: 0,
      sectorCount: 0,
      maxFdpMinutes: 0,
      dutyKind: "standby",
      standbyKind: "home",
      countedDutyMinutes: 144,
    }),
  ]

  it("does not say 'nothing required' to somebody on standby", () => {
    const s = buildPilotStatus({
      legality: buildLegalityModel({ ...CLEAR }),
      duty: deriveDutyStatus(standbyDay, NOW),
      timeZone: "UTC",
      now: NOW,
    })
    expect(s.duty.standby).not.toBeNull()
    expect(s.nextAction.headline).toBe("On standby to 18:00")
    expect(s.nextAction.detail).toBe("Not called")
  })

  it("does not read the standby as a flight duty whose limit failed", () => {
    const s = buildPilotStatus({
      legality: buildLegalityModel({ ...CLEAR }),
      duty: deriveDutyStatus(standbyDay, NOW),
      timeZone: "UTC",
      now: NOW,
    })
    // Left in the flight-duty search it would be the ACTIVE duty carrying a
    // maximum of zero — a dash where a pilot expects a number.
    expect(s.duty.active).toBeNull()
    expect(s.duty.phase).not.toBe("on_duty")
  })
})
