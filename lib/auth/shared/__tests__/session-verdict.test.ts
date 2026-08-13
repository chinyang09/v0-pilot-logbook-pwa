import { describe, expect, it } from "vitest"

import { classifySessionResponse } from "../session-verdict"

describe("classifySessionResponse", () => {
  it("accepts an authoritative yes", () => {
    expect(
      classifySessionResponse({ ok: true, body: { authenticated: true, user: { id: "u1" } } }),
    ).toBe("valid")
  })

  it("accepts an authoritative no", () => {
    // A session revoked from another device MUST still lock the app. The
    // three-state rule is not permission to ignore a real denial.
    expect(classifySessionResponse({ ok: true, body: { authenticated: false } })).toBe("invalid")
  })

  describe("the service worker's offline stub is not a denial", () => {
    // public/sw.js answers a failed API request with a RESOLVED
    // `503 {error:"Offline", offline:true}`. It parses as JSON and has no
    // `authenticated` key, so `!data.authenticated` read it as "logged out"
    // and bounced the user to /login the moment they lost signal — with no
    // way back until the app was killed and relaunched.
    const stub = {
      error: "Offline",
      offline: true,
      message: "You are offline. Changes will sync when back online.",
    }

    it("is unknown by status alone", () => {
      expect(classifySessionResponse({ ok: false, body: stub })).toBe("unknown")
    })

    it("is unknown by its header even if the status were 200", () => {
      expect(classifySessionResponse({ ok: true, swOffline: "1", body: stub })).toBe("unknown")
    })

    it("is unknown by its body even with no header and a 200", () => {
      expect(classifySessionResponse({ ok: true, body: stub })).toBe("unknown")
    })
  })

  it("treats a server error as unknown, not as a logout", () => {
    // A MongoDB cold start or pool timeout is the server failing to reach the
    // answer. It used to come back as `{authenticated:false}` with a 200,
    // which signed the user out over a backend hiccup.
    expect(classifySessionResponse({ ok: false, body: { error: "Session check unavailable" } })).toBe(
      "unknown",
    )
  })

  it("treats an unparseable body as unknown", () => {
    // A captive portal's HTML interstitial, or a truncated response.
    expect(classifySessionResponse({ ok: true, body: undefined })).toBe("unknown")
  })

  it("treats a payload without an explicit boolean as unknown", () => {
    // A missing key is an unrecognised envelope, not a denial. Only the
    // server writing `authenticated: false` counts as one.
    expect(classifySessionResponse({ ok: true, body: {} })).toBe("unknown")
    expect(classifySessionResponse({ ok: true, body: { authenticated: "no" } })).toBe("unknown")
    expect(classifySessionResponse({ ok: true, body: { authenticated: 0 } })).toBe("unknown")
  })
})
