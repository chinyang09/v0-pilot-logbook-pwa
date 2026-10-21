/**
 * A flight is keyed on the UTC date of its OUT, so an OFF at 00:07 after an
 * OUT at 23:52 is the NEXT day. Classified on the flight's date, the takeoff
 * was judged by the sun a whole day early — which, near twilight at a high
 * latitude, is a different answer.
 */

import { describe, it, expect } from "vitest"
import { isTakeoffAtNight, isLandingAtNight, calculateTakeoffsLandings } from "../flight-calculations"
import { isNight } from "../night-time"
import type { Airport } from "@/types/entities/airport.types"

// Baker Lake, Nunavut: in February civil dawn and dusk move several minutes a
// day, so read a day early the sun disagrees at some minute of the day.
const AIRPORT = { icao: "CYBK", latitude: 64.299, longitude: -96.078 } as Airport
const DAY = "2026-02-10"
const NEXT = Date.UTC(2026, 1, 11)
const PREV = Date.UTC(2026, 1, 10)

/** A clock time at which the two days disagree. */
function disputedMinute(): string {
  for (let m = 0; m < 23 * 60; m++) {
    if (isNight(new Date(PREV + m * 60_000), AIRPORT.latitude!, AIRPORT.longitude!) !==
        isNight(new Date(NEXT + m * 60_000), AIRPORT.latitude!, AIRPORT.longitude!)) {
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
    }
  }
  throw new Error("fixture no longer straddles dusk")
}

describe("a takeoff after midnight UTC", () => {
  const off = disputedMinute()
  const [h, mm] = off.split(":").map(Number)
  const truth = isNight(new Date(NEXT + (h * 60 + mm) * 60_000), AIRPORT.latitude!, AIRPORT.longitude!)

  it("is judged on the day it happened, not the flight's date", () => {
    expect(isTakeoffAtNight(DAY, off, AIRPORT, "23:59")).toBe(truth)
  })

  it("carries through to the landing and the counts", () => {
    expect(isLandingAtNight(DAY, "23:59", off, AIRPORT, "23:58")).toBe(truth)
    const counts = calculateTakeoffsLandings(DAY, off, off, AIRPORT, AIRPORT, true, "23:59")
    expect(counts.nightTakeoffs).toBe(truth ? 1 : 0)
    expect(counts.dayTakeoffs).toBe(truth ? 0 : 1)
  })

  it("without an OUT, an OFF is read on the flight's own date as before", () => {
    const sameDay = isNight(new Date(PREV + (h * 60 + mm) * 60_000), AIRPORT.latitude!, AIRPORT.longitude!)
    expect(isTakeoffAtNight(DAY, off, AIRPORT)).toBe(sameDay)
  })
})
