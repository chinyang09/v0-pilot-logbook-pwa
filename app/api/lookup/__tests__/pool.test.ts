/**
 * The shared pool says "could not be read" (503) when MongoDB fails, rather
 * than an empty answer — `lookup.pool*` turns that into null, which its
 * callers treat as "not asked" and move on to the gateway.
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: async () => {
    throw new Error("cold start")
  },
}))

const post = (body: unknown) =>
  new Request("https://app.test/api/lookup/pool/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })

describe("the shared pool", () => {
  it("answers 503 when the aircraft pool cannot be read", async () => {
    const { POST } = await import("../pool/aircraft/route")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await POST(post({ registrations: ["9V-TNL"] }))
    expect(res.status).toBe(503)
  })

  it("answers 503 when the airport pool cannot be read", async () => {
    const { POST } = await import("../pool/airport/route")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await POST(post({ codes: ["WSSS"] }))
    expect(res.status).toBe(503)
  })

  it("still answers an empty request without asking MongoDB", async () => {
    const { POST } = await import("../pool/aircraft/route")
    const res = await POST(post({ registrations: [] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: {} })
  })
})
