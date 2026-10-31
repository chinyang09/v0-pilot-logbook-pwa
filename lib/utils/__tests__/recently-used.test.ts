import { describe, expect, it } from "vitest"
import { recentlyUsedKeys } from "@/lib/utils/recently-used"

describe("recentlyUsedKeys", () => {
  const flights = [
    { dep: "WSSS", arr: "VVNB" },
    { dep: "VVNB", arr: "WSSS" },
    { dep: "WSSS", arr: "wmkk" },
    { dep: "", arr: "RPLL" },
  ]

  it("keeps the first sighting of each key, in order", () => {
    expect(recentlyUsedKeys(flights, (f) => [f.dep, f.arr])).toEqual(["WSSS", "VVNB", "wmkk", "RPLL"])
  })

  it("stops at the limit, mid-item included", () => {
    expect(recentlyUsedKeys(flights, (f) => [f.dep, f.arr], 3)).toEqual(["WSSS", "VVNB", "wmkk"])
  })

  it("compares keys as given, so a caller normalises", () => {
    const keys = recentlyUsedKeys([{ r: "9v-tnf" }, { r: "9V-TNF" }], (f) => [f.r.toUpperCase()])
    expect(keys).toEqual(["9V-TNF"])
  })

  it("skips empty keys", () => {
    expect(recentlyUsedKeys([{ a: null }, { a: undefined }, { a: "" }, { a: "X" }], (f) => [f.a])).toEqual(["X"])
  })
})
