"use client";

/**
 * Replacement handler for the import action in app/(app)/roster/page.tsx.
 *
 * Drop this hook into the existing RosterPage component in place of the old
 * handleFileSelect callback and its surrounding state declarations.
 * Then render {ReviewModal} somewhere in the JSX return.
 */

import { useState, useCallback, useRef } from "react";
import React from "react";
import {
  parseScheduleCSV,
  detectCSVType,
  type PlannedImport,
} from "@/lib/utils/parsers/schedule-parser";
import { executeRosterImport } from "@/lib/utils/roster/executor";
import { ImportReviewModal } from "@/components/roster/import-review-modal";

export function useRosterImportHandler(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshEntries: () => Promise<any> | void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshAllData: () => Promise<any> | void;
}) {
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStage, setImportStage] = useState("");
  const [pendingPlan, setPendingPlan] = useState<PlannedImport | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const executePlan = useCallback(
    async (plan: PlannedImport) => {
      setIsImporting(true);
      setImportStage("Applying changes...");
      try {
        const result = await executeRosterImport(plan);
        const parts: string[] = [];
        if (result.created) parts.push(`${result.created} created`);
        if (result.updated) parts.push(`${result.updated} updated`);
        if (result.deleted) parts.push(`${result.deleted} deleted`);
        if (result.identical) parts.push(`${result.identical} unchanged`);
        if (result.ignored) parts.push(`${result.ignored} ignored`);
        setImportSummary(parts.join(", ") || "No changes applied");
        await opts.refreshEntries();
        await opts.refreshAllData();
      } catch (error) {
        setImportSummary(
          error instanceof Error ? error.message : "Import failed"
        );
      } finally {
        setIsImporting(false);
        setPendingPlan(null);
        setShowReviewModal(false);
      }
    },
    [opts]
  );

  const handleFileImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      setImportProgress(0);
      setImportStage("Reading file...");
      setImportSummary(null);

      try {
        const content = await file.text();
        const csvType = detectCSVType(content);
        if (csvType !== "schedule") {
          setImportSummary(
            csvType === "logbook"
              ? "This is a Logbook CSV — use Data Import instead."
              : "Unrecognized CSV format."
          );
          setIsImporting(false);
          return;
        }

        const plan = await parseScheduleCSV(content, {
          onProgress: (percent, stage, detail) => {
            setImportProgress(percent);
            setImportStage(detail || stage);
          },
          sourceFile: file.name,
        });

        if (!plan.success && plan.errors.length > 0) {
          setImportSummary(`Parse failed: ${plan.errors[0].message}`);
          setIsImporting(false);
          return;
        }

        // Skip the modal when there's nothing to decide.
        const needsReview =
          plan.summary.toUpdate > 0 || plan.summary.toDelete > 0;

        if (!needsReview) {
          await executePlan(plan);
        } else {
          setPendingPlan(plan);
          setShowReviewModal(true);
          setIsImporting(false);
        }
      } catch (error) {
        setImportSummary(
          error instanceof Error ? error.message : "Unknown error"
        );
        setIsImporting(false);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [executePlan]
  );

  const ReviewModal = React.createElement(ImportReviewModal, {
    plan: pendingPlan,
    isOpen: showReviewModal,
    onConfirm: (updatedPlan: PlannedImport) => {
      setShowReviewModal(false);
      executePlan(updatedPlan);
    },
    onCancel: () => {
      setShowReviewModal(false);
      setPendingPlan(null);
      setImportSummary("Import cancelled");
    },
  });

  return {
    isImporting,
    importProgress,
    importStage,
    importSummary,
    fileInputRef,
    handleFileImport,
    ReviewModal,
  };
}
