import { describe, expect, it } from "vitest"
import { pickSelfCard } from "@/lib/utils/self-card"

describe("pickSelfCard", () => {
  it("answers the same on every device, whatever order the table is in", () => {
    const a = { id: "a", isMe: true, updatedAt: 100 }
    const b = { id: "b", isMe: true, updatedAt: 200 }
    const c = { id: "c", isMe: false, updatedAt: 999 }
    expect(pickSelfCard([a, b, c])?.id).toBe("b")
    expect(pickSelfCard([c, b, a])?.id).toBe("b")
  })

  it("breaks a tie by id, and ignores binned cards", () => {
    expect(pickSelfCard([{ id: "x", isMe: true, updatedAt: 5 }, { id: "y", isMe: true, updatedAt: 5 }])?.id).toBe("y")
    expect(pickSelfCard([{ id: "z", isMe: true, updatedAt: 9, deletedAt: 1 }])).toBeNull()
  })
})
