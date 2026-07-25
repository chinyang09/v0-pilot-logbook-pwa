/**
 * Unified import review modal — v2.
 *
 * Tab-navigated review: operations are bucketed (New / Updates / Review /
 * Conflicts / Remove / Skipped) and each bucket renders as a list of flight
 * cards rather than paragraphs of `field: from → to` text. Changed values show
 * the old figure struck through in grey next to the new one in the accent
 * colour, so a card reads as a flight first and a diff second.
 *
 * Buckets that need the user's consent carry a checkbox per card plus a
 * select-all toggle; auto-applied buckets are read-only.
 */

"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterChips } from "@/components/ui/filter-chips";
import type {
  AcceptableOperation,
  PlannedImport,
} from "@/lib/utils/parsers/schedule-parser";
import { usePreferences } from "@/components/providers/preferences-provider";
import {
  ImportFlightCard,
  type AirportPref,
  type CardTone,
} from "./import-flight-card";

interface Props {
  plan: PlannedImport | null;
  isOpen: boolean;
  onConfirm: (updatedPlan: PlannedImport) => void;
  onCancel: () => void;
}

type Bucket =
  | "creates"
  | "safe"
  | "consult"
  | "edited"
  | "deletions"
  | "skipped";

type Entry = { op: AcceptableOperation; index: number };

/** Op kinds applied without asking (mirrors the executor's default set). */
function isAutoAccepted(kind: AcceptableOperation["kind"]): boolean {
  return (
    kind === "create" ||
    kind === "skip_identical" ||
    kind === "skip_non_airline" ||
    kind === "skip_stale_report" ||
    kind === "update_safe"
  );
}

const BUCKET_META: Record<
  Bucket,
  { label: string; tone: CardTone; selectable: boolean; hint: string }
> = {
  creates: {
    label: "New",
    tone: "create",
    selectable: false,
    hint: "Added to your logbook automatically.",
  },
  safe: {
    label: "Updates",
    tone: "safe",
    selectable: false,
    hint: "Crew, route and future-flight details applied automatically.",
  },
  consult: {
    label: "Review",
    tone: "consult",
    selectable: true,
    hint: "Already-flown flights with differing details. Tick the ones to overwrite.",
  },
  edited: {
    label: "Conflicts",
    tone: "conflict",
    selectable: true,
    hint: "These carry your own edits. Ticking one replaces your version.",
  },
  deletions: {
    label: "Remove",
    tone: "delete",
    selectable: true,
    hint: "In your logbook but missing from this report. Tick to delete.",
  },
  skipped: {
    label: "Skipped",
    tone: "safe",
    selectable: false,
    hint: "Unchanged, or protected because your data came from a newer report.",
  },
};

const BUCKET_ORDER: Bucket[] = [
  "consult",
  "edited",
  "deletions",
  "creates",
  "safe",
  "skipped",
];

const PAGE_SIZE = 25;

