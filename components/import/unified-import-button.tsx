/**
 * Unified import entry point — accepts CSV/PDF for both Crew Logbook Report
 * and Personal Crew Schedule Report. When both are dropped together, runs
 * cross-hydration so logbook actuals + aircraft regs merge with schedule
 * crew + flight numbers in a single import.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import {
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { extractDocuments } from "@/lib/utils/parsers/extractors";
import {
  parseScheduleCSV,
  type PlannedImport,
} from "@/lib/utils/parsers/schedule-parser";
import { parseLogbookV2 } from "@/lib/utils/parsers/logbook-parser-v2";
import { crossHydrate } from "@/lib/utils/parsers/cross-hydrate";
import { reconcileRoster } from "@/lib/utils/roster/reconciler";
import {
  executeRosterImport,
  type ExecutionResult,
} from "@/lib/utils/roster/executor";
import { userDb } from "@/lib/db";
import type { FlightLog } from "@/types/entities/flight.types";
import { ImportReviewModalV2 } from "./import-review-modal-v2";
import { DetectedFilesChip } from "./detected-files-chip";

interface Props {
  /** Where the button is mounted — affects success-message wording. */
  context?: "logbook" | "roster" | "shared";
  /** Triggered after a successful execution so the page can refresh. */
  onComplete?: () => void;
}

interface Stage {
  percent: number;
  stage: string;
  detail?: string;
}

