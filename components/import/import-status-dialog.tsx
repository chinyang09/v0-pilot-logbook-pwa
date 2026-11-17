/**
 * Import status dialog — the progress / success / failure surface shown while
 * an import runs, before the review modal takes over.
 *
 * Dressed like the review modal: an OPAQUE panel over a radial backdrop. It
 * was translucent (/70, then /95), and the page behind — the logbook's empty
 * state, mostly — ghosted through behind the dialog's own text. The flat `bg-black/50`
 * scrim a default dialog ships with reads fine over a dark app but turns a
 * light theme into grey mush (the glass sidebar in particular), so the veil is
 * much lighter in light mode and the blur does the separating instead.
 */

"use client";

import type React from "react";
import { AlertTriangle, Check, CheckCircle2, Loader2, Upload, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MODAL_SCRIM,
  RadialBlurBackdrop,
} from "@/components/ui/chrome-overlays";
import { cn } from "@/lib/utils";
import { formatDayAt, formatDayRange } from "@/lib/utils/date";
import type { ReportTotalsCheck } from "@/lib/utils/roster/report-totals-check";

export interface ImportStage {
  percent: number;
  stage: string;
  detail?: string;
}

/** A question the import needs answered before it can go on. */
export interface ImportQuestion {
  title: string;
  description: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportStatusDialog({
  open,
  onOpenChange,
  progress,
  errorMsg,
  summary,
  totals,
  question,
  context,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: ImportStage | null;
  errorMsg: string | null;
  summary: string | null;
  /** The report's own totals against the logbook's, once written. */
  totals?: ReportTotalsCheck | null;
  question?: ImportQuestion | null;
  context?: string;
  onDone: () => void;
}) {
  const asking = !!question && !progress && !errorMsg;
  const done = !progress && !asking && (errorMsg || summary);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[110] block max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-3xl border-white/10 bg-card p-5 shadow-2xl sm:max-w-sm sm:p-6"
        overlayClassName={cn("z-[105]", MODAL_SCRIM)}
        backdropSlot={<RadialBlurBackdrop className="fixed inset-0 z-[106]" />}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
          <span
            aria-hidden
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-2xl",
              errorMsg
                ? "bg-destructive/10 text-destructive"
                : summary && !progress
                  ? "bg-status-valid/10 text-status-valid"
                  : "bg-primary/10 text-primary"
            )}
          >
            {progress ? (
              <Loader2 className="size-5 animate-spin" />
            ) : asking ? (
              <UserRound className="size-5" />
            ) : errorMsg ? (
              <XCircle className="size-5" />
            ) : summary ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <Upload className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">
              {progress
                ? "Importing"
                : asking
                  ? question.title
                  : errorMsg
                  ? "Import failed"
                  : summary
                    ? "Import complete"
                    : "Import"}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {progress
                ? progress.stage
                : asking
                  ? question.description
                  : errorMsg
                  ? "Nothing was changed"
                  : summary
                    ? "Your logbook is up to date"
                    : "Select a report file"}
            </DialogDescription>
          </div>
          {progress && (
            <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
              {progress.percent}%
            </span>
          )}
        </DialogHeader>

        {progress && (
          <div className="mt-4">
            {/* Rounded track + accent fill, width eased on the compositor —
                the shadcn Progress default reads as a form control here. */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${Math.max(2, progress.percent)}%` }}
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {progress.detail}
              </p>
              {context && (
                <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {context}
                </span>
              )}
            </div>
          </div>
        )}

        {errorMsg && (
          <p className="mt-4 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {errorMsg}
          </p>
        )}

        {asking && (
          <>
            <div className="mt-4">{question.body}</div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" className="h-10 px-4" onClick={question.onCancel}>
                Cancel
              </Button>
              <Button className="h-10 px-5 font-semibold" onClick={question.onConfirm}>
                {question.confirmLabel}
              </Button>
            </div>
          </>
        )}

        {summary && !errorMsg && !progress && !asking && (
          <p className="mt-4 text-sm text-foreground">{summary}</p>
        )}

        {totals && summary && !errorMsg && !progress && !asking && <TotalsCheck check={totals} />}

        {done && (
          <div className="mt-4 flex justify-end">
            <Button className="h-10 px-5 font-semibold" onClick={onDone}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const hm = (minutes: number) => {
  const m = Math.abs(minutes)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
}

/**
 * The report's "Total Hours and Statistics" beside the logbook's own figures
 * for the same days. A row that differs is amber with the difference; the
 * note under it says when the report was generated, because after that its
 * figures are the plan and a flight swapped since is the logbook being right.
 */
function TotalsCheck({ check }: { check: ReportTotalsCheck }) {
  const generatedBeforeEnd =
    check.generatedAt != null && new Date(check.generatedAt).toISOString().slice(0, 10) < check.range.end
  return (
    <section className="mt-4" aria-label="Report totals">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Report Totals</h3>
        <span className="text-[11px] text-muted-foreground">{formatDayRange(check.range.start, check.range.end)}</span>
      </div>
      <table className="mt-1.5 w-full text-xs tabular-nums">
        <thead className="sr-only">
          <tr>
            <th>Figure</th>
            <th>Report</th>
            <th>Logbook</th>
          </tr>
        </thead>
        <tbody>
          {check.rows.map((r) => {
            const value = (n: number) => (r.duration ? hm(n) : String(n))
            const ok = r.delta === 0
            return (
              <tr key={r.key} className="border-t border-border/50 first:border-t-0">
                <td className="py-1 pr-2 text-muted-foreground">{r.label}</td>
                <td className="py-1 pr-2 text-right text-foreground">{value(r.report)}</td>
                <td className={cn("py-1 text-right", ok ? "text-muted-foreground" : "font-medium text-status-warning")}>
                  {ok ? (
                    <span className="inline-flex items-center gap-1">
                      <Check aria-hidden className="size-3" />
                      <span className="sr-only">Matches</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle aria-hidden className="size-3" />
                      {value(r.logbook)} ({r.delta > 0 ? "+" : "−"}
                      {r.duration ? hm(r.delta) : Math.abs(r.delta)})
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {check.matches
          ? "The logbook agrees with every figure."
          : generatedBeforeEnd
            ? `Generated ${formatDayAt(check.generatedAt!, "Asia/Singapore", { weekday: false })}: after that the report is its schedule, so a change since is a difference.`
            : "The logbook differs from the report where marked."}
      </p>
    </section>
  )
}
