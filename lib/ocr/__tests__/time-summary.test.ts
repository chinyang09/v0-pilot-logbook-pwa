/**
 * EFB "Time Summary" OCR — the second screenshot format the camera import
 * understands, alongside the Airbus MCDU voyage report.
 *
 * Fixture is the real TGW216 record: a row per event with PLANNED and ACTUAL
 * columns, the actual carrying a date alongside the time, and a yellow delta
 * under each value that must never be mistaken for a time.
 */

import { describe, it, expect } from "vitest";
import { extractFlightData, type OcrResult } from "../oooi-extractor";

/** Build an OCR box at (x, y). Width/height are nominal — only geometry matters. */
function box(text: string, x: number, y: number): OcrResult {
  const w = Math.max(30, text.length * 12);
  const h = 24;
  return {
    text,
    confidence: 0.95,
    box: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}

const LABEL_X = 150;
const PLANNED_X = 680;
const ACTUAL_DATE_X = 1140;
const ACTUAL_TIME_X = 1300;
const DELTA_X = 1150;

/** The screenshot, as the OCR engine would report it. */
function timeSummaryScreenshot(): OcrResult[] {
  return [
    box("Time Summary", LABEL_X, 130),
    box("TYPE", LABEL_X, 240),
    box("PLANNED", PLANNED_X, 240),
    box("ACTUAL", ACTUAL_TIME_X, 240),

    box("Last Cabin Dr Clsd", LABEL_X, 330),
    box("27 Jul", ACTUAL_DATE_X, 330),
    box("01:20", ACTUAL_TIME_X, 330),

    box("Off Block", LABEL_X, 440),
    box("01:20 UTC", PLANNED_X, 440),
    box("27 Jul", ACTUAL_DATE_X, 440),
    box("01:25", ACTUAL_TIME_X, 440),
    box("+00:05", DELTA_X, 490),

    box("Taxi-out Time", LABEL_X, 550),
    box("10m", PLANNED_X, 550),
    box("18m", ACTUAL_TIME_X, 550),
    box("+00:08", DELTA_X, 598),

    box("Takeoff", LABEL_X, 655),
    box("01:30 UTC", PLANNED_X, 655),
    box("27 Jul", ACTUAL_DATE_X, 655),
    box("01:43", ACTUAL_TIME_X, 655),
    box("+00:13", DELTA_X, 705),

    box("Landing", LABEL_X, 760),
    box("04:53 UTC", PLANNED_X, 760),
    box("27 Jul", ACTUAL_DATE_X, 760),
    box("05:12", ACTUAL_TIME_X, 760),
    box("+00:19", DELTA_X, 812),

    box("On Block", LABEL_X, 868),
    box("05:03 UTC", PLANNED_X, 868),
    box("27 Jul", ACTUAL_DATE_X, 868),
    box("05:15", ACTUAL_TIME_X, 868),
    box("+00:12", DELTA_X, 918),

    box("Block Time", LABEL_X, 975),
    box("3h43m", PLANNED_X, 975),
    box("3h50m", ACTUAL_TIME_X, 975),
    box("+00:07", DELTA_X, 1025),

    box("Flight Time", LABEL_X, 1082),
    box("3h23m", PLANNED_X, 1082),
    box("3h29m", ACTUAL_TIME_X, 1082),
    box("+00:06", DELTA_X, 1132),
  ];
}

describe("Time Summary screenshot", () => {
  it("reads OUT / OFF / ON / IN from the ACTUAL column", () => {
    const data = extractFlightData(timeSummaryScreenshot());
    expect(data.outTime).toBe("01:25"); // Off Block
    expect(data.offTime).toBe("01:43"); // Takeoff
    expect(data.onTime).toBe("05:12"); // Landing
    expect(data.inTime).toBe("05:15"); // On Block
  });

  it("keeps the planned times separate from the actuals", () => {
    const data = extractFlightData(timeSummaryScreenshot());
    expect(data.scheduledOut).toBe("01:20");
    expect(data.scheduledIn).toBe("05:03");
  });

  it("reads the h/m durations", () => {
    const data = extractFlightData(timeSummaryScreenshot());
    expect(data.blockTime).toBe("03:50");
    expect(data.flightTime).toBe("03:29");
  });

  it("never mistakes a delta for a time", () => {
    const data = extractFlightData(timeSummaryScreenshot());
    for (const value of [
      data.outTime,
      data.offTime,
      data.onTime,
      data.inTime,
      data.scheduledOut,
      data.scheduledIn,
    ]) {
      expect(["00:05", "00:08", "00:13", "00:19", "00:12"]).not.toContain(value);
    }
  });

  it("is confident enough to hydrate the form", () => {
    const data = extractFlightData(timeSummaryScreenshot());
    expect(data.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("copes when the actual cell arrives as one merged box", () => {
    const merged = timeSummaryScreenshot().filter(
      (r) => r.text !== "27 Jul" && r.text !== "01:25"
    );
    merged.push(box("27 Jul  01:25", ACTUAL_DATE_X, 440));
    const data = extractFlightData(merged);
    expect(data.outTime).toBe("01:25");
  });

  it("still reads a crop with the header cut off", () => {
    const cropped = timeSummaryScreenshot().filter(
      (r) => !["Time Summary", "TYPE", "PLANNED", "ACTUAL"].includes(r.text)
    );
    const data = extractFlightData(cropped);
    expect(data.outTime).toBe("01:25");
    expect(data.inTime).toBe("05:15");
  });

  it("leaves the MCDU report working", () => {
    // The original layout: label row above value row, two columns.
    const mcdu: OcrResult[] = [
      box("DOOR CLS", 100, 100),
      box("OUT", 400, 100),
      box("0336", 100, 140),
      box("0340", 400, 140),
      box("IN", 100, 200),
      box("TAXI", 400, 200),
      box("0630", 100, 240),
      box("0345", 400, 240),
      box("ON", 100, 300),
      box("OFF", 400, 300),
      box("0626", 100, 340),
      box("0354", 400, 340),
    ];
    const data = extractFlightData(mcdu);
    expect(data.outTime).toBe("03:40");
    expect(data.offTime).toBe("03:54");
    expect(data.onTime).toBe("06:26");
    expect(data.inTime).toBe("06:30");
  });
});
