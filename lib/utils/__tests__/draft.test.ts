import { describe, expect, it } from "vitest"
import { draftDirty, draftValues } from "@/lib/utils/draft"

describe("draft", () => {
  const base = { code: "MEDIC", expiryDate: "2027-01-31", notes: "" }

  it("shows the record wherever the user has not typed", () => {
    expect(draftValues(base, { notes: "renew early" })).toEqual({ ...base, notes: "renew early" })
    // A pull moves the record underneath: untouched fields follow it.
    const pulled = { ...base, expiryDate: "2028-01-31" }
    expect(draftValues(pulled, { notes: "renew early" }).expiryDate).toBe("2028-01-31")
  })

  it("is dirty only when an edit differs from the record", () => {
    expect(draftDirty(base, {})).toBe(false)
    expect(draftDirty(base, { code: "MEDIC" })).toBe(false)
    expect(draftDirty(base, { notes: "x" })).toBe(true)
    // An edit the record has since caught up with is no longer a change.
    expect(draftDirty({ ...base, notes: "x" }, { notes: "x" })).toBe(false)
  })
})
