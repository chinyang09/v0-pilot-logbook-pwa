/**
 * The report-totals cross-check, against what this device now stores: run
 * once an import has been written, so the comparison reads the logbook the
 * import produced, through the same FDP pipeline the app reads duty from.
 */

import { getAllFlights, getAllScheduleEntries } from "@/lib/db"
import { runFDPPipeline } from "@/lib/utils/roster/fdp-pipeline"
import {
  compareReportTotals,
  logbookTotals,
  type ReportTotals,
  type TotalsComparison,
} from "@/lib/utils/roster/report-totals"

export interface ReportTotalsCheck extends TotalsComparison {
  /** When the report was generated — after it, its figures are the plan. */
  generatedAt: number | null
  range: { start: string; end: string }
}

export async function checkReportTotals(
  report: ReportTotals,
  range: { start: string; end: string },
  generatedAt: number | null,
): Promise<ReportTotalsCheck> {
  const [flights, scheduleEntries] = await Promise.all([getAllFlights(), getAllScheduleEntries()])
  // The roster holds non-flight duties only, so no airport offsets are needed.
  const fdp = runFDPPipeline(flights, scheduleEntries, new Map(), Date.now())
  const ours = logbookTotals({ flights, scheduleEntries, dutyPeriods: fdp.allDutyPeriods, range })
  return { ...compareReportTotals(report, ours), generatedAt, range }
}
