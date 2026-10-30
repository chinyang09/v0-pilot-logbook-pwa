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
  readReportSubject,
  type PlannedImport,
} from "@/lib/utils/parsers/schedule-parser";
import { parseLogbookV2 } from "@/lib/utils/parsers/logbook-parser-v2";
import {
  crossHydrate,
  mergeImportPersonnel,
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
  addPersonnel,
  getCurrentUserPersonnel,
  getLoggingProfile,
  getUserPreferences,
  DEFAULT_IMPORT_DEFAULTS,
  ensureAirportDatabase,
  onAirportSeedProgress,
} from "@/lib/db";
import type { FlightLog } from "@/types/entities/flight.types";
import type { NormalizedDocument } from "@/lib/utils/parsers/types";
import { ImportReviewModalV2 } from "./import-review-modal-v2";
import { ImportStatusDialog, type ImportStage } from "./import-status-dialog";
import type { Personnel } from "@/types/entities/crew.types";
import { nonPicPfRoleOf } from "@/lib/utils/roster/pilot-role";

interface Props {
  /** Where the button is mounted — affects success-message wording. */
  context?: "logbook" | "roster" | "shared";
  /** Triggered after a successful execution so the page can refresh. */
  onComplete?: () => void;
}

/** "1 flight", "2 flights" — the summary line read "1 sim sessions". */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

type ReportSubject = PlannedImport["crewMember"];

