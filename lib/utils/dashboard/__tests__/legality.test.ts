import { describe, expect, it } from "vitest"

import { buildLegalityModel, type LegalityInput } from "../legality"
import type { CurrencyWithStatus } from "@/types/entities/roster.types"

/**
 * The legality panel is the one part of the dashboard a pilot could act on
 * wrongly, so the rules that decide a requirement's state are pinned here
 * rather than left to the component that renders them.
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

const CLEAR: LegalityInput = {
  rest: null,
  recency: { takeoffs: 6, landings: 6, current: true, lapseIso: "2026-11-01" },
  capacity: {
    duty14Days: { used: 20, limit: 90, remaining: 70 },
    duty28Days: { used: 40, limit: 180, remaining: 140 },
    flight28Days: { used: 30, limit: 100, remaining: 70 },
    flight365Days: { used: 300, limit: 1000, remaining: 700 },
  },
  currencies: [],
  now: new Date("2026-08-13T00:00:00Z"),
}

describe("buildLegalityModel — verdict", () => {
  it("is the worst requirement, not an average", () => {
    // Everything else clear, one expired document. A scoring or majority rule
    // would call this legal; a pilot with an expired medical is not.
    const model = buildLegalityModel({
      ...CLEAR,
      currencies: [
        currency({ code: "MEDIC", status: "expired", daysRemaining: -3 }),
        currency({ code: "CRM", status: "valid", daysRemaining: 300 }),
      ],
    })

    expect(model.verdict).toBe("fail")
    expect(model.counts.fail).toBe(1)
  })

  it("is ok when every requirement is met", () => {
    const model = buildLegalityModel(CLEAR)
    expect(model.verdict).toBe("ok")
    expect(model.counts.fail).toBe(0)
    expect(model.counts.caution).toBe(0)
  })
})

describe("buildLegalityModel — rest", () => {
  it("fails with the shortfall while rest is outstanding", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      rest: {
        isLegalNow: false,
        restElapsedMinutes: 240,
        requiredRestMinutes: 720,
        legalAtUtc: "2026-08-13T08:00:00Z",
      },
    })

    const rest = model.requirements.find((r) => r.id === "rest")!
    expect(rest.state).toBe("fail")
    expect(rest.value).toBe("8h 0m")
    expect(rest.progress).toBeCloseTo(240 / 720)
    // The countdown target is published so the panel can tick it live.
    expect(model.legalAtUtc).toBe("2026-08-13T08:00:00Z")
  })

  it("publishes no countdown once the rest is served", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      rest: {
        isLegalNow: true,
        restElapsedMinutes: 900,
        requiredRestMinutes: 720,
        legalAtUtc: "2026-08-12T08:00:00Z",
      },
    })

    expect(model.requirements.find((r) => r.id === "rest")!.state).toBe("ok")
    expect(model.legalAtUtc).toBeNull()
  })
})

describe("buildLegalityModel — recency", () => {
  it("fails below three and reports the count against the requirement", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 2, landings: 5, current: false, lapseIso: null },
    })

    const to = model.requirements.find((r) => r.id === "recency-to")!
    const ldg = model.requirements.find((r) => r.id === "recency-ldg")!
    expect(to.state).toBe("fail")
    expect(to.value).toBe("2 / 3")
    expect(ldg.state).toBe("ok")
  })

  it("cautions while recency is still met but about to lapse", () => {
    // Met today, lapses in 6 days. This is the case a current/not-current chip
    // cannot express, and the only one where a pilot can still do something
    // about it.
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 3, landings: 3, current: true, lapseIso: "2026-08-19" },
    })

    const to = model.requirements.find((r) => r.id === "recency-to")!
    expect(to.state).toBe("caution")
    expect(to.value).toBe("6d left")
    expect(model.verdict).toBe("caution")
  })

  it("stays ok when the lapse is far out", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 4, landings: 4, current: true, lapseIso: "2026-10-30" },
    })
    expect(model.requirements.find((r) => r.id === "recency-to")!.state).toBe("ok")
  })
})

describe("buildLegalityModel — rolling limits", () => {
  it("cautions from 80% and fails at the limit", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      capacity: {
        duty14Days: { used: 72, limit: 90, remaining: 18 }, // exactly 80%
        duty28Days: { used: 180, limit: 180, remaining: 0 }, // at the limit
        flight28Days: { used: 50, limit: 100, remaining: 50 },
        flight365Days: { used: 300, limit: 1000, remaining: 700 },
      },
    })

    expect(model.requirements.find((r) => r.id === "duty-14")!.state).toBe("caution")
    expect(model.requirements.find((r) => r.id === "duty-28")!.state).toBe("fail")
    expect(model.requirements.find((r) => r.id === "flight-28")!.state).toBe("ok")
  })

  it("cautions a limit a future schedule is forecast to breach", () => {
    // Under 80% today, but the roster already puts it over. The row a pilot
    // must not read as clear.
    const model = buildLegalityModel({
      ...CLEAR,
      forecastBreaches: ["28-day flight"],
    })

    expect(model.requirements.find((r) => r.id === "flight-28")!.state).toBe("caution")
    expect(model.requirements.find((r) => r.id === "duty-14")!.state).toBe("ok")
  })

  it("matches a forecast breach that carries its regulation reference", () => {
    // `forecastExceedances` names the limit "28-day flight (Reg 107a)" while
    // `calculateCapacity` calls it "28-day flight". An exact match binds the
    // breach to no row at all and the warning disappears.
    const model = buildLegalityModel({
      ...CLEAR,
      forecastBreaches: ["28-day flight (Reg 107a)"],
    })
    expect(model.requirements.find((r) => r.id === "flight-28")!.state).toBe("caution")
  })

  it("reads unknown rather than 0% when no limit is configured", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      capacity: { ...CLEAR.capacity, duty14Days: { used: 0, limit: 0, remaining: 0 } },
    })
    expect(model.requirements.find((r) => r.id === "duty-14")!.state).toBe("unknown")
  })
})

describe("buildLegalityModel — documents", () => {
  it("fails an expired document and cautions one inside its warning window", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      currencies: [
        currency({ code: "LICENCE", status: "expired", daysRemaining: -1 }),
        currency({ code: "OPC320", status: "warning", daysRemaining: 20 }),
        currency({ code: "CRM", status: "valid", daysRemaining: 300 }),
      ],
    })

    expect(model.requirements.find((r) => r.id === "doc-LICENCE")!.state).toBe("fail")
    expect(model.requirements.find((r) => r.id === "doc-LICENCE")!.value).toBe("Expired")
    expect(model.requirements.find((r) => r.id === "doc-OPC320")!.state).toBe("caution")
    expect(model.requirements.find((r) => r.id === "doc-CRM")!.state).toBe("ok")
  })

  it("shows the nearest expiries and folds the remainder into a count", () => {
    // A line pilot carries a dozen currencies. All of them as rows is what stops
    // the panel being readable at a glance, so the tail is summarised — but it
    // is never dropped.
    const model = buildLegalityModel({
      ...CLEAR,
      currencies: [
        currency({ code: "FAR", daysRemaining: 300 }),
        currency({ code: "NEAR", daysRemaining: 5, status: "critical" }),
        currency({ code: "MID", daysRemaining: 60 }),
        currency({ code: "ALSO", daysRemaining: 280 }),
        currency({ code: "MORE", daysRemaining: 290 }),
      ],
      documentRows: 2,
    })

    const docIds = model.requirements.filter((r) => r.group === "documents").map((r) => r.id)
    // Nearest first, then the fold.
    expect(docIds).toEqual(["doc-NEAR", "doc-MID", "doc-rest"])
    expect(model.requirements.find((r) => r.id === "doc-rest")!.value).toBe("3 valid")
  })

  it("meters a document against its own warning window, not its whole validity", () => {
    // Halfway into a 30-day warning window reads as half full. Against the
    // validity period every document would sit near empty for a year and the
    // meter would say nothing at all.
    const model = buildLegalityModel({
      ...CLEAR,
      currencies: [currency({ code: "OPC320", daysRemaining: 15, warningDays: 30 })],
    })
    expect(model.requirements.find((r) => r.id === "doc-OPC320")!.progress).toBeCloseTo(0.5)
  })
})

describe("buildLegalityModel — binding constraint", () => {
  it("names the requirement standing between the pilot and the aircraft", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      rest: {
        isLegalNow: false,
        restElapsedMinutes: 60,
        requiredRestMinutes: 720,
        legalAtUtc: "2026-08-13T12:00:00Z",
      },
      currencies: [currency({ code: "OPC320", status: "warning", daysRemaining: 20 })],
    })

    // Rest outstanding outranks a document three weeks out.
    expect(model.binding?.id).toBe("rest")
  })

  it("falls back to the fullest limit when nothing is flagged", () => {
    // Nothing wrong, so the useful answer is what runs out first.
    const model = buildLegalityModel({
      ...CLEAR,
      capacity: {
        duty14Days: { used: 60, limit: 90, remaining: 30 }, // 67% — the fullest
        duty28Days: { used: 40, limit: 180, remaining: 140 },
        flight28Days: { used: 30, limit: 100, remaining: 70 },
        flight365Days: { used: 300, limit: 1000, remaining: 700 },
      },
    })

    expect(model.verdict).toBe("ok")
    expect(model.binding?.id).toBe("duty-14")
  })
})
