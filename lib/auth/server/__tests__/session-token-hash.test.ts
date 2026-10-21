import { describe, expect, it } from "vitest"

import { hashSessionToken, isSessionRowFor, sessionTokenFilter } from "../session"

/**
 * A session row stores the SHA-256 of the cookie's secret, never the secret —
 * a read of the `sessions` collection must not yield anything that signs
 * anyone in. Rows written before hashing still hold the raw value and keep
 * working until their first use upgrades them (or the TTL takes them).
 */

const RAW = "ckz8x2v1q0000abcd1234efgh"

describe("session token hashing", () => {
  it("is a stable 64-character hex digest that never equals the raw token", () => {
    const hash = hashSessionToken(RAW)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashSessionToken(RAW))
    expect(hash).not.toBe(RAW)
    expect(hashSessionToken(`${RAW}x`)).not.toBe(hash)
  })

  it("looks a row up by its hash, or by the raw value a pre-hashing row holds", () => {
    expect(sessionTokenFilter(RAW)).toEqual({ token: { $in: [hashSessionToken(RAW), RAW] } })
  })

  it("recognises the current session's row in either form", () => {
    expect(isSessionRowFor({ token: hashSessionToken(RAW) }, RAW)).toBe(true)
    expect(isSessionRowFor({ token: RAW }, RAW)).toBe(true)
    expect(isSessionRowFor({ token: hashSessionToken("other") }, RAW)).toBe(false)
    expect(isSessionRowFor({ token: hashSessionToken(RAW) }, undefined)).toBe(false)
  })
})
