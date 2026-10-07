/**
 * Unified import entry point.
 *
 * Two families of file arrive through the same button, because from the
 * pilot's side there is only one thing happening — they are putting a file
 * into their logbook — and a second button in this header would grow the
 * action group into the centred nav pill:
 *
 *  - **eCrew** (CSV/PDF): Crew Logbook Report and Personal Crew Schedule
 *    Report, the recurring import. Dropped together they cross-hydrate, so
 *    logbook actuals + aircraft regs merge with schedule crew + flight
 *    numbers in one pass.
 *  - **LogTen Pro** (tab-separated .txt): a one-time migration from another
 *    logbook app, up to three files (Flights, Aircraft, Address Book) that
 *    feed each other. This routes to its own parser and its own review
 *    dialog — see `lib/utils/parsers/logten`.
 *
 * Which family a file belongs to is decided by `detectReportType`, not by the
 * user picking a mode.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractDocuments } from "@/lib/utils/parsers/extractors";
import { isLogtenKind } from "@/lib/utils/parsers/detect";
import {
  executeLogtenImport,
  parseLogtenExport,
  type LogtenImportPlan,
  type LogtenTimeReference,
} from "@/lib/utils/parsers/logten";
import { LogtenReviewDialog } from "./logten-review-dialog";
import {
  parseScheduleCSV,
  type PlannedImport,
} from "@/lib/utils/parsers/schedule-parser";
import { parseLogbookV2 } from "@/lib/utils/parsers/logbook-parser-v2";
import {
  crossHydrate,
  logbookSectorToParsedSector,
} from "@/lib/utils/parsers/cross-hydrate";
import { reconcileRoster } from "@/lib/utils/roster/reconciler";
import {
  flightMatchWindow,
  inWindow,
  sectorDates,
} from "@/lib/utils/roster/flight-window";
import {
  executeRosterImport,
  type ExecutionResult,
} from "@/lib/utils/roster/executor";
import {
  applyDefaultAcceptance,
  summarizeOperations,
} from "@/lib/utils/roster/plan-summary";
import {
  userDb,
  isLiveFlight,
  getCurrentUserPersonnel,
  getUserPreferences,
  DEFAULT_IMPORT_DEFAULTS,
} from "@/lib/db";
import type { FlightLog } from "@/types/entities/flight.types";
import type { NormalizedDocument } from "@/lib/utils/parsers/types";
import { ImportReviewModalV2 } from "./import-review-modal-v2";
import { ImportStatusDialog, type ImportStage } from "./import-status-dialog";

interface Props {
  /** Where the button is mounted — affects success-message wording. */
  context?: "logbook" | "roster" | "shared";
  /** Triggered after a successful execution so the page can refresh. */
  onComplete?: () => void;
}

