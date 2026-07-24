/**
 * Tests for the schedule Crew-column parser, focusing on the PDF
 * name-wrapping case (long names spill onto a second line).
 */

import { describe, it, expect } from "vitest";
import { parseCrewColumn, isSimulatorDuty } from "../schedule-parser";

describe("isSimulatorDuty", () => {
  it("classifies EBT duty codes as simulator", () => {
    expect(isSimulatorDuty("EBT1", "EBT Day 1")).toBe(true);
    expect(isSimulatorDuty("EBT2", "EBT Day 2")).toBe(true);
  });
  it("classifies OPC/LPC/LOFT as simulator", () => {
    expect(isSimulatorDuty("OPC", "OPC 320")).toBe(true);
    expect(isSimulatorDuty("LPC", "")).toBe(true);
    expect(isSimulatorDuty("LOFT", "")).toBe(true);
  });
  it("does NOT classify standby / leave / off as simulator", () => {
    expect(isSimulatorDuty("SBYC", "TC SBY C: 0600L - 1800L")).toBe(false);
    expect(isSimulatorDuty("LOFF", "Local Day Off for Tech Crew")).toBe(false);
    expect(isSimulatorDuty("PSL", "Paid Sick Leave")).toBe(false);
    expect(isSimulatorDuty("WSL", "Wellness Leave")).toBe(false);
    expect(isSimulatorDuty("BKUP", "Backup")).toBe(false);
  });
});

describe("parseCrewColumn", () => {
  it("parses single-line CPT + FO", () => {
    const cell = [
      "CPT - PIC - 2644 - Prorok Andriy",
      "FO - 9766 - Lim Chin Yang",
      "CC - 3095 - Tan Shi Yun",
    ].join("\n");
    const crew = parseCrewColumn(cell);
    expect(crew).toHaveLength(2); // cabin crew (CC) not tracked
    expect(crew[0]).toMatchObject({ role: "CPT", crewId: "2644", name: "Prorok Andriy" });
    expect(crew[1]).toMatchObject({ role: "FO", crewId: "9766", name: "Lim Chin Yang" });
  });

  it("joins a captain name wrapped across two lines", () => {
    const cell = [
      "CPT - PIC - 6409 - Siah Yang Tek,",
      "Timothy",
      "FO - 9766 - Lim Chin Yang",
    ].join("\n");
    const crew = parseCrewColumn(cell);
    expect(crew[0]).toMatchObject({
      role: "CPT",
      crewId: "6409",
      name: "Siah Yang Tek, Timothy",
    });
    expect(crew[1]).toMatchObject({ role: "FO", name: "Lim Chin Yang" });
  });

  it("handles S/O names wrapped across two lines", () => {
    const cell = [
      "CPT - PIC - 6636 - Rajarajeshwaran S/O",
      "Sandararajan",
      "FO - 9766 - Lim Chin Yang",
    ].join("\n");
    const crew = parseCrewColumn(cell);
    expect(crew[0].name).toBe("Rajarajeshwaran S/O Sandararajan");
  });

  it("does not let a wrapped cabin-crew name bleed onto the previous pilot", () => {
    const cell = [
      "FO - 9766 - Lim Chin Yang",
      "CC - 9966 - Camelia Shome Binte",
      "Nuranis Shome",
    ].join("\n");
    const crew = parseCrewColumn(cell);
    // Only the FO is tracked; its name must stay clean.
    expect(crew).toHaveLength(1);
    expect(crew[0].name).toBe("Lim Chin Yang");
  });

  it("handles an 'Eugene'-style wrapped captain followed by FO", () => {
    const cell = [
      "CPT - PIC - 8187 - Khong Hui Gin",
      "Eugene",
      "FO - 9766 - Lim Chin Yang",
    ].join("\n");
    const crew = parseCrewColumn(cell);
    expect(crew[0].name).toBe("Khong Hui Gin Eugene");
  });
});
