import { describe, expect, it } from "vitest"
import { largestCircle } from "../largest-circle"

describe("largestCircle", () => {
  it("fills an empty box, centred", () => {
    expect(largestCircle(100, 60, [])).toEqual({ x: 50, y: 30, r: 30 })
  })

  it("keeps clear of the text in the corners", () => {
    const corners = [
      { left: 0, top: 0, right: 40, bottom: 20 },
      { left: 120, top: 0, right: 160, bottom: 30 },
      { left: 0, top: 120, right: 50, bottom: 140 },
      { left: 110, top: 125, right: 160, bottom: 140 },
    ]
    const c = largestCircle(160, 140, corners)!
    expect(c).not.toBeNull()
    for (const q of corners) {
      const dx = Math.max(q.left - c.x, 0, c.x - q.right)
      const dy = Math.max(q.top - c.y, 0, c.y - q.bottom)
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(c.r - 1e-9)
    }
    expect(c.r).toBeGreaterThan(50)
    expect(c.r).toBeLessThanOrEqual(70)
    expect(Math.abs(c.x - 80)).toBeLessThanOrEqual(160 * 0.15)
  })

  it("moves the ring down when the text is all at the top", () => {
    const c = largestCircle(100, 160, [
      { left: 0, top: 0, right: 100, bottom: 40 },
    ])!
    expect(c.r).toBe(50)
    expect(c.y).toBeGreaterThanOrEqual(90)
  })

  it("answers nothing for an empty box", () => {
    expect(largestCircle(0, 100, [])).toBeNull()
  })
})
