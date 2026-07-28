/**
 * Unified import review modal — v2.
 *
 * Tab-navigated review: operations are bucketed (New / Updated / Changes /
 * Your edits / Removed / Protected) and each bucket renders as a list of
 * flight cards rather than paragraphs of `field: from → to` text. Rows the
 * report already agrees with are not listed at all — they are counted in the
 * header instead. Changed values show
 * the old figure struck through in grey next to the new one in the accent
 * colour, so a card reads as a flight first and a diff second.
 *
 * Buckets that need the user's consent carry a checkbox per card plus a
 * select-all toggle; auto-applied buckets are read-only.
 */

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SegmentedTabs } from "./segmented-tabs";
import {
  MODAL_SCRIM,
  PROGRESSIVE_BLUR_CLEAR,
  ProgressiveBlur,
  RadialBlurBackdrop,
} from "@/components/ui/progressive-blur";
import { GlassContainer } from "@/components/ui/glass-container";
import { cn } from "@/lib/utils";
import type {
  AcceptableOperation,
  PlannedImport,
} from "@/lib/utils/parsers/schedule-parser";
import { usePreferences } from "@/components/providers/preferences-provider";
import { ImportFlightCard, type CardTone } from "./import-flight-card";
import type { FieldDiff } from "@/lib/utils/roster/reconciler";
import type { PilotRole } from "@/types/entities/flight.types";

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
  | "deletions"
  | "decided"
  | "protected";

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
    label: "Changes",
    tone: "consult",
    selectable: true,
    hint: "The report differs from what you have. Tick what to take.",
  },
  decided: {
    label: "Earlier decisions",
    tone: "consult",
    selectable: true,
    hint: "You already answered these, so they were left alone. Tick one only if you want to change your mind.",
  },
  deletions: {
    label: "Remove",
    tone: "delete",
    selectable: true,
    hint: "In your logbook but missing from this report. Tick to delete.",
  },
  protected: {
    label: "Protected",
    tone: "safe",
    selectable: false,
    hint: "Left alone — your data came from a newer report than this one.",
  },
};

/**
 * True when taking this change would replace something the USER wrote — a
 * signature, remarks, a manual override, or an edit made after the last sync.
 * Everything else in the same list only overwrites data a previous import put
 * there, which costs nothing.
 */
function isUserAuthored(op: AcceptableOperation): boolean {
  return op.kind === "edited_conflict";
}

/** Human wording for why a row counts as the user's own entry. */
const EDIT_REASON_LABEL: Record<string, string> = {
  has_signature: "signed",
  has_remarks: "your remarks",
  has_manual_overrides: "manual entry",
  user_modified_after_sync: "you edited it",
};

function editReasonText(op: AcceptableOperation): string | undefined {
  if (op.kind !== "edited_conflict") return undefined;
  const labels = op.editReasons
    .map((r) => EDIT_REASON_LABEL[r])
    .filter(Boolean);
  return labels.length > 0 ? labels.join(" · ") : "your entry";
}

const BUCKET_ORDER: Bucket[] = [
  "consult",
  "deletions",
  "creates",
  "safe",
  "decided",
  "protected",
];

const PAGE_SIZE = 25;

