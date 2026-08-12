/**
 * The consent surface for a LogTen Pro migration.
 *
 * A migration is one large, one-time action, so the dialog answers the two
 * questions a pilot actually has before pressing go — "what is about to land
 * in my logbook?" and "did it read my times correctly?" — and nothing else.
 * It is deliberately NOT the eCrew review modal: there is no per-field
 * negotiation between a pilot and their company here, because the file being
 * imported is already the pilot's own record.
 *
 * The time-reference control is the part that earns its place. LogTen writes
 * no zone marker, so the parser infers it from the file; when every sector is
 * inside one timezone there is nothing to infer from, and reading local times
 * as UTC would file the whole logbook hours out. In that case the control is
 * the pilot's call, made before anything is written.
 */

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GlassContainer } from "@/components/ui/glass-container";
import {
  MODAL_SCRIM,
  RadialBlurBackdrop,
} from "@/components/ui/chrome-overlays";
import { cn } from "@/lib/utils";
import { SegmentedTabs } from "./segmented-tabs";
import type {
  LogtenImportPlan,
  LogtenTimeReference,
} from "@/lib/utils/parsers/logten/types";

/** How many issues to list before collapsing into a count. */
const ISSUE_PREVIEW = 6;

export function LogtenReviewDialog({
  plan,
  isOpen,
  busy,
  onConfirm,
  onCancel,
  onTimeReferenceChange,
}: {
  plan: LogtenImportPlan | null;
  isOpen: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Re-parses the same files under a different reading of their clock times. */
  onTimeReferenceChange: (reference: LogtenTimeReference) => void;
}) {
  const [showIssues, setShowIssues] = useState(false);

  const rows = useMemo(() => {
    if (!plan) return [];
    return [
      { label: "Flights", value: plan.summary.flightsToCreate },
      { label: "Simulator sessions", value: plan.summary.simulatorsToCreate },
      { label: "Flights completed", value: plan.summary.flightsToUpdate },
      { label: "Already in logbook", value: plan.summary.flightsDuplicate },
      { label: "Crew", value: plan.summary.crewToCreate },
      { label: "Crew updated", value: plan.summary.crewToUpdate },
      { label: "Aircraft", value: plan.summary.aircraftToCreate },
      { label: "Aircraft updated", value: plan.summary.aircraftToUpdate },
    ].filter((row) => row.value > 0);
  }, [plan]);

  const issues = useMemo(() => {
    if (!plan) return [];
    return [
      ...plan.errors.map((i) => ({ ...i, kind: "error" as const })),
      ...plan.warnings.map((i) => ({ ...i, kind: "warning" as const })),
      ...plan.flights.skipped.map((i) => ({ ...i, kind: "skipped" as const })),
      ...plan.aircraft.skipped.map((i) => ({ ...i, kind: "skipped" as const })),
      ...plan.crew.skipped.map((i) => ({ ...i, kind: "skipped" as const })),
    ];
  }, [plan]);

  if (!plan) return null;

  const files = [plan.sources.flights, plan.sources.aircraft, plan.sources.crew]
    .filter(Boolean)
    .join(" · ");

  const nothingToDo = rows.length === 0;
  const uncertainTimes = plan.flights.timeReferenceConfidence === "assumed";
  const hasFlights = plan.flights.operations.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        className="z-[110] flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden rounded-3xl border-white/10 bg-card/70 p-5 shadow-2xl backdrop-saturate-150 sm:p-6"
        overlayClassName={cn("z-[105]", MODAL_SCRIM)}
        backdropSlot={<RadialBlurBackdrop className="fixed inset-0 z-[106]" />}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"
          >
            <FileText className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Import from LogTen Pro</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {files || "LogTen export"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="-mx-1 mt-4 min-h-0 flex-1 overflow-y-auto px-1 scrollbar-hide">
          {plan.flights.dateRange.start && (
            <p className="text-xs text-muted-foreground">
              {plan.flights.dateRange.start}
              <ArrowRight className="mx-1 inline size-3 align-[-1px]" />
              {plan.flights.dateRange.end}
            </p>
          )}

          {/* ---- What lands ---- */}
          <div className="mt-3 overflow-hidden rounded-2xl bg-foreground/[0.04]">
            {nothingToDo ? (
              <p className="px-4 py-3.5 text-sm text-muted-foreground">
                Nothing new to import — everything in these files is already in
                your logbook.
              </p>
            ) : (
              rows.map((row, index) => (
                <div
                  key={row.label}
                  className={cn(
                    "flex items-center justify-between px-4 py-2.5 text-sm",
                    index > 0 && "border-t border-foreground/[0.06]"
                  )}
                >
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-semibold tabular-nums">{row.value}</span>
                </div>
              ))
            )}
          </div>

          {/* ---- How the clock times were read ---- */}
          {hasFlights && (
            <div
              className={cn(
                "mt-3 rounded-2xl p-3.5",
                uncertainTimes ? "bg-status-warning/10" : "bg-foreground/[0.04]"
              )}
            >
              <div className="flex items-start gap-2">
                {uncertainTimes ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" />
                ) : (
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Times read as{" "}
                    {plan.flights.timeReference === "utc"
                      ? "UTC"
                      : "local station time"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {plan.flights.timeReferenceEvidence}
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <SegmentedTabs
                  tabs={[
                    { value: "utc", label: "UTC" },
                    { value: "local", label: "Local" },
                  ]}
                  value={plan.flights.timeReference}
                  onChange={(value) =>
                    onTimeReferenceChange(value as LogtenTimeReference)
                  }
                />
              </div>
            </div>
          )}

          {/* ---- Issues ---- */}
          {issues.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowIssues((open) => !open)}
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                {showIssues ? "Hide" : "Show"} {issues.length} note
                {issues.length === 1 ? "" : "s"}
              </button>
              {showIssues && (
                <ul className="mt-2 space-y-1.5">
                  {issues.slice(0, ISSUE_PREVIEW).map((issue, index) => (
                    <li
                      key={`${issue.line}-${index}`}
                      className="rounded-xl bg-foreground/[0.04] px-3 py-2 text-xs text-muted-foreground"
                    >
                      {issue.line > 0 && (
                        <span className="mr-1.5 font-medium tabular-nums text-foreground/70">
                          Line {issue.line}
                        </span>
                      )}
                      {issue.message}
                    </li>
                  ))}
                  {issues.length > ISSUE_PREVIEW && (
                    <li className="px-3 text-xs text-muted-foreground">
                      …and {issues.length - ISSUE_PREVIEW} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex shrink-0 items-center justify-end gap-2">
          {!nothingToDo && (
            <Button
              variant="ghost"
              className="h-10 rounded-full px-4"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <GlassContainer cornerRadius={20}>
            {/* A plan with nothing to apply gets a DONE button, not a disabled
                Import one. A dead primary button reads as the dialog being
                broken — which is exactly how it read after deleting an
                aircraft and re-importing the same file. */}
            <Button
              variant="ghost"
              className="h-10 rounded-full px-5 font-semibold text-primary"
              disabled={busy}
              onClick={nothingToDo ? onCancel : onConfirm}
            >
              {nothingToDo ? "Done" : "Import"}
            </Button>
          </GlassContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
