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