export function UnifiedImportButton({ context = "shared", onComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ImportStage | null>(null);
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
  // Per-stream "Generated on" stamps, so the executor can record which report
  // version each flight reflects (schedule vs logbook are tracked separately).
  const reportStampsRef = useRef<{
    scheduleGeneratedAt: number | null;
    logbookGeneratedAt: number | null;
  }>({ scheduleGeneratedAt: null, logbookGeneratedAt: null });

  // ---- LogTen migration state ----
  const [logtenPlan, setLogtenPlan] = useState<LogtenImportPlan | null>(null);
  const [showLogtenReview, setShowLogtenReview] = useState(false);
  // The extracted documents are held so the review dialog's UTC/Local switch
  // can re-parse WITHOUT re-reading the files — the pilot is answering a
  // question about the same bytes, not choosing a different import.
  const logtenDocsRef = useRef<NormalizedDocument[]>([]);

  const reset = () => {
    setProgress(null);
    setPendingPlan(null);
    setShowReview(false);
    setLogtenPlan(null);
    setShowLogtenReview(false);
    logtenDocsRef.current = [];
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const runLogtenParse = useCallback(
    async (docs: NormalizedDocument[], timeReference?: LogtenTimeReference) => {
      const plan = await parseLogtenExport(docs, {
        timeReference,
        onProgress: (percent, stage, detail) =>
          setProgress({ percent: 10 + Math.floor(percent * 0.85), stage, detail }),
      });
      if (!plan.success && plan.errors.length > 0) {
        throw new Error(plan.errors[0].message);
      }
      return plan;
    },
    []
  );

  const handleLogtenTimeReference = useCallback(
    async (reference: LogtenTimeReference) => {
      if (logtenDocsRef.current.length === 0) return;
      setBusy(true);
      try {
        setLogtenPlan(await runLogtenParse(logtenDocsRef.current, reference));
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : "Re-read failed");
        setShowLogtenReview(false);
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [runLogtenParse]
  );

  const handleLogtenExecute = useCallback(async () => {
    if (!logtenPlan) return;
    setBusy(true);
    setShowLogtenReview(false);
    setProgress({ percent: 5, stage: "Applying", detail: "Writing changes..." });
    try {
      const result = await executeLogtenImport(logtenPlan, {
        onProgress: (percent, stage, detail) =>
          setProgress({ percent, stage, detail }),
      });
      const parts: string[] = [];
      if (result.flightsCreated) parts.push(`${result.flightsCreated} flights`);
      if (result.simulatorsCreated)
        parts.push(`${result.simulatorsCreated} sim sessions`);
      if (result.flightsUpdated) parts.push(`${result.flightsUpdated} completed`);
      if (result.flightsSkipped)
        parts.push(`${result.flightsSkipped} already present`);
      if (result.crewCreated) parts.push(`${result.crewCreated} crew`);
      if (result.aircraftCreated)
        parts.push(`${result.aircraftCreated} aircraft`);
      if (result.flightsBackTagged)
        parts.push(`${result.flightsBackTagged} flights linked to aircraft`);
      if (result.errors.length) parts.push(`${result.errors.length} error(s)`);
      setSummary(parts.join(", ") || "No changes applied");
      setErrorMsg(null);
      onComplete?.();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Import failed");
    } finally {
      setProgress(null);
      setLogtenPlan(null);
      logtenDocsRef.current = [];
      setBusy(false);
    }
  }, [logtenPlan, onComplete]);

  const handleExecute = useCallback(
    async (plan: PlannedImport) => {
      setBusy(true);
      setProgress({ percent: 90, stage: "Applying", detail: "Writing changes..." });
      try {
        const result: ExecutionResult = await executeRosterImport(plan, {
          simSessions: simSessionsRef.current ?? [],
          importSource: importSourceRef.current,
          scheduleGeneratedAt: reportStampsRef.current.scheduleGeneratedAt,
          logbookGeneratedAt: reportStampsRef.current.logbookGeneratedAt,
        });
        const parts: string[] = [];
        if (result.created) parts.push(`${result.created} created`);
        if (result.updated) parts.push(`${result.updated} updated`);
        if (result.deleted) parts.push(`${result.deleted} deleted`);
        if (result.simSessionsCreated)
          parts.push(`${result.simSessionsCreated} sim sessions`);
        if (result.simDuplicatesRemoved)
          parts.push(`${result.simDuplicatesRemoved} duplicate sims removed`);
        if (result.groundDutiesCreated || result.groundDutiesUpdated)
          parts.push(
            `${result.groundDutiesCreated + result.groundDutiesUpdated} standby/ground duties`
          );
        if (result.aircraftCreated)
          parts.push(`${result.aircraftCreated} aircraft`);
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
        // The status dialog STAYS OPEN — it is the only place the summary and
        // the error message are ever shown, and closing it here meant every
        // eCrew import ended in silence: the work was done, `summary` was set,
        // and the surface that renders it had already gone. `onDone` closes it.
        setProgress(null);
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

        // ---- LogTen Pro migration ----
        // Routed before anything else because the two families share nothing
        // downstream: a LogTen file has no report type, no "Generated on"
        // watermark and no company to reconcile against.
        const logtenDocs = docs.filter((d) => isLogtenKind(d.reportType));
        if (logtenDocs.length > 0) {
          if (logtenDocs.length !== docs.length) {
            throw new Error(
              "Import LogTen Pro files on their own — they can't be merged with an eCrew report."
            );
          }
          setProgress({
            percent: 10,
            stage: "Parsing",
            detail: "LogTen Pro export",
          });
          logtenDocsRef.current = logtenDocs;
          setLogtenPlan(await runLogtenParse(logtenDocs));
          setShowLogtenReview(true);
          setProgress(null);
          return;
        }

        // Needed so the reconciler can resolve "Self" crew seats and diff the
        // full PIC + SIC crew (not just the logbook-derived PIC) on updates.
        const currentUserForRecon = await getCurrentUserPersonnel().catch(
          () => null
        );
        const reconCurrentUser = currentUserForRecon
          ? { id: currentUserForRecon.id, crewId: currentUserForRecon.crewId }
          : undefined;
        // PICUS-vs-SIC convention, so a PF/PM change carries the matching
        // pilotRole correction.
        const storedPrefs = await getUserPreferences().catch(() => null);
        const nonPicPfRole =
          storedPrefs?.importDefaults?.nonPicPfRole ??
          DEFAULT_IMPORT_DEFAULTS.nonPicPfRole;

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
        let scheduleGeneratedAt: number | null = null;
        let logbookGeneratedAt: number | null = null;

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

          // Simulator sessions: prefer the schedule's richer EBT/Training
          // Details entries; add any logbook-only sim dates the schedule
          // didn't carry. Deduped by date so one sim isn't logged twice.
          const schedSimDates = new Set(
            schedulePlan.simSessions.map((s) => s.date)
          );
          simSessions = [
            ...schedulePlan.simSessions,
            ...logbookPlan.simSessions.filter(
              (s) => !schedSimDates.has(s.date)
            ),
          ];

          // Re-reconcile against full DB using merged sectors and the report
          // generation timestamp from whichever side has it (prefer logbook
          // since it's the authoritative actuals).
          const reportGeneratedAt =
            logbookPlan.generatedAt ?? schedulePlan.generatedAt;
          scheduleGeneratedAt = schedulePlan.generatedAt;
          logbookGeneratedAt = logbookPlan.generatedAt;

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

          // Match against every date the sectors touch, not just the range the
          // headers state — a report's last duty spills its return leg into
          // the next day. See `flight-window.ts`.
          const matchWindow = flightMatchWindow(
            dateRange,
            sectorDates(merged.sectors)
          );
          const allFlights = await userDb.flights.toArray();
          const flightsInRange = allFlights.filter(
            (f) => isLiveFlight(f) && inWindow(f.date, matchWindow)
          );

          const operations = reconcileRoster({
            sectors: merged.sectors,
            existingFlights: flightsInRange,
            csvDateRange: dateRange,
            reportGeneratedAt,
            reportSource: "cross_hydrated",
            scheduleGeneratedAt,
            logbookGeneratedAt,
            useLegacyUpdateConflict: false,
            currentUser: reconCurrentUser,
            nonPicPfRole,
          });

          const acceptedOps = applyDefaultAcceptance(operations);
          plan = {
            ...schedulePlan,
            generatedAt: reportGeneratedAt ?? null,
            dateRange,
            operations: acceptedOps,
            personnelToCreate: [
              ...schedulePlan.personnelToCreate,
              ...logbookPlan.personnelToCreate,
            ],
            errors: [...schedulePlan.errors, ...logbookPlan.errors],
            warnings: [...schedulePlan.warnings, ...logbookPlan.warnings],
            summary: summarizeOperations(acceptedOps),
          };
        } else if (logbooks.length === 1) {
          importSource = "logbook";
          setProgress({ percent: 15, stage: "Parsing", detail: "Logbook" });
          const logbookPlan = await parseLogbookV2(logbooks[0], {
            onProgress: onParseProgress,
          });
          simSessions = logbookPlan.simSessions;

          // Promote logbook sectors to ParsedSector via the shared mapper,
          // which routes planned (future) sectors to scheduled times.
          const sectors = logbookPlan.sectors.map(logbookSectorToParsedSector);

          const matchWindow = flightMatchWindow(
            logbookPlan.dateRange,
            sectorDates(sectors)
          );
          const allFlights = await userDb.flights.toArray();
          const flightsInRange = allFlights.filter(
            (f) => isLiveFlight(f) && inWindow(f.date, matchWindow)
          );
          logbookGeneratedAt = logbookPlan.generatedAt;
          const operations = reconcileRoster({
            sectors,
            existingFlights: flightsInRange,
            csvDateRange: logbookPlan.dateRange,
            reportGeneratedAt: logbookPlan.generatedAt,
            reportSource: "logbook",
            logbookGeneratedAt: logbookPlan.generatedAt,
            useLegacyUpdateConflict: false,
            currentUser: reconCurrentUser,
            nonPicPfRole,
          });

          const acceptedOps = applyDefaultAcceptance(operations);
          plan = {
            success: logbookPlan.success,
            timeReference: "UTC",
            dateRange: logbookPlan.dateRange,
            generatedAt: logbookPlan.generatedAt,
            crewMember: { crewId: "", name: "", base: "", role: "", aircraftType: "" },
            operations: acceptedOps,
            simSessions: [],
            // A crew logbook report is flights only — it carries no standby or
            // ground duties. Those come from the schedule report.
            groundDuties: [],
            currencies: [],
            personnelToCreate: logbookPlan.personnelToCreate,
            personnelToUpdate: [],
            errors: logbookPlan.errors,
            warnings: logbookPlan.warnings,
            summary: summarizeOperations(acceptedOps),
          };
        } else {
          // Schedule-only path.
          importSource = "schedule";
          setProgress({ percent: 15, stage: "Parsing", detail: "Schedule" });
          plan = await parseScheduleCSV(schedules[0], {
            onProgress: onParseProgress,
          });
          simSessions = plan.simSessions;
          scheduleGeneratedAt = plan.generatedAt;
        }

        if (!plan.success && plan.errors.length > 0) {
          throw new Error(plan.errors[0].message);
        }

        simSessionsRef.current = simSessions;
        importSourceRef.current = importSource;
        reportStampsRef.current = { scheduleGeneratedAt, logbookGeneratedAt };

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
    [handleExecute, runLogtenParse]
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    handleFiles(files);
  };

  const onDialogChange = (open: boolean) => {
    if (!open && !showReview && !showLogtenReview && !busy) {
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
        accept=".csv,.pdf,.txt,.tsv"
        multiple
        onChange={onChange}
      />

      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-label="Import files"
        className="h-9 w-9 rounded-full"
        onClick={() => fileInputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Upload className="h-5 w-5" />
        )}
      </Button>

      <ImportStatusDialog
        open={isOpen && !showReview && !showLogtenReview}
        onOpenChange={onDialogChange}
        progress={progress}
        errorMsg={errorMsg}
        summary={summary}
        context={context}
        onDone={() => {
          setIsOpen(false);
          setSummary(null);
          setErrorMsg(null);
        }}
      />

      <ImportReviewModalV2
        plan={pendingPlan}
        isOpen={showReview}
        onConfirm={(updatedPlan) => {
          setShowReview(false);
          handleExecute(updatedPlan);
        }}
        onCancel={() => {
          // Setting a summary and closing in the same breath meant it was
          // never seen. Cancelling is its own confirmation — the dialog goes.
          setShowReview(false);
          setPendingPlan(null);
          setSummary(null);
          setIsOpen(false);
        }}
      />

      <LogtenReviewDialog
        plan={logtenPlan}
        isOpen={showLogtenReview}
        busy={busy}
        onConfirm={handleLogtenExecute}
        onCancel={() => {
          // Close the whole flow rather than falling back to the status
          // dialog — it would come up wearing its success face ("Import
          // complete / Your logbook is up to date") over the word "cancelled".
          setShowLogtenReview(false);
          setLogtenPlan(null);
          logtenDocsRef.current = [];
          setIsOpen(false);
          setSummary(null);
        }}
        onTimeReferenceChange={handleLogtenTimeReference}
      />
    </>
  );
}
