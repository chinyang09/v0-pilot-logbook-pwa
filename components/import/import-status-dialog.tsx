/**
 * Import status dialog — the progress / success / failure surface shown while
 * an import runs, before the review modal takes over.
 *
 * Dressed as the same material as the review modal and the nav pill: a
 * translucent panel over a radially-blurred backdrop. The flat `bg-black/50`
 * scrim a default dialog ships with reads fine over a dark app but turns a
 * light theme into grey mush (the glass sidebar in particular), so the veil is
 * much lighter in light mode and the blur does the separating instead.
 */

"use client";

import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
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
} from "@/components/ui/progressive-blur";
import { cn } from "@/lib/utils";

export interface ImportStage {
  percent: number;
  stage: string;
  detail?: string;
}

export function ImportStatusDialog({
  open,
  onOpenChange,
  progress,
  errorMsg,
  summary,
  context,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: ImportStage | null;
  errorMsg: string | null;
  summary: string | null;
  context?: string;
  onDone: () => void;
}) {
  const done = !progress && (errorMsg || summary);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[110] block max-w-sm gap-0 overflow-hidden rounded-3xl border-white/10 bg-card/70 p-5 shadow-2xl backdrop-saturate-150 sm:max-w-sm sm:p-6"
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
                : errorMsg
                  ? "Import failed"
                  : summary
                    ? "Import complete"
                    : "Import"}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {progress
                ? progress.stage
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

        {summary && !errorMsg && !progress && (
          <p className="mt-4 text-sm text-foreground">{summary}</p>
        )}

        {done && (
          <div className="mt-4 flex justify-end">
            <GlassContainer cornerRadius={20}>
              <Button
                variant="ghost"
                className="h-10 rounded-full px-5 font-semibold text-primary"
                onClick={onDone}
              >
                Done
              </Button>
            </GlassContainer>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