export function ImportReviewModalV2({
  plan,
  isOpen,
  onConfirm,
  onCancel,
}: Props) {
  const [acceptance, setAcceptance] = useState<Map<number, boolean>>(new Map());
  // Op indices where the user deliberately chose the company's day/night split
  // over our sun-position calculation. Empty by default — ours always wins
  // unless the user opts out per flight.
  const [useCompanyToLdg, setUseCompanyToLdg] = useState<Set<number>>(new Set());
  // Per-op pilot-role overrides. Empty means "use the role derived from the
  // user's import setting"; an entry means they picked a different one.
  const [roleOverrides, setRoleOverrides] = useState<Map<number, PilotRole>>(
    new Map()
  );
  // Op indices where the user chose to KEEP the pilot-flying value already in
  // their logbook rather than take the report's.
  const [useRecordedPf, setUseRecordedPf] = useState<Set<number>>(new Set());
  // Header and footer float OVER the scroll area (like the main panel), so the
  // list dissolves into a progressive blur instead of stopping at a hard edge.
  // Their heights are measured so the scroll padding always clears them.
  const [chromeHeights, setChromeHeights] = useState({ top: 96, bottom: 64 });
  const observeChrome = useCallback(
    (edge: "top" | "bottom") => (node: HTMLDivElement | null) => {
      if (!node) return;
      const ro = new ResizeObserver(() => {
        const h = node.offsetHeight;
        setChromeHeights((prev) =>
          prev[edge] === h ? prev : { ...prev, [edge]: h }
        );
      });
      ro.observe(node);
    },
    []
  );
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<Bucket | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { preferences } = usePreferences();
  const displayPrefs = preferences.display;

  const partitioned = useMemo(() => {
    const out: Record<Bucket, Entry[]> = {
      creates: [],
      safe: [],
      consult: [],
      deletions: [],
      decided: [],
      protected: [],
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
        case "edited_conflict":
          // One list: the action is identical (tick to take the report's
          // value). The only thing that differs is what it costs you, and
          // that belongs on the card, not in a separate tab.
          out.consult.push(entry);
          break;
        case "delete_missing":
          out.deletions.push(entry);
          break;
        case "skip_decided":
          out.decided.push(entry);
          break;
        case "skip_stale_report":
          out.protected.push(entry);
          break;
        // Flights that already match the report need no attention and are
        // never listed — they are only counted, below.
        case "skip_identical":
        case "skip_non_airline":
          break;
      }
    });
    // Rows that would overwrite something the user authored sink to the
    // bottom, so "Select all" (which skips them) reads as a clean top block
    // and the ones needing a real decision cluster where they're noticed.
    out.consult.sort(
      (a, b) => Number(isUserAuthored(a.op)) - Number(isUserAuthored(b.op))
    );
    return out;
  }, [plan]);

  // Flights already matching the report: counted for reassurance, never listed.
  const unchangedCount = useMemo(
    () =>
      plan?.operations.filter(
        (op) => op.kind === "skip_identical" || op.kind === "skip_non_airline"
      ).length ?? 0,
    [plan]
  );

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

  /**
   * Bulk toggle. Ticking never touches rows that would overwrite the user's
   * own entries — those stay a per-row decision, which is the whole reason
   * they no longer need a separate tab. Clearing applies to everything.
   */
  const setBucketAccept = (bucket: Bucket, value: boolean) => {
    setAcceptance((prev) => {
      const next = new Map(prev);
      for (const { op, index } of partitioned[bucket]) {
        if (value && isUserAuthored(op)) continue;
        next.set(index, value);
      }
      return next;
    });
  };

  const toggleCompanyToLdg = (index: number, value: boolean) => {
    setUseCompanyToLdg((prev) => {
      const next = new Set(prev);
      if (value) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const setRoleOverride = (index: number, role: PilotRole) => {
    setRoleOverrides((prev) => {
      const next = new Map(prev);
      next.set(index, role);
      return next;
    });
  };

  const toggleRecordedPf = (index: number, value: boolean) => {
    setUseRecordedPf((prev) => {
      const next = new Set(prev);
      if (value) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const handleConfirm = () => {
    const updatedOperations = plan.operations.map((op, index) => {
      const accepted = isAutoAccepted(op.kind) ? true : getAccept(index, false);

      // Deliberate opt-out: swap our calculated day/night figures back to the
      // company's for this flight only. Untouched otherwise — our calculator
      // is the default everywhere.
      const wantsCompany = useCompanyToLdg.has(index);
      const keepsRecordedPf = useRecordedPf.has(index);
      const role = roleOverrides.get(index);
      if ((wantsCompany || role || keepsRecordedPf) && "changes" in op && op.changes) {
        const all = op.changes as FieldDiff[];
        // Keeping the recorded pilot-flying value drops both halves of that
        // decision — the flag and the role it would have forced. Those dropped
        // diffs are remembered so the same report doesn't re-ask next time.
        const isPfPair = (c: FieldDiff) =>
          c.field === "pilotFlying" || c.field === "pilotRole";
        const declinedChanges = keepsRecordedPf ? all.filter(isPfPair) : [];
        const changes = all
          .filter((c) => !keepsRecordedPf || !isPfPair(c))
          .map((c) => {
            if (wantsCompany && c.companyValue !== undefined) {
              return { ...c, to: c.companyValue };
            }
            if (role && c.field === "pilotRole") return { ...c, to: role };
            return c;
          });
        return { ...op, changes, accepted, declinedChanges };
      }
      return { ...op, accepted };
    });
    onConfirm({ ...plan, operations: updatedOperations });
  };

  const countAccepted = (bucket: Bucket) =>
    partitioned[bucket].filter((e) => getAccept(e.index, false)).length;

  const consultAccepted = countAccepted("consult");
  const deleteAccepted = countAccepted("deletions");
  const revertAccepted = countAccepted("decided");

  const totalActions =
    partitioned.creates.length +
    partitioned.safe.length +
    consultAccepted +
    revertAccepted +
    deleteAccepted;

  const breakdown = [
    partitioned.creates.length && `${partitioned.creates.length} new`,
    partitioned.safe.length && `${partitioned.safe.length} updated`,
    consultAccepted && `${consultAccepted} overwritten`,
    revertAccepted && `${revertAccepted} reversed`,
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
        // Reads as an app surface rather than a plain modal: translucent panel
        // over a blurred backdrop, matching the glass chrome used by the nav
        // pill and the floating action buttons.
        className="z-[110] block max-w-3xl gap-0 overflow-hidden rounded-3xl border-white/10 bg-card/70 p-0 shadow-2xl backdrop-saturate-150 h-[calc(100dvh-7rem)] max-h-[46rem] top-[calc(env(safe-area-inset-top)+4.5rem)] translate-y-0 sm:top-[50%] sm:-translate-y-1/2"
        // The backdrop blur is strongest around the dialog and clears toward
        // the screen edges, so the app stays readable behind it.
        overlayClassName={cn("z-[105]", MODAL_SCRIM)}
        // Rendered inside the dialog's own portal, between the overlay and the
        // panel — the panel itself is `overflow-hidden` AND transformed, so it
        // would clip even a fixed-position child.
        backdropSlot={<RadialBlurBackdrop className="fixed inset-0 z-[106]" />}
      >
        {/* Floating top chrome: title + tab chips over a progressive blur. */}
        <div
          ref={(node) => {
            headerRef.current = node;
            observeChrome("top")(node);
          }}
          className="absolute inset-x-0 top-0 z-20"
        >
          <ProgressiveBlur side="top" />
          <div className="relative">
            <DialogHeader className="px-4 pt-4 sm:px-6 sm:pt-5">
              <DialogTitle>Review import</DialogTitle>
              <DialogDescription className="tabular-nums">
                {plan.dateRange.start} – {plan.dateRange.end}
                {generatedDate ? ` · generated ${generatedDate}` : ""}
                {unchangedCount > 0
                  ? ` · ${unchangedCount} already match`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="px-4 pb-3 pt-3 sm:px-6">
              <SegmentedTabs
                tabs={tabs}
                value={(current ?? tabs[0]?.value) as Bucket}
                onChange={(v) => {
                  setActiveTab(v);
                  setVisibleCount(PAGE_SIZE);
                }}
              />
            </div>
          </div>
        </div>

        {/* Panel.
            `overscroll-contain` stops the scroll chaining into the page behind
            the dialog once this list hits its end — that chaining scrolled the
            flight list underneath, and the glass action buttons re-sampled
            their backdrop as it moved, which read as them being tapped. */}
        <div
          className="h-full overflow-y-auto overscroll-contain px-4 sm:px-6"
          style={{
            // Clear the blur's fade tail as well as the chrome, so the first
            // row of content isn't sitting inside the gradient at rest.
            paddingTop: chromeHeights.top + PROGRESSIVE_BLUR_CLEAR,
            paddingBottom: chromeHeights.bottom + PROGRESSIVE_BLUR_CLEAR,
          }}
        >
          {meta && (
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">{meta.hint}</p>
              {meta.selectable && entries.length > 1 && (
                <button
                  type="button"
                  onClick={() => setBucketAccept(current!, selectedInTab === 0)}
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  {selectedInTab === 0 ? "Select all" : "Clear all"}
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
                displayPrefs={displayPrefs}
                tone={
                  isUserAuthored(op) ? "conflict" : meta?.tone ?? "safe"
                }
                ownEntryLabel={editReasonText(op)}
                checked={meta?.selectable ? getAccept(index, false) : undefined}
                onCheckedChange={
                  meta?.selectable ? (v) => setAccept(index, v) : undefined
                }
                useCompany={useCompanyToLdg.has(index)}
                onUseCompanyChange={(v) => toggleCompanyToLdg(index, v)}
                roleOverride={roleOverrides.get(index)}
                onRoleChange={(role) => setRoleOverride(index, role)}
                useRecordedPf={useRecordedPf.has(index)}
                onUseRecordedPfChange={(v) => toggleRecordedPf(index, v)}
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

        {/* Floating bottom chrome: glass actions over a progressive blur. */}
        <div
          ref={observeChrome("bottom")}
          className="absolute inset-x-0 bottom-0 z-20"
        >
          <ProgressiveBlur side="bottom" />
          <DialogFooter className="relative flex-row items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {breakdown || "No changes selected"}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <GlassContainer cornerRadius={20}>
                <Button
                  variant="ghost"
                  onClick={onCancel}
                  className="h-10 rounded-full px-4"
                >
                  Cancel
                </Button>
              </GlassContainer>
              <GlassContainer cornerRadius={20}>
                <Button
                  variant="ghost"
                  onClick={handleConfirm}
                  className="h-10 rounded-full px-5 font-semibold text-primary"
                >
                  Apply
                  {totalActions > 0 && (
                    <span className="ml-1 tabular-nums">{totalActions}</span>
                  )}
                </Button>
              </GlassContainer>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
