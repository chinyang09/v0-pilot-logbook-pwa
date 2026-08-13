import { describe, expect, it } from "vitest"

import { assertSameOrigin } from "../session"

/**
 * Once sync moved off a bearer token and onto the HttpOnly session cookie,
 * every mutating endpoint became CSRF-relevant: a browser attaches a cookie by
 * itself, where it would never have attached an `Authorization` header.
 * `SameSite=Lax` is the first lock; this is the second.
 */

function req(headers: Record<string, string>): Request {
  return new Request("https://oooi.app/api/sync/bulk", { method: "POST", headers })
}

describe("assertSameOrigin", () => {
  it("accepts a request from the app's own origin", () => {
    expect(assertSameOrigin(req({ host: "oooi.app", origin: "https://oooi.app" }))).toBe(true)
  })

  it("accepts a same-origin request on a non-default port", () => {
    // Compared against the host the request arrived on, so localhost and
    // preview deployments work with no configuration.
    expect(
      assertSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3000" })),
    ).toBe(true)
  })

  it("rejects a cross-site origin", () => {
    expect(assertSameOrigin(req({ host: "oooi.app", origin: "https://evil.example" }))).toBe(false)
  })

  it("rejects a look-alike origin", () => {
    // A prefix/suffix comparison would wave both of these through.
    expect(assertSameOrigin(req({ host: "oooi.app", origin: "https://oooi.app.evil.example" }))).toBe(
      false,
    )
    expect(assertSameOrigin(req({ host: "oooi.app", origin: "https://notoooi.app" }))).toBe(false)
  })

  it("falls back to Referer when Origin is absent", () => {
    expect(
      assertSameOrigin(req({ host: "oooi.app", referer: "https://oooi.app/logbook" })),
    ).toBe(true)
    expect(
      assertSameOrigin(req({ host: "oooi.app", referer: "https://evil.example/attack" })),
    ).toBe(false)
  })

  it("prefers Origin over Referer", () => {
    expect(
      assertSameOrigin(
        req({ host: "oooi.app", origin: "https://evil.example", referer: "https://oooi.app/x" }),
      ),
    ).toBe(false)
  })

  it("allows a request that states neither", () => {
    // Some same-origin GETs and non-browser callers send neither header, and a
    // browser-driven cross-site request always sends Origin — so rejecting here
    // would break legitimate callers without closing anything.
    expect(assertSameOrigin(req({ host: "oooi.app" }))).toBe(true)
  })

  it("rejects an unparseable origin rather than trusting it", () => {
    expect(assertSameOrigin(req({ host: "oooi.app", origin: "null" }))).toBe(false)
    expect(assertSameOrigin(req({ host: "oooi.app", origin: "not a url" }))).toBe(false)
  })
})
