/**
 * Integration-style check — all three CSV formats produce the same UTC
 * output for the canonical 02/04/2026 BKK turn.
 */
import { describe, it, expect } from "vitest";
import { normalizeTimeToUTC } from "../time-reference-normalizer";

const SIN = "Asia/Singapore";
const BKK = "Asia/Bangkok";

describe("Three-format equivalence on real CSV fixture", () => {
  const ROW_DATE = "2026-04-02";

  // Expected UTC after normalization (from the UTC CSV itself):
  // OUT  04:49, IN  07:22  (SIN-BKK)
  // OUT  08:24, IN  10:56  (BKK-SIN)
  const EXPECTED = {
    sinBkkOut: { utcTime: "04:49", utcDate: ROW_DATE },
    sinBkkIn:  { utcTime: "07:22", utcDate: ROW_DATE },
    bkkSinOut: { utcTime: "08:24", utcDate: ROW_DATE },
    bkkSinIn:  { utcTime: "10:56", utcDate: ROW_DATE },
  };

  const cases = [
    { label: "UTC",            ref: "UTC" as const,
      sinBkkOut: "A04:49", sinBkkIn: "A07:22",
      bkkSinOut: "A08:24", bkkSinIn: "A10:56" },
    { label: "LOCAL_BASE",     ref: "LOCAL_BASE" as const,
      sinBkkOut: "A12:49", sinBkkIn: "A15:22",
      bkkSinOut: "A16:24", bkkSinIn: "A18:56" },
    { label: "LOCAL_STATION",  ref: "LOCAL_STATION" as const,
      sinBkkOut: "A12:49", sinBkkIn: "A14:22",
      bkkSinOut: "A15:24", bkkSinIn: "A18:56" },
  ];

  for (const c of cases) {
    it(`${c.label}: SIN→BKK OUT`, () => {
      expect(normalizeTimeToUTC({
        rawTime: c.sinBkkOut, rowDate: ROW_DATE, timeReference: c.ref,
        role: "out", depTz: SIN, arrTz: BKK, baseTz: SIN,
      })).toEqual(EXPECTED.sinBkkOut);
    });
    it(`${c.label}: SIN→BKK IN`, () => {
      expect(normalizeTimeToUTC({
        rawTime: c.sinBkkIn, rowDate: ROW_DATE, timeReference: c.ref,
        role: "in", depTz: SIN, arrTz: BKK, baseTz: SIN,
      })).toEqual(EXPECTED.sinBkkIn);
    });
    it(`${c.label}: BKK→SIN OUT`, () => {
      expect(normalizeTimeToUTC({
        rawTime: c.bkkSinOut, rowDate: ROW_DATE, timeReference: c.ref,
        role: "out", depTz: BKK, arrTz: SIN, baseTz: SIN,
      })).toEqual(EXPECTED.bkkSinOut);
    });
    it(`${c.label}: BKK→SIN IN`, () => {
      expect(normalizeTimeToUTC({
        rawTime: c.bkkSinIn, rowDate: ROW_DATE, timeReference: c.ref,
        role: "in", depTz: BKK, arrTz: SIN, baseTz: SIN,
      })).toEqual(EXPECTED.bkkSinIn);
    });
  }
});