/** The seat a report's rank states — nothing for a rank it does not name. */
function seatFromRank(rank: string): Pick<Personnel, "roles" | "defaultPIC" | "defaultSIC"> {
  const r = rank.toUpperCase();
  if (r === "CPT" || r === "CP" || r === "CA") return { roles: ["PIC"], defaultPIC: true };
  if (r === "FO" || r === "SFO" || r === "SO") return { roles: ["SIC"], defaultSIC: true };
  return {};
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
  // An account with no "This is me" card, importing a report that names its
  // pilot: asked, rather than refused. The files wait here for the answer.
  const [subject, setSubject] = useState<ReportSubject | null>(null);
  const pendingFilesRef = useRef<File[]>([]);
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
    setSubject(null);
    pendingFilesRef.current = [];
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
      if (result.flightsCreated) parts.push(count(result.flightsCreated, "flight"));
      if (result.simulatorsCreated)
        parts.push(count(result.simulatorsCreated, "sim session"));
      if (result.flightsUpdated) parts.push(`${result.flightsUpdated} completed`);
      if (result.flightsSkipped)
        parts.push(`${result.flightsSkipped} already present`);
      if (result.crewCreated) parts.push(`${result.crewCreated} crew`);
      if (result.aircraftCreated)
        parts.push(`${result.aircraftCreated} aircraft`);
      if (result.flightsBackTagged)
        parts.push(`${count(result.flightsBackTagged, "flight")} linked to aircraft`);
      if (result.errors.length) parts.push(count(result.errors.length, "error"));
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
        // A flight logged on another aeroplane than that day's published
        // schedule gets a note in Discrepancies — never a change. In the
        // background: it asks the network, and the import is already done.
        void import("@/lib/utils/roster/aircraft-cross-check")
          .then(({ crossCheckImportedAircraft }) => crossCheckImportedAircraft(result.touchedFlightIds))
          .catch(() => {});
        const parts: string[] = [];
        if (result.created) parts.push(`${result.created} created`);
        if (result.updated) parts.push(`${result.updated} updated`);
        if (result.deleted) parts.push(`${result.deleted} deleted`);
        if (result.simSessionsCreated)
          parts.push(count(result.simSessionsCreated, "sim session"));
        if (result.simDuplicatesRemoved)
          parts.push(`${count(result.simDuplicatesRemoved, "duplicate sim")} removed`);
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
          parts.push(count(result.errors.length, "error"));
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
        // Every parser below resolves airports against the local reference
        // table, which is otherwise only seeded when an airport list mounts.
        // Loaded alongside the extraction, and awaited before any parse.
        const airportsReady = ensureAirportDatabase();
        const docs = await extractDocuments(files);

        // Every sector is logged FROM someone's seat, so the import needs the
        // pilot's own crew card. A new account has none — and importing is the
        // first thing a new pilot does — so it used to refuse outright. The
        // schedule report names its subject; ask whether that is them.
        // Asked as soon as the files are read — before the airport seed, which
        // takes a fresh device seconds and is not needed to answer it.
        const ecrewDocs = docs.filter(
          (d) => d.reportType === "schedule" || d.reportType === "logbook"
        );
        if (
          ecrewDocs.length > 0 &&
          ecrewDocs.length === docs.length &&
          !(await getCurrentUserPersonnel())
        ) {
          const schedule = ecrewDocs.find((d) => d.reportType === "schedule");
          const named = schedule ? readReportSubject(schedule) : null;
          if (!named) {
            throw new Error(
              "This report doesn't say whose it is. Import your schedule report — it names you — or add yourself under Crew with “This is me” on."
            );
          }
          pendingFilesRef.current = files;
          setSubject(named);
          setProgress(null);
          return;
        }

        // A first seed on a fresh device takes seconds; say so rather than
        // leave the bar frozen at 5%. Fires only while a seed is running.
        const stopSeedProgress = onAirportSeedProgress((fraction) =>
          setProgress({
            percent: 5 + Math.round(fraction * 5),
            stage: "Preparing",
            detail: `Airport database ${Math.round(fraction * 100)}%`,
          })
        );
        try {
          await airportsReady;
        } finally {
          stopSeedProgress();
        }

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
          // Progress is NOT cleared here: the status dialog is closing, and
          // Radix keeps it on screen for its fade-out — with progress cleared
          // it fell back to its idle face ("Import · Select a report file")
          // for that moment, between the progress and the review. The cancel
          // and execute paths both overwrite it.
          setShowLogtenReview(true);
          return;
        }

        // Needed so the reconciler can resolve "Self" crew seats and diff the
        // full PIC + SIC crew (not just the logbook-derived PIC) on updates.
        const currentUserForRecon = await getLoggingProfile().catch(
          () => null
        );
        const reconCurrentUser = currentUserForRecon
          ? { id: currentUserForRecon.id, crewId: currentUserForRecon.crewId }
          : undefined;
        // PICUS-vs-SIC convention, so a PF/PM change carries the matching
        // pilotRole correction.
        const storedPrefs = await getUserPreferences().catch(() => null);
        // The convention lives on the pilot's own crew card now; the old
        // Import Defaults value is only a fallback for a card that predates it.
        const nonPicPfRole = nonPicPfRoleOf(
          currentUserForRecon,
          storedPrefs?.importDefaults?.nonPicPfRole ??
            DEFAULT_IMPORT_DEFAULTS.nonPicPfRole
        );

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
          const hydrated = crossHydrate(logbookPlan, schedulePlan);
          // One card per person — see `mergeImportPersonnel`.
          const crew = mergeImportPersonnel(
            hydrated.sectors,
            schedulePlan.personnelToCreate,
            logbookPlan.personnelToCreate
          );
          const merged = { ...hydrated, sectors: crew.sectors };

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
            pfRoleFrom: currentUserForRecon?.pfRoleFrom ?? null,
          });

          const acceptedOps = applyDefaultAcceptance(operations);
          plan = {
            ...schedulePlan,
            generatedAt: reportGeneratedAt ?? null,
            dateRange,
            operations: acceptedOps,
            personnelToCreate: crew.personnelToCreate,
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
            pfRoleFrom: currentUserForRecon?.pfRoleFrom ?? null,
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
          // Not cleared — see the LogTen hand-off above.
          setShowReview(true);
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

  const confirmSubject = useCallback(async () => {
    const named = subject;
    const files = pendingFilesRef.current;
    setSubject(null);
    pendingFilesRef.current = [];
    if (!named || files.length === 0) return;
    try {
      await addPersonnel({ name: named.name, crewId: named.crewId, isMe: true, ...seatFromRank(named.role) });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Couldn't create your crew card");
      return;
    }
    await handleFiles(files);
  }, [subject, handleFiles]);

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
        question={
          subject
            ? {
                title: "Is this you?",
                description: "This report belongs to",
                body: (
                  <div className="rounded-2xl bg-foreground/[0.06] px-3 py-2.5">
                    <p className="text-sm font-medium text-foreground">{subject.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[subject.crewId, subject.role, subject.base].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Your logbook has no “This is me” crew card yet. Confirm to create it from this report and carry on.
                    </p>
                  </div>
                ),
                confirmLabel: "That’s me",
                onConfirm: () => void confirmSubject(),
                onCancel: () => {
                  setIsOpen(false);
                  reset();
                },
              }
            : null
        }
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
          setProgress(null);
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
          setProgress(null);
        }}
        onTimeReferenceChange={handleLogtenTimeReference}
      />
    </>
  );
}
