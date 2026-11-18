import { describe, expect, it } from "vitest"
import { itemOf } from "../stored"
import { hasUnansweredReply } from "../types"

const base = {
  id: "aa57dbee-4641",
  kind: "bug",
  area: "FDP",
  title: "Chart time axis",
  details: "",
  context: {},
  writtenAt: new Date("2026-11-18T12:04:47Z"),
  status: "open",
  createdAt: new Date("2026-11-18T12:04:47Z"),
}

describe("a stored report as the app reads it", () => {
  it("reads a report written before conversations as one with none", () => {
    const item = itemOf(base)
    expect(item.messages).toEqual([])
    expect(item.updatedAt).toBe(Date.parse("2026-11-18T12:04:47Z"))
  })

  it("reads the legacy single response as a reply, and the reply as unanswered", () => {
    const item = itemOf({ ...base, status: "done", response: "Fixed in 1333141.", updatedAt: new Date("2026-11-19T01:00:00Z") })
    expect(item.messages).toEqual([{ id: "response", from: "team", text: "Fixed in 1333141.", at: Date.parse("2026-11-19T01:00:00Z") }])
    expect(hasUnansweredReply(item)).toBe(true)
  })

  it("orders the conversation by time, status changes included, and the pilot's last word answers the reply", () => {
    const item = itemOf({
      ...base,
      messages: [
        { id: "p1", from: "pilot", text: "Still there", at: new Date("2026-11-20T00:00:00Z") },
        { id: "t1", from: "team", text: "Fixed", at: new Date("2026-11-19T00:00:00Z") },
        { id: "e1", from: "pilot", text: "Reopened", at: new Date("2026-11-20T00:00:00Z"), event: "open" },
      ],
    })
    expect(item.messages.map((m) => m.id)).toEqual(["t1", "p1", "e1"])
    expect(hasUnansweredReply(item)).toBe(false)
    expect(item.updatedAt).toBe(Date.parse("2026-11-20T00:00:00Z"))
  })

  it("does not trust a status it does not know", () => {
    expect(itemOf({ ...base, status: "triaged" }).status).toBe("open")
  })
})
