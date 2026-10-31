/**
 * The lookup envelope, read the same way at every hop (Worker, Node → Edge
 * hand-off, browser): the door's answers pass through as they are, and
 * anything that is not the envelope is "could not be made" (502) — never
 * "nothing found", which sends a pilot to manual entry.
 */

import { describe, expect, it } from "vitest"
import { readEnvelope, setQuery } from "../envelope"

describe("readEnvelope", () => {
  it("passes the door's answers through", () => {
    expect(readEnvelope(200, { ok: true, data: [1], source: "search" })).toEqual({ ok: true, status: 200, data: [1], source: "search" })
    expect(readEnvelope(404, { ok: false, error: "No aircraft found" })).toEqual({ ok: false, status: 404, error: "No aircraft found" })
    expect(readEnvelope(401, { ok: false, error: "Unauthorized" })).toMatchObject({ status: 401 })
    expect(readEnvelope(502, { ok: false, error: "every source failed" })).toMatchObject({ status: 502 })
  })

  it("reads an answer that is not the envelope as 502, whatever its status", () => {
    // A deploy without the route answers Next's HTML 404 — not "no such aircraft".
    expect(readEnvelope(404, null)).toEqual({ ok: false, status: 502, error: "HTTP 404" })
    expect(readEnvelope(401, null)).toMatchObject({ status: 502 })
    expect(readEnvelope(200, "<html>")).toMatchObject({ ok: false, status: 502 })
    // A 200 that does not say ok is not an answer either.
    expect(readEnvelope(200, { data: [] })).toMatchObject({ ok: false, status: 502 })
  })

  it("never takes a source or an error that is not a string", () => {
    expect(readEnvelope(200, { ok: true, data: null, source: 7 })).toMatchObject({ ok: true, source: "" })
    expect(readEnvelope(500, { ok: false, error: { nested: true } })).toMatchObject({ error: "HTTP 500" })
  })
})

describe("setQuery", () => {
  it("leaves out absent and empty parameters", () => {
    const url = setQuery(new URL("https://gw.test/flight"), { number: "TR288", out: undefined, date: "", limit: 0 })
    expect(url.search).toBe("?number=TR288&limit=0")
  })
})
