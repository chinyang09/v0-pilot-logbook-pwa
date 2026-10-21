/**
 * Flights pointing at crew cards or fleet records nobody holds. Both shapes
 * came out of production: 24 crew seats named a card that only ever existed
 * on the importing device, and 9 flown registrations had no fleet record.
 */

import { describe, it, expect } from "vitest";
import { crewReferenceRepairs, missingFleetRegistrations } from "../record-references";
import type { FlightLog } from "@/types/entities/flight.types";

const flight = (id: string, overrides: Partial<FlightLog>): FlightLog =>
  ({
    id,
    picId: "",
    picName: "",
    sicId: "",
    sicName: "",
    additionalCrew: [],
    aircraftReg: "",
    aircraftType: "",
    deletedAt: null,
    ...overrides,
  }) as FlightLog;

const SELF = "self";

describe("crewReferenceRepairs", () => {
  it("repoints a dangling seat to a live card for the same person, taking the fuller name", () => {
    const { flightPatches, cardsToCreate } = crewReferenceRepairs(
      [flight("f1", { picId: "gone", picName: "Siah Yang Tek,", sicId: SELF, sicName: "Self" })],
      [{ id: "full", name: "Siah Yang Tek, Timothy", deletedAt: null }],
      SELF
    );
    expect(cardsToCreate).toEqual([]);
    expect(flightPatches.get("f1")).toEqual({ picId: "full", picName: "Siah Yang Tek, Timothy" });
  });

  it("creates the card under the id the flights carry when nobody matches", () => {
    const { flightPatches, cardsToCreate } = crewReferenceRepairs(
      [
        flight("f1", { picId: "x", picName: "Toh Wee Tiong" }),
        flight("f2", { picId: "x", picName: "Toh Wee Tiong" }),
      ],
      [],
      SELF
    );
    expect(cardsToCreate.map((c) => [c.id, c.name, c.roles])).toEqual([["x", "Toh Wee Tiong", ["PIC"]]]);
    // The flights already point at "x" — nothing to rewrite.
    expect(flightPatches.size).toBe(0);
  });

  it("folds a second orphaned id for the same person into the first", () => {
    const { flightPatches, cardsToCreate } = crewReferenceRepairs(
      [
        flight("f1", { picId: "a", picName: "Ng Tze Yang" }),
        flight("f2", { picId: "b", picName: "Ng Tze Yang" }),
      ],
      [],
      SELF
    );
    expect(cardsToCreate.map((c) => c.id)).toEqual(["a"]);
    expect(flightPatches.get("f2")).toEqual({ picId: "a" });
  });

  it("leaves the pilot's own seat, a binned card, a binned flight and an empty seat alone", () => {
    const { flightPatches, cardsToCreate } = crewReferenceRepairs(
      [
        flight("f1", { picId: SELF, picName: "Self", sicId: "binned", sicName: "Someone" }),
        flight("f2", { picId: "gone", picName: "Self" }),
        flight("f3", { picId: "gone2", picName: "Real Name", deletedAt: 5 }),
        flight("f4", { picId: "", picName: "Typed Only" }),
      ],
      [{ id: "binned", name: "Someone", deletedAt: 1 }],
      SELF
    );
    expect(cardsToCreate).toEqual([]);
    expect(flightPatches.size).toBe(0);
  });

  it("repairs additional crew by id", () => {
    const { flightPatches } = crewReferenceRepairs(
      [flight("f1", { additionalCrew: [{ id: "gone", name: "Lee Huishun", role: "Observer" }] })],
      [{ id: "live", name: "Lee Huishun Ian", deletedAt: null }],
      SELF
    );
    expect(flightPatches.get("f1")).toEqual({
      additionalCrew: [{ id: "live", name: "Lee Huishun Ian", role: "Observer" }],
    });
  });
});

describe("missingFleetRegistrations", () => {
  it("lists flown registrations with no fleet record, with their usual type", () => {
    const out = missingFleetRegistrations(
      [
        flight("f1", { aircraftReg: "9V-TRT", aircraftType: "A320" }),
        flight("f2", { aircraftReg: "9v-trt", aircraftType: "A320" }),
        flight("f3", { aircraftReg: "9V-TRT", aircraftType: "" }),
        flight("f4", { aircraftReg: "9V-NCA", aircraftType: "A21N" }),
        flight("f5", { aircraftReg: "9V-OLD", aircraftType: "A320", deletedAt: 9 }),
        flight("sim", { aircraftReg: "" }),
      ],
      [{ registration: "9V-NCA", deletedAt: null }]
    );
    expect(out).toEqual([{ reg: "9V-TRT", type: "A320" }]);
  });

  it("treats a binned fleet record as held", () => {
    expect(
      missingFleetRegistrations([flight("f1", { aircraftReg: "9V-SKU", aircraftType: "A388" })], [
        { registration: "9V-SKU", deletedAt: 1 },
      ])
    ).toEqual([]);
  });
});
