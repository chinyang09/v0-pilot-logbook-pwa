/**
 * The Node → Edge lookup hand-off: which origin it reaches the door at (the
 * user's own deployment, or the production domain for the cron), what it
 * sends (the server secret, the user's cookies, Vercel's bypass header), and
 * that an answer which is not the door's — deployment protection's sign-in
 * page — reads as "the lookup could not be made" (502), never as "not found".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handoffOrigin, lookupFromEdge } from "../handoff"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("lookupFromEdge", () => {
  let seen: { url: string; headers: Record<string, string> }[]
  let answer: () => Response

  beforeEach(() => {
    seen = []
    vi.stubEnv("FR24_PROXY_SECRET", "s3cret")
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "000i.vercel.app")
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> })
        return answer()
      })
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("reaches the door on the user's own deployment, with their cookies and the server secret", async () => {
    answer = () => json({ ok: true, data: [{ registration: "9V-TNL" }], source: "search" })
    const request = new Request("https://preview-abc.vercel.app/api/submissions/aircraft", {
      headers: { cookie: "session=t; _vercel_jwt=j" },
    })
    const result = await lookupFromEdge("aircraft", { reg: "9V-TNL" }, { request })
    expect(result).toMatchObject({ ok: true, source: "search" })
    expect(seen[0].url).toBe("https://preview-abc.vercel.app/api/lookup/aircraft?reg=9V-TNL")
    expect(seen[0].headers).toMatchObject({ cookie: "session=t; _vercel_jwt=j", "x-lookup-secret": "s3cret" })
  })

  it("reaches the production domain when there is no user request (the cron)", async () => {
    answer = () => json({ ok: false, error: "No aircraft found" }, 404)
    const result = await lookupFromEdge("aircraft", { reg: "9V-ZZZ" })
    expect(seen[0].url).toBe("https://000i.vercel.app/api/lookup/aircraft?reg=9V-ZZZ")
    expect(seen[0].headers).not.toHaveProperty("cookie")
    expect(result).toEqual({ ok: false, status: 404, error: "No aircraft found" })
  })

  it("adds Vercel's automation bypass when the project defines one", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass")
    answer = () => json({ ok: true, data: [], source: "search" })
    await lookupFromEdge("aircraft", { reg: "9V-TNL" })
    expect(seen[0].headers["x-vercel-protection-bypass"]).toBe("bypass")
  })

  it("reads a sign-in page (not the door's JSON) as 502, never as not found", async () => {
    answer = () => new Response("<html>Log in to Vercel</html>", { status: 401, headers: { "content-type": "text/html" } })
    const result = await lookupFromEdge("aircraft", { reg: "9V-TNL" })
    expect(result).toMatchObject({ ok: false, status: 502 })
  })

  it("answers status 0 when there is nowhere to send it, and never throws", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "")
    expect(handoffOrigin()).toBeNull()
    expect(await lookupFromEdge("aircraft", { reg: "9V-TNL" })).toMatchObject({ ok: false, status: 0 })
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "000i.vercel.app")
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down") }))
    expect(await lookupFromEdge("aircraft", { reg: "9V-TNL" })).toMatchObject({ ok: false, status: 0 })
  })
})
