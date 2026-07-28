import { describe, it, expect } from "vitest";
import { parseTrainingDetails } from "../shared/training-details";

// Representative of the "Training Details" section as text-extracted from a
// Scoot Personal Crew Schedule Report PDF (May 2026, EBT sessions).
const SAMPLE = `Training Details
Date Time Duty Crew Course Name Course Component Facility
Name: AATC SIM B
Location: SIN
2269 -- Anthony Gunawan -- Instructor Addresses: Airbus Asia
2576 -- Theunis Christoffel Botha Prins -- Instr under Supervision *A320 EBT Cycle6 (May Training Centre (AATC)
14/05/2026 0515 - 1115 SMCK EBT6 D1 SMCK EBT6 D1
9766 -- Lim Chin Yang -- Trainee 14) 12 Seletar Aerospace
10082 -- Tay Kiat Chun -- Trainee Crescent
Singapore 797566
Phones:
Name: HAITE SIM 020
7308 -- Jason Sanjay S/O Edward Matharajan -- Instructor Location: SIN
*A320 EBT Cycle6 (May
20/05/2026 1530 - 2130 SMCK EBT6 D1 5502 -- Jagathesan S/O Selvanathan -- Support Crew as FO SMCK EBT6 D1 Addresses: 15 Changi
20)
9766 -- Lim Chin Yang -- Trainee Business Park Cres
Phones:
Name: AATC SIM A
Location: SIN
Addresses: Airbus Asia
2368 -- Jose Maria Galdo Alvarez -- Instructor
*A320 EBT Cycle6 (May Training Centre (AATC)
21/05/2026 1725 - 2325 SMTR EBT6 D2 9766 -- Lim Chin Yang -- Trainee SMTR EBT6 D2
20) 12 Seletar Aerospace
9770 -- Daryl Pravin Naidu -- Support Crew as FO
Crescent
Singapore 797566
Phones:
Descriptions
Duty Codes Indicators`;

describe("parseTrainingDetails", () => {
  const map = parseTrainingDetails(SAMPLE);

  it("finds all three sim sessions by date", () => {
    expect(map.size).toBe(3);
    expect(map.has("2026-05-14")).toBe(true);
    expect(map.has("2026-05-20")).toBe(true);
    expect(map.has("2026-05-21")).toBe(true);
  });

  it("extracts time, component, course, facility, instructor for 14 May", () => {
    const e = map.get("2026-05-14")!;
    expect(e.startLocal).toBe("05:15");
    expect(e.endLocal).toBe("11:15");
    expect(e.component).toBe("SMCK EBT6 D1");
    expect(e.deviceType).toBe("A320");
    expect(e.courseName).toContain("A320 EBT Cycle6");
    expect(e.facility).toBe("AATC SIM B");
    expect(e.instructorName).toBe("Anthony Gunawan");
  });

  it("handles a facility with digits + appended Location (20 May)", () => {
    const e = map.get("2026-05-20")!;
    expect(e.startLocal).toBe("15:30");
    expect(e.endLocal).toBe("21:30");
    expect(e.facility).toBe("HAITE SIM 020");
    expect(e.instructorName).toBe("Jason Sanjay S/O Edward Matharajan");
  });

  it("extracts the D2 component (21 May)", () => {
    const e = map.get("2026-05-21")!;
    expect(e.component).toBe("SMTR EBT6 D2");
    expect(e.facility).toBe("AATC SIM A");
    expect(e.instructorName).toBe("Jose Maria Galdo Alvarez");
  });
});