export function ImportReviewModalV2({
  plan,
  isOpen,
  onConfirm,
  onCancel,
}: Props) {
  const [acceptance, setAcceptance] = useState<Map<number, boolean>>(new Map());
  const [activeTab, setActiveTab] = useState<Bucket | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { preferences } = usePreferences();
  const airportPref = preferences.display.airportIdentifier as AirportPref;

  const partitioned = useMemo(() => {
    const out: Record<Bucket, Entry[]> = {
      creates: [],
      safe: [],
      consult: [],
      edited: [],
      deletions: [],
      skipped: [],
    };
    if (!plan) return out;

    plan.operations.forEach((op, index) => {
      const entry: Entry = { op, index };
      switch (op.kind) {
        case "create":
          out.creates.push(entry);
          break;
        case "update_safe":
          out.safe.push(entry);
          break;
        case "update_consult":
        case "update_conflict":
          out.consult.push(entry);
          break;
        case "edited_conflict":
          out.edited.push(entry);
          break;
        case "delete_missing":
          out.deletions.push(entry);
          break;
        case "skip_stale_report":
        case "skip_identical":
        case "skip_non_airline":
          out.skipped.push(entry);
          break;
      }
    });
    return out;
  }, [plan]);

  const tabs = useMemo(
    () =>
      BUCKET_ORDER.filter((b) => partitioned[b].length > 0).map((b) => ({
        value: b,
        label: BUCKET_META[b].label,
        count: partitioned[b].length,
      })),
    [partitioned]
  );

  // Default to the first bucket that wants attention (BUCKET_ORDER puts the
  // consent-required buckets first), without fighting an explicit choice.
  const current: Bucket | null =
    activeTab && partitioned[activeTab].length > 0
      ? activeTab
      : (tabs[0]?.value as Bucket | undefined) ?? null;

  if (!plan) return null;

  const getAccept = (index: number, defaultValue: boolean) =>
    acceptance.has(index) ? acceptance.get(index)! : defaultValue;

  const setAccept = (index: number, value: boolean) => {
    setAcceptance((prev) => {
      const next = new Map(prev);
      next.set(index, value);
      return next;
    });
  };

  const setBucketAccept = (bucket: Bucket, value: boolean) => {
    setAcceptance((prev) => {
      const next = new Map(prev);
      for (const { index } of partitioned[bucket]) next.set(index, value);
      return next;
    });
  };

  const handleConfirm = () => {
    const updatedOperations = plan.operations.map((op, index) =>
      isAutoAccepted(op.kind)
        ? { ...op, accepted: true }
        : { ...op, accepted: getAccept(index, false) }
    );
    onConfirm({ ...plan, operations: updatedOperations });
  };

  const countAccepted = (bucket: Bucket) =>
    partitioned[bucket].filter((e) => getAccept(e.index, false)).length;

  const consultAccepted = countAccepted("consult");
  const editedAccepted = countAccepted("edited");
  const deleteAccepted = countAccepted("deletions");

  const totalActions =
    partitioned.creates.length +
    partitioned.safe.length +
    consultAccepted +
    editedAccepted +
    deleteAccepted;

  const breakdown = [
    partitioned.creates.length && `${partitioned.creates.length} new`,
    partitioned.safe.length && `${partitioned.safe.length} updated`,
    consultAccepted && `${consultAccepted} overwritten`,
    editedAccepted && `${editedAccepted} conflict`,
    deleteAccepted && `${deleteAccepted} deleted`,
  ]
    .filter(Boolean)
    .join(" · ");

  const generatedDate = plan.generatedAt
    ? new Date(plan.generatedAt).toLocaleString(undefined, {
        timeZone: "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  const entries = current ? partitioned[current] : [];
  const meta = current ? BUCKET_META[current] : null;
  const shown = entries.slice(0, visibleCount);
  const selectedInTab = current ? countAccepted(current) : 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        // Raise above the floating nav pill (z-[100]) so the modal header
        // isn't hidden behind it. Constrain to the visible viewport with
        // safe-area insets top + bottom so it never extends under the nav
        // pill or the mobile bottom nav.
        className="z-[110] flex max-w-3xl flex-col gap-0 p-0 max-h-[calc(100dvh-7rem)] top-[calc(env(safe-area-inset-top)+4.5rem)] translate-y-0 sm:top-[50%] sm:-translate-y-1/2"
        overlayClassName="z-[105]"
      >
        <DialogHeader className="px-4 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle>Review import</DialogTitle>
          <DialogDescription className="tabular-nums">
            {plan.dateRange.start} – {plan.dateRange.end}
            {generatedDate ? ` · generated ${generatedDate} UTC` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Tab strip */}
        <div className="border-b px-4 pb-3 pt-3 sm:px-6">
          <FilterChips
            options={tabs}
            value={(current ?? tabs[0]?.value) as Bucket}
            onChange={(v) => {
              setActiveTab(v as Bucket);
              setVisibleCount(PAGE_SIZE);
            }}
            className="mx-0 px-0"
          />
        </div>

        {/* Panel */}
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          {meta && (
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">{meta.hint}</p>
              {meta.selectable && entries.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setBucketAccept(current!, selectedInTab < entries.length)
                  }
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  {selectedInTab < entries.length
                    ? "Select all"
                    : "Clear all"}
                </button>
              )}
            </div>
          )}

          <div
            key={current ?? "empty"}
            className="space-y-2 duration-200 animate-in fade-in-0"
          >
            {shown.map(({ op, index }) => (
              <ImportFlightCard
                key={`${index}-${op.kind}`}
                op={op}
                airportPref={airportPref}
                tone={meta?.tone ?? "safe"}
                checked={meta?.selectable ? getAccept(index, false) : undefined}
                onCheckedChange={
                  meta?.selectable ? (v) => setAccept(index, v) : undefined
                }
              />
            ))}

            {entries.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing to review here.
              </p>
            )}

            {entries.length > shown.length && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, entries.length - shown.length)} more
                <span className="ml-1 text-muted-foreground tabular-nums">
                  ({entries.length - shown.length} left)
                </span>
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {breakdown || "No changes selected"}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirm}>
              Apply
              {totalActions > 0 && (
                <span className="ml-1 tabular-nums">{totalActions}</span>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
