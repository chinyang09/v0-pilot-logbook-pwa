/**
 * The owner's FLYING JOURNAL card, filled from the briefing — the figures
 * they used to copy off the OFP by hand into a notes app (Nov 2026):
 *
 * ```
 * DATE 22 Nov   A/C REG 9V-TNG
 * OFF 2230  ON 0005  BLOCK 1:35  FLIGHT 1:07
 * INIT A  ALTN WSSS  TO KCH WBGG  FLT NBR TR438  TIME ZONE UTC+8
 *         DIST 423   TROPO 547    CRZ FL 290     CRZ TEMP -26
 * INIT B  TAXI 200   TRIP 2566    RTE RSV 200    ALTN 2396   FINAL 763   MDF 3159
 *         ZFW 54877/64300   BLOCK 6125   TOW 60802/79000   LW 58236/67400   AVG WIND -10
 * OPTI CLB 244 FL154 · 279 FL290    EXTRA 0   60 TOPUP 0   ADTNL 0
 * ```
 *
 * Where each comes from: OFF / ON the scheduled times; BLOCK their span;
 * FLIGHT the trip time; ALTN the first alternate of the alternate summary;
 * TIME ZONE the destination's ("UTC VAR"); DIST the ground miles; TROPO the
 * forecast's tropopause; CRZ TEMP the forecast OAT at the cruise level over
 * the cruise waypoints; RTE RSV the 5% contingency; FINAL the alternate
 * holding; MDF the alternate fuel and the final reserve together; BLOCK fuel
 * the fuel in tanks. Pure.
 */

import type { Briefing } from "./types"
import type { BriefingRecord, FrequencyNote } from "@/types/entities/briefing.types"

export interface JournalCard {
  date: string
  registration: string
  off: string
  on: string
  /** The scheduled block, "1:35". */
  block: string
  /** The trip time, "1:07". */
  flight: string
  initA: {
    altn: string
    toIata: string
    toIcao: string
    flightNumber: string
    /** "UTC+8". */
    timeZone: string
    distNm: number | null
    tropo: number | null
    crzFl: number | null
    crzTemp: number | null
  }
  initB: {
    taxi: number | null
    trip: number | null
    rteRsv: number | null
    altn: number | null
    final: number | null
    mdf: number | null
    zfw: { planned: number | null; max: number | null }
    block: number | null
    tow: { planned: number | null; max: number | null }
    lw: { planned: number | null; max: number | null }
    avgWindKt: number | null
  }
  optiClimb: { ias: number; fl: number }[]
  extra: number | null
  topup60: number | null
  additional: number | null
}

const span = (from: string, to: string) => {
  const m = (s: string) => {
    const x = s.match(/^(\d{2}):(\d{2})$/)
    return x ? Number(x[1]) * 60 + Number(x[2]) : null
  }
  const a = m(from)
  const b = m(to)
  if (a === null || b === null) return ""
  const d = (b - a + 1440) % 1440
  return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`
}

const zone = (minutes: number | null) => {
  if (minutes === null) return ""
  const sign = minutes < 0 ? "-" : "+"
  const a = Math.abs(minutes)
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`
}

export function journalOf(b: Briefing): JournalCard {
  const f = b.fuel
  return {
    date: b.flight.date,
    registration: b.flight.registration,
    off: b.route.schedDep,
    on: b.route.schedArr,
    block: span(b.route.schedDep, b.route.schedArr),
    flight: b.route.tripTime,
    initA: {
      altn: b.alternates[0]?.icao ?? "",
      toIata: b.flight.arrIata,
      toIcao: b.flight.arr,
      flightNumber: b.flight.number,
      timeZone: zone(b.flight.arrUtcOffsetMinutes),
      distNm: b.route.groundNm,
      tropo: b.winds.tropopause,
      crzFl: b.route.cruiseFl,
      crzTemp: b.winds.cruiseOat,
    },
    initB: {
      taxi: f.taxi.kg,
      trip: f.trip.kg,
      rteRsv: f.contingency.kg,
      altn: f.alternate.kg,
      final: f.finalReserve.kg,
      mdf: f.mdf,
      zfw: b.weights.zfw,
      block: f.inTanks.kg,
      tow: b.weights.tow,
      lw: b.weights.lw,
      avgWindKt: b.route.avgWindKt,
    },
    optiClimb: b.optiClimb?.steps ?? [],
    extra: f.extra.kg ?? 0,
    topup60: f.topup60.kg,
    additional: f.additional.kg,
  }
}

/**
 * The FIRs the route crosses, in order, each with the first named waypoint
 * after the boundary — the rows of the card's FIR | WP | FREQ table before
 * the pilot has written any (the frequency is theirs to fill).
 */
export function firCrossings(b: Briefing): FrequencyNote[] {
  const out: FrequencyNote[] = []
  const nav = b.navlog
  for (let i = 0; i < nav.length; i++) {
    const fir = nav[i].fir
    if (!fir || out[out.length - 1]?.fir === fir) continue
    const next = nav.slice(i + 1).find((p) => !p.fir && p.name !== "TOC" && p.name !== "TOD")
    out.push({ fir, wp: next?.name ?? "", freq: "" })
  }
  return out
}

export interface FuelHistory {
  /** Briefings of the same route, newest first (this one left out). */
  count: number
  trip: { min: number; max: number; avg: number } | null
  block: { min: number; max: number; avg: number } | null
  /** The same aeroplane's on this route. */
  sameRegistration: number
}

const stats = (xs: number[]) =>
  xs.length ? { min: Math.min(...xs), max: Math.max(...xs), avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) } : null

/**
 * What earlier briefings of the same route and type planned — the owner: "as
 * we import more and have more data, we will have an idea of how much or how
 * much more to carry".
 */
export function fuelHistory(current: BriefingRecord, all: BriefingRecord[]): FuelHistory {
  const same = all.filter(
    (r) =>
      r.id !== current.id &&
      !r.deletedAt &&
      r.dep === current.dep &&
      r.arr === current.arr &&
      r.aircraftType.slice(0, 4) === current.aircraftType.slice(0, 4) &&
      r.data,
  )
  const trip = same.map((r) => r.data!.fuel.trip.kg).filter((x): x is number => x !== null)
  const block = same.map((r) => r.data!.fuel.inTanks.kg).filter((x): x is number => x !== null)
  return {
    count: same.length,
    trip: stats(trip),
    block: stats(block),
    sameRegistration: same.filter((r) => r.registration === current.registration).length,
  }
}
