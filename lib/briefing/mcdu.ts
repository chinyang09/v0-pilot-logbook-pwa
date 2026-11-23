/**
 * The briefing as the MCDU's own pages — INIT (A) and INIT FUEL PRED (B) —
 * slot for slot, in the form the pilot keys it (the owner, Nov 2026: "mimic
 * the layout so it is easy to compare and key into the MCDU").
 *
 * The Airbus preparation order is DIFSRIP — DATA, INIT A, F-PLN, SEC F-PLN,
 * RAD NAV, INIT B, PERF — and the briefing page lists its sections in it.
 * These two pages are its I and I.
 *
 * Each page is six rows of a left and a right slot, as the screen draws them
 * beside its line select keys: a small label over a large value. A value is
 * what the pilot TYPES — fuel and weights in tonnes to one decimal ("2.6"),
 * times as HHMM ("0107"), the trip wind as HD / TL and three figures. A
 * `ref` slot is not keyed: what the FMS computes itself (INIT B's TRIP,
 * TOW / LW and EXTRA — the owner's photo of the page, Nov 2026) or a figure
 * to compare with (the distance, the live ground temperature); a `rest` is
 * the part the OFP cannot give (the ZFW CG — the load sheet's), drawn as the
 * MCDU's dashes.
 * Pure.
 */

import type { Briefing, FuelLine } from "./types"

export interface McduSlot {
  label: string
  value: string
  /** What follows the value that the OFP has no figure for ("/--.-"). */
  rest?: string
  /** Shown for reference, not keyed. */
  ref?: boolean
}

export interface McduPage {
  title: string
  /** Six rows: [left, right], either side empty where the screen has nothing. */
  rows: [McduSlot | null, McduSlot | null][]
}

/** Kilograms as the MCDU's tonnes: 2566 → "2.6". */
export const tonnes = (kg: number | null | undefined) => (kg === null || kg === undefined ? "---.-" : (kg / 1000).toFixed(1))

/** "1:07" → "0107". */
export const hhmm = (t: string | null | undefined) => {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/)
  return m ? `${m[1].padStart(2, "0")}${m[2]}` : "----"
}

/** -10 → "HD010", +10 → "TL010": a headwind is negative in the OFP. */
export const tripWind = (kt: number | null) =>
  kt === null ? "---" : `${kt > 0 ? "TL" : "HD"}${String(Math.abs(Math.round(kt))).padStart(3, "0")}`

const fuelTime = (f: FuelLine) => `${tonnes(f.kg)}/${hhmm(f.time)}`

/**
 * INIT (A). `groundTempC` is the departure's temperature from the live METAR,
 * where there is one — GND TEMP is keyed off the ATIS, so it is a reference.
 */
export function initA(b: Briefing, groundTempC: number | null = null): McduPage {
  const altn = b.alternates[0]?.icao ?? ""
  const tropo = b.winds.tropopause
  const crz = b.route.cruiseFl
  const oat = b.winds.cruiseOat
  return {
    title: "INIT",
    rows: [
      [
        { label: "CO RTE", value: b.flight.routeNumber || "----------" },
        { label: "FROM/TO", value: `${b.flight.dep}/${b.flight.arr}` },
      ],
      [{ label: "ALTN/CO RTE", value: altn ? `${altn}/` : "----/", rest: "----------" }, null],
      [
        { label: "FLT NBR", value: b.flight.number || b.flight.callsign },
        null,
      ],
      [b.route.groundNm !== null ? { label: "DIST", value: `${b.route.groundNm}NM`, ref: true } : null, null],
      [
        { label: "COST INDEX", value: b.route.costIndex !== null ? String(b.route.costIndex) : "---" },
        { label: "TROPO", value: tropo !== null ? String(tropo * 100) : "-----" },
      ],
      [
        { label: "CRZ FL/TEMP", value: `${crz !== null ? `FL${crz}` : "-----"}/${oat !== null ? `${oat}°` : "---°"}` },
        { label: "GND TEMP", value: groundTempC !== null ? `${groundTempC}°` : "---°", ref: groundTempC !== null },
      ],
    ],
  }
}

/** INIT FUEL PRED (B). */
export function initB(b: Briefing): McduPage {
  const f = b.fuel
  const w = b.weights
  return {
    title: "INIT FUEL PRED",
    rows: [
      [{ label: "TAXI", value: tonnes(f.taxi.kg) }, { label: "ZFW/ZFWCG", value: tonnes(w.zfw.planned), rest: "/--.-" }],
      // TRIP, TOW / LW and EXTRA are the FMS's own sums: green, to check against.
      [{ label: "TRIP/TIME", value: fuelTime(f.trip), ref: true }, { label: "BLOCK", value: tonnes(f.inTanks.kg) }],
      [{ label: "RTE RSV/%", value: `${tonnes(f.contingency.kg)}/${f.contingencyPct !== null && f.contingencyPct !== undefined ? f.contingencyPct.toFixed(1) : "-.-"}` }, null],
      [{ label: "ALTN/TIME", value: fuelTime(f.alternate) }, { label: "TOW/LW", value: `${tonnes(w.tow.planned)}/${tonnes(w.lw.planned)}`, ref: true }],
      [{ label: "FINAL/TIME", value: fuelTime(f.finalReserve) }, { label: "TRIP WIND", value: tripWind(b.route.avgWindKt) }],
      [{ label: "MIN DEST FOB", value: tonnes(f.mdf) }, { label: "EXTRA/TIME", value: `${tonnes(f.extra.kg ?? 0)}/${hhmm(f.extra.time ?? "0:00")}`, ref: true }],
    ],
  }
}
