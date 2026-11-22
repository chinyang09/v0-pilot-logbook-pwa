import { describe, expect, it } from "vitest"
import { destinationOfRoute } from "../destination"

describe("destinationOfRoute", () => {
  it("names where a duty goes, the return home left out", () => {
    expect(destinationOfRoute("WSSS-WIII-WSSS")).toBe("WIII")
    expect(destinationOfRoute("WSSS-WMKK-VTBS-WSSS")).toBe("WMKK·VTBS")
    expect(destinationOfRoute("WSSS-WIII")).toBe("WIII")
    expect(destinationOfRoute("WSSS")).toBe("WSSS")
    expect(destinationOfRoute("")).toBe("")
  })
  it("writes each stop as the pilot reads codes", () => {
    expect(destinationOfRoute("WSSS-WIII-WSSS", (c) => (c === "WIII" ? "CGK" : c))).toBe("CGK")
  })
})
