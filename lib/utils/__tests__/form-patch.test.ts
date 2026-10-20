import { describe, expect, it } from "vitest"
import { formPatch, rebaseForm } from "@/lib/utils/form-patch"

type F = Record<string, unknown>

describe("formPatch", () => {
  it("writes only what the user changed since the baseline", () => {
    const baseline: F = { id: "f1", outTime: "08:00", remarks: "", serverSeq: 4, updatedAt: 1 }
    const form: F = { ...baseline, remarks: "bumpy", serverSeq: 2, updatedAt: 9 }
    expect(formPatch(form, baseline)).toEqual({ remarks: "bumpy" })
  })

  it("never authors bookkeeping or bin state", () => {
    expect(formPatch<F>({ id: "x", deletedAt: null, syncStatus: "pending" }, { id: "y", deletedAt: 5 })).toEqual({})
  })

  it("treats an empty list as no value", () => {
    expect(formPatch({ approaches: [] }, {})).toEqual({})
  })
})

describe("rebaseForm — a pull lands under an open form", () => {
  const loaded: F = { id: "f1", outTime: "08:00", inTime: "12:00", remarks: "", signature: undefined, serverSeq: 4 }

  it("adopts what another device changed, so the next save does not send it back", () => {
    const live: F = { ...loaded, outTime: "08:10", signature: { strokes: [] }, serverSeq: 7 }
    const r = rebaseForm({ form: loaded, baseline: loaded, previous: loaded, live })
    expect(r.form).toMatchObject({ outTime: "08:10", signature: { strokes: [] }, serverSeq: 7 })
    expect(formPatch(r.form, r.baseline)).toEqual({})
  })

  it("keeps a field the user is editing, and still sends it", () => {
    const form: F = { ...loaded, remarks: "mine" }
    const live: F = { ...loaded, remarks: "theirs", outTime: "08:10" }
    const r = rebaseForm({ form, baseline: loaded, previous: loaded, live })
    expect(r.form.remarks).toBe("mine")
    expect(r.form.outTime).toBe("08:10")
    expect(formPatch(r.form, r.baseline)).toEqual({ remarks: "mine" })
  })

  it("always follows a picker field, which only the database writes", () => {
    const form: F = { ...loaded, aircraftReg: "9V-OLD" }
    const live: F = { ...loaded, aircraftReg: "9V-NEW" }
    const r = rebaseForm({ form, baseline: loaded, previous: loaded, live, alwaysAdopt: new Set(["aircraftReg"]) })
    expect(r.form.aircraftReg).toBe("9V-NEW")
  })

  it("drops a field the row cleared", () => {
    const withRemark: F = { ...loaded, remarks: "x" }
    const live: F = { ...loaded }
    delete live.remarks
    const r = rebaseForm({ form: withRemark, baseline: withRemark, previous: withRemark, live })
    expect(r.form).not.toHaveProperty("remarks")
    expect(r.adopted).toEqual(["remarks"])
  })
})
