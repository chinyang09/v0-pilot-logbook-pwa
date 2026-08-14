import { describe, expect, it } from "vitest"

import { buildLegalityModel, type LegalityInput } from "../legality"
import type { CurrencyWithStatus } from "@/types/entities/roster.types"

/**
 * The requirement model. This is the one part of the dashboard a pilot could
 * act on wrongly, so the rules that decide a requirement's state are pinned
 * here rather than left to the component that renders them.
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

describe("buildLegalityModel — recency is ONE requirement", () => {
  it("answers 'am I recent' as a single cell, with both halves in the detail", () => {
    // Takeoffs and landings were two cells that said the same thing and, sorted
    // by urgency, did not even sit beside each other. A pilot checks recency as
    // one question.
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 6, landings: 4, current: true, lapseIso: "2026-11-01" },
    })

    const rows = model.requirements.filter((r) => r.id.startsWith("recency"))
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe("90-day recency")
    expect(rows[0].detail).toContainEqual({ label: "Takeoffs", value: "6 / 3" })
    expect(rows[0].detail).toContainEqual({ label: "Landings", value: "4 / 3" })
  })

  it("fails on whichever half is short, and names both in the remedy", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 1, landings: 2, current: false, lapseIso: null },
    })

    const recency = model.requirements.find((r) => r.id === "recency")!
    expect(recency.state).toBe("fail")
    expect(recency.action).toBe("2 takeoffs and 1 landing required")
  })

  it("cautions while still met but about to lapse", () => {
    // Met today, lapses in 6 days — the case a current/not-current chip cannot
    // express, and the only one where a pilot can still act.
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 3, landings: 3, current: true, lapseIso: "2026-08-19" },
    })

    const recency = model.requirements.find((r) => r.id === "recency")!
    expect(recency.state).toBe("caution")
    expect(recency.value).toBe("6d")
    expect(model.verdict).toBe("caution")
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

  it("matches a forecast breach that carries its regulation reference", () => {
    // `forecastExceedances` names the limit "28-day flight (Reg 107a)" while
    // `calculateCapacity` calls it "28-day flight". An exact match binds the
    // breach to no row at all and the warning disappears.
    const model = buildLegalityModel({ ...CLEAR, forecastBreaches: ["28-day flight (Reg 107a)"] })
    expect(model.requirements.find((r) => r.id === "flight-28")!.state).toBe("caution")
  })

  it("reads unknown rather than 0% when no limit is configured", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      capacity: { ...CLEAR.capacity, duty14Days: { used: 0, limit: 0, remaining: 0 } },
    })
    expect(model.requirements.find((r) => r.id === "duty-14")!.state).toBe("unknown")
  })

  it("gives a rolling limit no expiry — it refills, it does not lapse", () => {
    // This is what stops a 41%-full 12-month flight limit being reported as the
    // tightest constraint on an otherwise clear pilot.
    const model = buildLegalityModel(CLEAR)
    for (const r of model.requirements.filter((x) => x.group === "limits")) {
      expect(r.daysUntil).toBeUndefined()
    }
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

  it("shows the nearest expiries and folds the rest into an expandable cell", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      currencies: [
        currency({ code: "FAR", daysRemaining: 300 }),
        currency({ code: "NEAR", daysRemaining: 5, status: "critical" }),
        currency({ code: "MID", daysRemaining: 60 }),
        currency({ code: "ALSO", daysRemaining: 280 }),
      ],
      documentRows: 2,
    })

    const ids = model.requirements.filter((r) => r.group === "currency").map((r) => r.id)
    expect(ids).toEqual(["recency", "doc-NEAR", "doc-MID", "doc-rest"])
    // Nothing is hidden — the fold lists what it folded.
    expect(model.requirements.find((r) => r.id === "doc-rest")!.detail).toEqual([
      { label: "ALSO", value: "280d" },
      { label: "FAR", value: "300d" },
    ])
  })

  it("does not repeat the code as a description", () => {
    // "MEDIC / Medical" and "OPC320 / OPC 320" are the same word twice, and the
    // row label is already the code — so the expansion led with a line that
    // said nothing.
    const model = buildLegalityModel({
      ...CLEAR,
      currencies: [
        currency({ code: "MEDIC", description: "Medical", daysRemaining: 100 }),
        currency({ code: "OPC320", description: "OPC 320", daysRemaining: 110 }),
        currency({ code: "LC", description: "Line Check A320", daysRemaining: 120 }),
      ],
    })

    const labels = (id: string) =>
      model.requirements.find((r) => r.id === id)!.detail!.map((d) => d.label)

    expect(labels("doc-MEDIC")).not.toContain("Name")
    expect(labels("doc-OPC320")).not.toContain("Name")
    // A description that genuinely says more keeps its line.
    expect(labels("doc-LC")).toContain("Name")
  })

  it("meters a document against its own warning window, not its whole validity", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      currencies: [currency({ code: "OPC320", daysRemaining: 15, warningDays: 30 })],
    })
    expect(model.requirements.find((r) => r.id === "doc-OPC320")!.progress).toBeCloseTo(0.5)
  })
})

describe("buildLegalityModel — binding constraint", () => {
  it("names the most pressing flagged requirement", () => {
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 1, landings: 6, current: false, lapseIso: null },
      currencies: [currency({ code: "OPC320", status: "warning", daysRemaining: 20 })],
    })
    expect(model.binding?.id).toBe("recency")
  })

  it("falls back to the NEAREST EXPIRY, never the fullest rolling limit", () => {
    // The original rule picked whichever limit was fullest by fraction, which
    // on a clear pilot reported "Flight 1y 604 / 1000h" — 41% used and roughly
    // six months of headroom — as the tightest constraint. It was the least
    // urgent thing on the page. A limit refills; a currency expires.
    const model = buildLegalityModel({
      ...CLEAR,
      capacity: {
        duty14Days: { used: 60, limit: 90, remaining: 30 },
        duty28Days: { used: 40, limit: 180, remaining: 140 },
        flight28Days: { used: 30, limit: 100, remaining: 70 },
        flight365Days: { used: 604, limit: 1000, remaining: 396 },
      },
      recency: { takeoffs: 6, landings: 6, current: true, lapseIso: "2027-01-01" },
      currencies: [
        currency({ code: "MEDIC", daysRemaining: 190 }),
        currency({ code: "OPC320", daysRemaining: 58 }),
      ],
    })

    expect(model.verdict).toBe("ok")
    expect(model.binding?.id).toBe("doc-OPC320")
    expect(model.binding?.value).toBe("58d")
  })

  it("never picks the fold cell as the binding one", () => {
    // The fold stands for several documents at once, so naming it would tell
    // the pilot nothing they could act on.
    const model = buildLegalityModel({
      ...CLEAR,
      recency: { takeoffs: 6, landings: 6, current: true, lapseIso: "2027-06-01" },
      currencies: [
        currency({ code: "A", daysRemaining: 100 }),
        currency({ code: "B", daysRemaining: 110 }),
        currency({ code: "C", daysRemaining: 120 }),
        currency({ code: "D", daysRemaining: 130 }),
      ],
      documentRows: 3,
    })
    expect(model.binding?.id).toBe("doc-A")
  })
})
