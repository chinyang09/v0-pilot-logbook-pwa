import { describe, expect, it } from "vitest"
import { currencySummary, daysFigure } from "../currency-summary"
import type { CurrencyWithStatus } from "@/types/entities/roster.types"

const doc = (over: Partial<CurrencyWithStatus>): CurrencyWithStatus => ({
  id: over.code ?? "X",
  code: "X",
  description: "",
  expiryDate: "2027-06-30",
  warningDays: 30,
  criticalDays: 7,
  autoUpdate: false,
  createdAt: 0,
  syncStatus: "synced",
  status: "valid",
  daysRemaining: 200,
  ...over,
})

describe("daysFigure", () => {
  it("reads days, then years past a year", () => {
    expect(daysFigure(-1)).toBe("Expired")
    expect(daysFigure(0)).toBe("Today")
    expect(daysFigure(45)).toBe("45d")
    expect(daysFigure(730)).toBe("2.0y")
  })
})

describe("currencySummary", () => {
  it("groups as the Currencies page does: attention, then current, each soonest first, by name", () => {
    const s = currencySummary(
      [
        doc({ id: "a", code: "PASSPORT", description: "Passport", expiryDate: "2030-01-01", daysRemaining: 1140 }),
        doc({ id: "b", code: "DG", description: "Dangerous Goods", expiryDate: "2026-11-25", status: "warning", daysRemaining: 6 }),
        doc({ id: "c", code: "MEDIC", description: "", expiryDate: "2027-03-01", daysRemaining: 102 }),
        doc({ id: "d", code: "LICENCE", description: "Licence", expiryDate: "2026-11-01", status: "expired", daysRemaining: -18 }),
      ],
      null,
    )
    expect(s.attention.map((l) => [l.name, l.state, l.figure])).toEqual([
      ["Licence", "fail", "Expired"],
      ["Dangerous Goods", "caution", "6d"],
    ])
    // A blank description falls back to the code.
    expect(s.current.map((l) => [l.name, l.figure])).toEqual([
      ["MEDIC", "102d"],
      ["Passport", "3.1y"],
    ])
  })

  it("flags a document that is valid now but lapses before the chosen duty reports", () => {
    // Valid through 30 Nov — it lapses at 00:00 SGT on 1 Dec (16:00Z 30 Nov).
    const crm = doc({ id: "crm", code: "CRM", description: "CRM", expiryDate: "2026-11-30", daysRemaining: 11 })
    const before = currencySummary([crm], Date.UTC(2026, 10, 30, 15, 0))
    expect(before.attention).toEqual([])
    const after = currencySummary([crm], Date.UTC(2026, 10, 30, 17, 0))
    expect(after.attention).toHaveLength(1)
    expect(after.attention[0]).toMatchObject({ state: "caution", lapsesBeforeDuty: true })
  })

  it("does not call an expired document one that lapses before the duty", () => {
    const s = currencySummary(
      [doc({ code: "OLD", expiryDate: "2026-01-01", status: "expired", daysRemaining: -300 })],
      Date.UTC(2026, 11, 1),
    )
    expect(s.attention[0]).toMatchObject({ state: "fail", lapsesBeforeDuty: false })
  })
})
