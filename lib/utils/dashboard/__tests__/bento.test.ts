import { describe, expect, it } from "vitest"
import { moveTile, nextWidth, nudgeTile, packTiles, widthLabel } from "../bento"

const MIN = { duty: 12, flight: 12, weather: 4, crew: 4, destination: 4, currency: 6, limits: 6 }
type Id = keyof typeof MIN
const DEFAULT: Id[] = ["duty", "flight", "weather", "crew", "destination", "currency", "limits"]
const spans = (order: Id[]) => packTiles(order, MIN).map((r) => r.map((t) => `${t.id}:${t.span}`))

describe("packTiles", () => {
  it("packs the default order into the layout the dashboard has always had", () => {
    expect(spans(DEFAULT)).toEqual([
      ["duty:12"],
      ["flight:12"],
      ["weather:4", "crew:4", "destination:4"],
      ["currency:6", "limits:6"],
    ])
  })

  it("fills every row edge to edge whatever the order", () => {
    const order: Id[] = ["weather", "currency", "duty", "crew", "destination", "limits", "flight"]
    const rows = packTiles(order, MIN)
    for (const row of rows) expect(row.reduce((n, t) => n + t.span, 0)).toBe(12)
    expect(spans(order)).toEqual([
      ["weather:5", "currency:7"],
      ["duty:12"],
      ["crew:6", "destination:6"],
      ["limits:12"],
      ["flight:12"],
    ])
  })

  it("keeps the pilot's order reading left to right, top to bottom", () => {
    const order: Id[] = ["limits", "crew", "duty", "weather", "flight", "destination", "currency"]
    expect(packTiles(order, MIN).flat().map((t) => t.id)).toEqual(order)
  })
})

describe("moveTile / nudgeTile", () => {
  it("moves a tile to where another is", () => {
    expect(moveTile(DEFAULT, "limits", "duty")).toEqual(["limits", "duty", "flight", "weather", "crew", "destination", "currency"])
    expect(moveTile(DEFAULT, "duty", "crew")).toEqual(["flight", "weather", "crew", "duty", "destination", "currency", "limits"])
  })

  it("nudges by one, clamped to the ends", () => {
    expect(nudgeTile(DEFAULT, "duty", -1)).toEqual(DEFAULT)
    expect(nudgeTile(DEFAULT, "duty", 1).slice(0, 2)).toEqual(["flight", "duty"])
    expect(nudgeTile(DEFAULT, "limits", 1)).toEqual(DEFAULT)
  })
})

describe("widths", () => {
  it("packs the pilot's own widths: two thirds beside a third, a half alone", () => {
    const widths = { ...MIN, weather: 8, crew: 4, destination: 6 }
    expect(packTiles(DEFAULT, widths).map((r) => r.map((t) => `${t.id}:${t.span}`))).toEqual([
      ["duty:12"],
      ["flight:12"],
      ["weather:8", "crew:4"],
      ["destination:6", "currency:6"],
      ["limits:12"],
    ])
  })

  it("cycles a third → a half → two thirds → the row → a third", () => {
    expect([4, 6, 8, 12].map((w) => nextWidth(w))).toEqual([6, 8, 12, 4])
    expect(nextWidth(12, [6, 8, 12])).toBe(6)
    expect([4, 6, 8, 12].map(widthLabel)).toEqual(["⅓", "½", "⅔", "Full"])
  })
})
