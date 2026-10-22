/**
 * One crew card per person when a schedule and a crew logbook are imported
 * together. The plain concatenation of both parsers' new cards gave a captain
 * new to both reports two cards — the logbook's truncated one and the
 * schedule's full one.
 */

import { describe, it, expect } from "vitest";
import { mergeImportPersonnel } from "../cross-hydrate";
import type { ParsedSector } from "@/lib/utils/roster/reconciler";
import type { Personnel } from "@/types/entities/crew.types";

const card = (id: string, name: string): Personnel => ({
  id,
  name,
  createdAt: 0,
  syncStatus: "pending",
});

const sector = (overrides: Partial<ParsedSector>): ParsedSector =>
  ({
    date: "2026-07-22",
    flightNumber: "TR466",
    aircraftType: "A21N",
    departureIata: "SIN",
    arrivalIata: "CAN",
    ...overrides,
  }) as ParsedSector;

describe("mergeImportPersonnel", () => {
  it("drops the logbook's truncated card in favour of the schedule's full one", () => {
    const schedule = [card("s1", "Siah Yang Tek, Timothy")];
    const logbook = [card("l1", "Siah Yang Tek,")];
    // An UNMATCHED logbook sector (no schedule crew) still points at l1.
    const out = mergeImportPersonnel(
      [sector({ picPersonnelId: "l1", picResolvedName: "Siah Yang Tek," })],
      schedule,
      logbook
    );
    expect(out.personnelToCreate.map((p) => p.id)).toEqual(["s1"]);
    expect(out.sectors[0].picPersonnelId).toBe("s1");
    expect(out.sectors[0].picResolvedName).toBe("Siah Yang Tek, Timothy");
  });

  it("drops a logbook card only a schedule-crewed sector carried", () => {
    // The merged sector takes its captain from the schedule's crew, so the
    // logbook PIC id on it is never written and its card would be an orphan.
    const out = mergeImportPersonnel(
      [
        sector({
          picPersonnelId: "l1",
          crew: [{ role: "CPT", name: "Ng Tze Yang", crewId: "1234", personnelId: "existing" }],
        }),
      ],
      [],
      [card("l1", "Ng Tze Yang")]
    );
    expect(out.personnelToCreate).toEqual([]);
  });

  it("keeps a logbook card an unmatched sector needs", () => {
    const out = mergeImportPersonnel(
      [sector({ picPersonnelId: "l1", picResolvedName: "Kee Khiok Wei Kenneth" })],
      [card("s1", "Somebody Else Entirely")],
      [card("l1", "Kee Khiok Wei Kenneth")]
    );
    expect(out.personnelToCreate.map((p) => p.id).sort()).toEqual(["l1", "s1"]);
    expect(out.sectors[0].picPersonnelId).toBe("l1");
  });
});
