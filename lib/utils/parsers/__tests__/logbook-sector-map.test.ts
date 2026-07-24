/**
 * Tests for the shared logbook-sector -> ParsedSector mapper, focusing on the
 * flown-vs-planned routing that stops future roster legs being hydrated as if
 * they were flown.
 */

import { describe, it, expect } from "vitest";
import { logbookSectorToParsedSector } from "../cross-hydrate";
import type { ParsedLogbookSector } from "../logbook-parser-v2";

function makeLogSector(
  overrides: Partial<ParsedLogbookSector> = {}
): ParsedLogbookSector {
  return {
    date: "2026-08-15",
    aircraftReg: "9V-TNK",
    aircraftType: "A20N",
    departureIata: "SIN",
    arrivalIata: "HAK",
    outTime: "23:00",
    inTime: "02:40",
    blockTime: "03:40",
    picRawName: "Khor Yong Kok",
    isUserPic: false,
    picPersonnelId: "p1",
    picResolvedName: "Khor Yong Kok",
    dayTakeoffs: 0,
    nightTakeoffs: 0,
    dayLandings: 0,
    nightLandings: 0,
    isPilotFlying: false,
    planned: false,
    remarks: "",
    sourceLine: 1,
    ...overrides,
  };
}

describe("logbookSectorToParsedSector", () => {
  it("maps a FLOWN sector to actual times + block", () => {
    const s = logbookSectorToParsedSector(makeLogSector({ planned: false }));
    expect(s.actualOut).toBe("23:00");
    expect(s.actualIn).toBe("02:40");
    expect(s.scheduledOut).toBeUndefined();
    expect(s.scheduledIn).toBeUndefined();
    expect(s.blockTime).toBe("03:40");
  });

  it("maps a PLANNED (future) sector to scheduled times, no actuals/block/PF", () => {
    const s = logbookSectorToParsedSector(
      makeLogSector({ planned: true, isPilotFlying: false })
    );
    expect(s.scheduledOut).toBe("23:00");
    expect(s.scheduledIn).toBe("02:40");
    expect(s.actualOut).toBeUndefined();
    expect(s.actualIn).toBeUndefined();
    // Not flown yet: no block hours, pilot-flying unknown.
    expect(s.blockTime).toBe("00:00");
    expect(s.isPilotFlying).toBeUndefined();
  });

  it("carries reg, type, route, and crew-resolution fields through", () => {
    const s = logbookSectorToParsedSector(makeLogSector({ planned: true }));
    expect(s.aircraftReg).toBe("9V-TNK");
    expect(s.aircraftType).toBe("A20N");
    expect(s.departureIata).toBe("SIN");
    expect(s.arrivalIata).toBe("HAK");
    expect(s.picResolvedName).toBe("Khor Yong Kok");
  });
});