export function UnifiedImportButton({ context = "shared", onComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Stage | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PlannedImport | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const simSessionsRef = useRef<
    NonNullable<
      Parameters<typeof executeRosterImport>[1]
    >["simSessions"]
  >([]);
  const importSourceRef = useRef<FlightLog["importSource"]>("schedule");

  const reset = () => {
    setProgress(null);
    setPendingPlan(null);
    setShowReview(false);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleExecute = useCallback(
    async (plan: PlannedImport) => {
      setBusy(true);
      setProgress({ percent: 90, stage: "Applying", detail: "Writing changes..." });
      try {
        const result: ExecutionResult = await executeRosterImport(plan, {
          simSessions: simSessionsRef.current ?? [],
          importSource: importSourceRef.current,
        });
        const parts: string[] = [];
        if (result.created) parts.push(`${result.created} created`);
        if (result.updated) parts.push(`${result.updated} updated`);
        if (result.deleted) parts.push(`${result.deleted} deleted`);
        if (result.simSessionsCreated)
          parts.push(`${result.simSessionsCreated} sim sessions`);
        if (result.staleSkipped)
          parts.push(`${result.staleSkipped} skipped (older report)`);
        if (result.identical) parts.push(`${result.identical} unchanged`);
        if (result.errors.length)
          parts.push(`${result.errors.length} error(s)`);
        setSummary(parts.join(", ") || "No changes applied");
        setErrorMsg(null);
        onComplete?.();
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : "Import failed");
      } finally {
        setProgress(null);
        setIsOpen(false);
        setShowReview(false);
        setBusy(false);
      }
    },
    [onComplete]
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      setSummary(null);
      setErrorMsg(null);
      setIsOpen(true);
      setBusy(true);
      setProgress({ percent: 5, stage: "Reading", detail: `${files.length} file(s)` });

      try {
        const docs = await extractDocuments(files);

        const logbooks = docs.filter((d) => d.reportType === "logbook");
        const schedules = docs.filter((d) => d.reportType === "schedule");
        const unknowns = docs.filter((d) => d.reportType === "unknown");

        if (unknowns.length > 0) {
          throw new Error(
            `Could not detect report type for: ${unknowns.map((u) => u.fileName).join(", ")}`
          );
        }
        if (logbooks.length > 1 || schedules.length > 1) {
          throw new Error(
            "Merging two files of the same kind is not supported — import them separately."
          );
        }
        if (logbooks.length === 0 && schedules.length === 0) {
          throw new Error("No recognized report in selected files.");
        }

        const onParseProgress = (
          percent: number,
          stage: string,
          detail?: string
        ) => {
          // Squash parser progress into 10-70%.
          setProgress({
            percent: 10 + Math.floor(percent * 0.6),
            stage,
            detail,
          });
        };

        let plan: PlannedImport;
        let simSessions: NonNullable<
          Parameters<typeof executeRosterImport>[1]
        >["simSessions"] = [];
        let importSource: FlightLog["importSource"] = "schedule";

        if (logbooks.length === 1 && schedules.length === 1) {
          // Combined flow.
          importSource = "cross_hydrated";
          setProgress({
            percent: 12,
            stage: "Parsing",
            detail: "Logbook + Schedule",
          });

          const logbookPlan = await parseLogbookV2(logbooks[0], {
            onProgress: onParseProgress,
          });
          simSessions = logbookPlan.simSessions;

          const schedulePlan = await parseScheduleCSV(schedules[0], {
            onProgress: (p, s, d) =>
              onParseProgress(50 + Math.floor(p * 0.4), s, d),
          });

          // Cross-hydrate.
          setProgress({
            percent: 80,
            stage: "Merging",
            detail: "Hydrating logbook actuals into schedule rows...",
          });
          const merged = crossHydrate(logbookPlan, schedulePlan);

          // Re-reconcile against full DB using merged sectors and the report
          // generation timestamp from whichever side has it (prefer logbook
          // since it's the authoritative actuals).
          const reportGeneratedAt =
            logbookPlan.generatedAt ?? schedulePlan.generatedAt;

          const dateRange = {
            start:
              logbookPlan.dateRange.start &&
              logbookPlan.dateRange.start < schedulePlan.dateRange.start
                ? logbookPlan.dateRange.start
                : schedulePlan.dateRange.start || logbookPlan.dateRange.start,
            end:
              logbookPlan.dateRange.end >
              schedulePlan.dateRange.end
                ? logbookPlan.dateRange.end
                : schedulePlan.dateRange.end || logbookPlan.dateRange.end,
          };

          const allFlights = await userDb.flights.toArray();
          const flightsInRange = allFlights.filter(
            (f) => f.date >= dateRange.start && f.date <= dateRange.end
          );

          const operations = reconcileRoster({
            sectors: merged.sectors,
            existingFlights: flightsInRange,
            csvDateRange: dateRange,
            reportGeneratedAt,
            useLegacyUpdateConflict: false,
          });

          plan = {
            ...schedulePlan,
            generatedAt: reportGeneratedAt ?? null,
            dateRange,
            operations: operations.map((op) => ({
              ...op,
              accepted:
                op.kind === "create" ||
                op.kind === "skip_identical" ||
                op.kind === "skip_non_airline" ||
                op.kind === "skip_stale_report" ||
                op.kind === "update_safe",
            })),
            personnelToCreate: [
              ...schedulePlan.personnelToCreate,
              ...logbookPlan.personnelToCreate,
            ],
            errors: [...schedulePlan.errors, ...logbookPlan.errors],
            warnings: [...schedulePlan.warnings, ...logbookPlan.warnings],
            summary: {
              toCreate: 0,
              toUpdate: 0,
              toDelete: 0,
              identical: 0,
              ignored: 0,
              staleSkipped: 0,
            },
          };

          for (const op of plan.operations) {
            switch (op.kind) {
              case "create":
                plan.summary.toCreate++;
                break;
              case "update_conflict":
              case "edited_conflict":
              case "update_safe":
              case "update_consult":
                plan.summary.toUpdate++;
                break;
              case "delete_missing":
                plan.summary.toDelete++;
                break;
              case "skip_identical":
                plan.summary.identical++;
                break;
              case "skip_non_airline":
                plan.summary.ignored++;
                break;
              case "skip_stale_report":
                plan.summary.staleSkipped++;
                break;
            }
          }
        } else if (logbooks.length === 1) {
          importSource = "logbook";
          setProgress({ percent: 15, stage: "Parsing", detail: "Logbook" });
          const logbookPlan = await parseLogbookV2(logbooks[0], {
            onProgress: onParseProgress,
          });
          simSessions = logbookPlan.simSessions;

          // Wrap logbook sectors as ParsedSector (they already extend it).
          const sectors = logbookPlan.sectors.map((s) => ({
            date: s.date,
            flightNumber: s.flightNumber ?? "",
            aircraftType: s.aircraftType,
            departureIata: s.departureIata,
            arrivalIata: s.arrivalIata,
            scheduledOut: undefined,
            scheduledIn: undefined,
            actualOut: s.outTime,
            actualIn: s.inTime,
            sourceLine: s.sourceLine,
            crew: undefined,
            aircraftReg: s.aircraftReg,
            dayTakeoffs: s.dayTakeoffs,
            nightTakeoffs: s.nightTakeoffs,
            dayLandings: s.dayLandings,
            nightLandings: s.nightLandings,
            blockTime: s.blockTime,
            picRawName: s.picRawName,
            isUserPic: s.isUserPic,
            picPersonnelId: s.picPersonnelId,
            picResolvedName: s.picResolvedName,
            isPilotFlying: s.isPilotFlying,
            // Sun-position suggestion + day/night cutoff context — must be
            // carried through so the reconciler can annotate TO/LDG diffs
            // and the modal can render the day/night check.
            suggestedDayTakeoffs: s.suggestedDayTakeoffs,
            suggestedNightTakeoffs: s.suggestedNightTakeoffs,
            suggestedDayLandings: s.suggestedDayLandings,
            suggestedNightLandings: s.suggestedNightLandings,
            toLdgContext: s.toLdgContext,
            remarks: s.remarks,
          }));

          const allFlights = await userDb.flights.toArray();
          const flightsInRange = allFlights.filter(
            (f) =>
              f.date >= logbookPlan.dateRange.start &&
              f.date <= logbookPlan.dateRange.end
          );
          const operations = reconcileRoster({
            sectors,
            existingFlights: flightsInRange,
            csvDateRange: logbookPlan.dateRange,
            reportGeneratedAt: logbookPlan.generatedAt,
            useLegacyUpdateConflict: false,
          });

          plan = {
            success: logbookPlan.success,
            timeReference: "UTC",
            dateRange: logbookPlan.dateRange,
            generatedAt: logbookPlan.generatedAt,
            crewMember: { crewId: "", name: "", base: "", role: "", aircraftType: "" },
            operations: operations.map((op) => ({
              ...op,
              accepted:
                op.kind === "create" ||
                op.kind === "skip_identical" ||
                op.kind === "skip_non_airline" ||
                op.kind === "skip_stale_report" ||
                op.kind === "update_safe",
            })),
            currencies: [],
            personnelToCreate: logbookPlan.personnelToCreate,
            personnelToUpdate: [],
            errors: logbookPlan.errors,
            warnings: logbookPlan.warnings,
            summary: {
              toCreate: 0,
              toUpdate: 0,
              toDelete: 0,
              identical: 0,
              ignored: 0,
              staleSkipped: 0,
            },
          };

          for (const op of plan.operations) {
            switch (op.kind) {
              case "create":
                plan.summary.toCreate++;
                break;
              case "update_conflict":
              case "edited_conflict":
              case "update_safe":
              case "update_consult":
                plan.summary.toUpdate++;
                break;
              case "delete_missing":
                plan.summary.toDelete++;
                break;
              case "skip_identical":
                plan.summary.identical++;
                break;
              case "skip_non_airline":
                plan.summary.ignored++;
                break;
              case "skip_stale_report":
                plan.summary.staleSkipped++;
                break;
            }
          }
        } else {
          // Schedule-only path.
          importSource = "schedule";
          setProgress({ percent: 15, stage: "Parsing", detail: "Schedule" });
          plan = await parseScheduleCSV(schedules[0], {
            onProgress: onParseProgress,
          });
        }

        if (!plan.success && plan.errors.length > 0) {
          throw new Error(plan.errors[0].message);
        }

        simSessionsRef.current = simSessions;
        importSourceRef.current = importSource;

        const needsReview =
          plan.summary.toUpdate > 0 ||
          plan.summary.toDelete > 0 ||
          plan.operations.some(
            (op) =>
              op.kind === "edited_conflict" || op.kind === "update_consult"
          );

        if (!needsReview) {
          setPendingPlan(plan);
          await handleExecute(plan);
        } else {
          setPendingPlan(plan);
          setShowReview(true);
          setProgress(null);
        }
      } catch (error) {
        setErrorMsg(
          error instanceof Error ? error.message : "Unknown import error"
        );
        setProgress(null);
      } finally {
        setBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [handleExecute]
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    handleFiles(files);
  };

  const onDialogChange = (open: boolean) => {
    if (!open && !showReview && !busy) {
      setIsOpen(false);
      reset();
    }
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".csv,.pdf"
        multiple
        onChange={onChange}
      />

      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-label="Import files"
        className="h-12 w-12 rounded-full"
        onClick={() => fileInputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Upload className="h-5 w-5" />
        )}
      </Button>

      <Dialog
        open={isOpen && !showReview}
        onOpenChange={onDialogChange}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {progress
                ? "Importing"
                : errorMsg
                  ? "Import Failed"
                  : summary
                    ? "Import Complete"
                    : "Import"}
            </DialogTitle>
            <DialogDescription>
              {progress?.stage || (errorMsg ? "" : summary || "")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {progress && (
              <>
                <Progress value={progress.percent} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{progress.detail}</span>
                  <span>{progress.percent}%</span>
                </div>
              </>
            )}
            {errorMsg && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            {summary && !errorMsg && !progress && (
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-status-valid" />
                <span>{summary}</span>
              </div>
            )}
            {context && progress && (
              <p className="text-[11px] text-muted-foreground">
                Context: {context}
              </p>
            )}
          </div>

          {(errorMsg || (summary && !progress)) && (
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => {
                  setIsOpen(false);
                  setSummary(null);
                  setErrorMsg(null);
                }}
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ImportReviewModalV2
        plan={pendingPlan}
        isOpen={showReview}
        onConfirm={(updatedPlan) => {
          setShowReview(false);
          handleExecute(updatedPlan);
        }}
        onCancel={() => {
          setShowReview(false);
          setPendingPlan(null);
          setSummary("Import cancelled");
          setIsOpen(false);
        }}
      />

      {/* Suppress unused-import warnings while keeping these available for
          future inline filename chip rendering. */}
      <span className="hidden">
        <AlertTriangle />
        <DetectedFilesChip files={[]} />
      </span>
    </>
  );
}
