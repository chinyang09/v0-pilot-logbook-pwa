/**
 * Import report watermarks.
 *
 * A schedule report and a Crew Logbook report are two INDEPENDENT streams, each
 * with its own "Generated on" stamp. Tracking a single newest-report timestamp
 * conflated them: importing a Jul-24 schedule after a Jul-25 logbook looked
 * "stale", and there was no way to tell whether a flight had ever been tallied
 * against the logbook at all.
 *
 * Two levels of tracking:
 *   - per flight  — `scheduleReportAt` / `logbookReportAt` on FlightLog, so we
 *     know which report version each flight reflects (and, for the logbook
 *     stamp, whether it has been tallied at all);
 *   - per device  — the watermarks here, so re-uploading an older file can be
 *     detected up front instead of silently re-tallying against stale data.
 */

import { getMetaValue, setMetaValue } from "@/lib/db/stores/user/sync-queue.store";
import type { FlightLog } from "@/types/entities/flight.types";

export type ReportSource = "schedule" | "logbook" | "cross_hydrated";

const WATERMARK_KEY = "importReportWatermarks";

export interface ReportWatermarks {
  /** "Generated on" epoch ms of the newest schedule report ever imported. */
  schedule?: number;
  /** "Generated on" epoch ms of the newest crew logbook report ever imported. */
  logbook?: number;
  /** When each was imported (epoch ms), for display. */
  scheduleImportedAt?: number;
  logbookImportedAt?: number;
}

export async function getReportWatermarks(): Promise<ReportWatermarks> {
  return (await getMetaValue<ReportWatermarks>(WATERMARK_KEY)) ?? {};
}

/**
 * Advance the watermark for a source. Never moves backwards — importing an
 * older file leaves the record of the newest one intact.
 */
export async function recordReportImport(
  source: ReportSource,
  generatedAt: number | null | undefined,
  now: number = Date.now()
): Promise<void> {
  if (!generatedAt) return;
  const current = await getReportWatermarks();
  const next: ReportWatermarks = { ...current };

  const bump = (key: "schedule" | "logbook") => {
    const prev = current[key];
    if (prev === undefined || generatedAt > prev) {
      next[key] = generatedAt;
      next[key === "schedule" ? "scheduleImportedAt" : "logbookImportedAt"] = now;
    }
  };

  if (source === "schedule" || source === "cross_hydrated") bump("schedule");
  if (source === "logbook" || source === "cross_hydrated") bump("logbook");

  await setMetaValue(WATERMARK_KEY, next);
}

/**
 * The stamp an incoming report is compared against for staleness.
 *
 * Schedule and Crew Logbook reports both come out of the same company system,
 * so their "Generated on" stamps are directly comparable: whichever is newest
 * represents the freshest company data this flight has seen, whatever kind of
 * report it arrived on. We therefore gate on the NEWEST stamp of either type
 * (falling back to the legacy single watermark for older rows).
 *
 * The two stamps are still recorded separately — `logbookReportAt` is what
 * tells us whether a flight has ever been tallied against the crew logbook.
 */
export function newestStamp(
  flight: Pick<
    FlightLog,
    "scheduleReportAt" | "logbookReportAt" | "reportGeneratedAt"
  >
): number | undefined {
  const candidates = [
    flight.scheduleReportAt,
    flight.logbookReportAt,
    flight.reportGeneratedAt,
  ].filter((v): v is number => typeof v === "number");
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

/** True when this flight has been tallied against a Crew Logbook report. */
export function hasBeenTallied(
  flight: Pick<FlightLog, "logbookReportAt">
): boolean {
  return typeof flight.logbookReportAt === "number";
}

/**
 * Which per-source stamps a report of `source` writes onto a flight.
 * A cross-hydrated import carries both streams, so it stamps both.
 */
export function stampsFor(
  source: ReportSource,
  scheduleGeneratedAt: number | null | undefined,
  logbookGeneratedAt: number | null | undefined
): Partial<Pick<FlightLog, "scheduleReportAt" | "logbookReportAt">> {
  const out: Partial<Pick<FlightLog, "scheduleReportAt" | "logbookReportAt">> = {};
  if ((source === "schedule" || source === "cross_hydrated") && scheduleGeneratedAt) {
    out.scheduleReportAt = scheduleGeneratedAt;
  }
  if ((source === "logbook" || source === "cross_hydrated") && logbookGeneratedAt) {
    out.logbookReportAt = logbookGeneratedAt;
  }
  return out;
}
