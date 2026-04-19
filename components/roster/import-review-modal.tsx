/**
 * Roster Import Review Modal
 *
 * Shown when parseScheduleCSV() returns a plan containing any conflicts or
 * deletion candidates. For a clean import (only creates + skips), the page
 * skips the modal and executes directly.
 *
 * Users see three sections:
 *   - Conflicts (time differences) — default unchecked, user opts in
 *   - Edited conflicts (user-modified flights) — default unchecked, WARNING badge
 *   - Missing from roster (TR flights in DB but not in new CSV) — default unchecked
 *
 * Creates and identical matches are summarized at the top, not individually
 * reviewable — they proceed automatically.
 */

"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AlertTriangle, ArrowRight, Trash2, Edit3, Plus } from "lucide-react";
import type {
  PlannedImport,
  AcceptableOperation,
} from "@/lib/utils/parsers/schedule-parser";

interface ImportReviewModalProps {
  plan: PlannedImport | null;
  isOpen: boolean;
  onConfirm: (updatedPlan: PlannedImport) => void;
  onCancel: () => void;
}

export function ImportReviewModal({
  plan,
  isOpen,
  onConfirm,
  onCancel,
}: ImportReviewModalProps) {
  const [acceptance, setAcceptance] = useState<Map<number, boolean>>(new Map());

  const partitioned = useMemo(() => {
    if (!plan) {
      return {
        creates: [] as { op: AcceptableOperation; index: number }[],
        identical: [] as { op: AcceptableOperation; index: number }[],
        conflicts: [] as { op: AcceptableOperation; index: number }[],
        editedConflicts: [] as { op: AcceptableOperation; index: number }[],
        deletions: [] as { op: AcceptableOperation; index: number }[],
      };
    }
    const result = {
      creates: [] as { op: AcceptableOperation; index: number }[],
      identical: [] as { op: AcceptableOperation; index: number }[],
      conflicts: [] as { op: AcceptableOperation; index: number }[],
      editedConflicts: [] as { op: AcceptableOperation; index: number }[],
      deletions: [] as { op: AcceptableOperation; index: number }[],
    };
    plan.operations.forEach((op, index) => {
      const entry = { op, index };
      switch (op.kind) {
        case "create":
          result.creates.push(entry);
          break;
        case "skip_identical":
        case "skip_non_airline":
          result.identical.push(entry);
          break;
        case "update_conflict":
          result.conflicts.push(entry);
          break;
        case "edited_conflict":
          result.editedConflicts.push(entry);
          break;
        case "delete_missing":
          result.deletions.push(entry);
          break;
      }
    });
    return result;
  }, [plan]);

  if (!plan) return null;

  const getAcceptance = (index: number, defaultValue: boolean): boolean =>
    acceptance.has(index) ? acceptance.get(index)! : defaultValue;

  const setAcceptanceFor = (index: number, value: boolean) => {
    const next = new Map(acceptance);
    next.set(index, value);
    setAcceptance(next);
  };

  const handleConfirm = () => {
    const updatedOperations = plan.operations.map((op, index) => {
      if (
        op.kind === "create" ||
        op.kind === "skip_identical" ||
        op.kind === "skip_non_airline"
      ) {
        return { ...op, accepted: true };
      }
      return { ...op, accepted: getAcceptance(index, false) };
    });
    onConfirm({ ...plan, operations: updatedOperations });
  };

  const acceptedConflictCount =
    partitioned.conflicts.filter((e) => getAcceptance(e.index, false)).length +
    partitioned.editedConflicts.filter((e) => getAcceptance(e.index, false))
      .length;
  const acceptedDeletionCount = partitioned.deletions.filter((e) =>
    getAcceptance(e.index, false)
  ).length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Review Roster Import</DialogTitle>
          <DialogDescription>
            {plan.dateRange.start} – {plan.dateRange.end} •{" "}
            {plan.timeReference} source
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          <SummaryBar
            creates={partitioned.creates.length}
            identical={partitioned.identical.length}
            conflicts={partitioned.conflicts.length}
            editedConflicts={partitioned.editedConflicts.length}
            deletions={partitioned.deletions.length}
          />

          {partitioned.creates.length > 0 && (
            <Section title="New flights" icon={<Plus className="h-4 w-4" />}>
              <p className="text-xs text-muted-foreground mb-3">
                These will be created automatically.
              </p>
              <div className="space-y-1">
                {partitioned.creates.slice(0, 10).map(({ op }) =>
                  op.kind === "create" ? (
                    <CreateRow key={op.sector.sourceLine} sector={op.sector} />
                  ) : null
                )}
                {partitioned.creates.length > 10 && (
                  <p className="text-xs text-muted-foreground pl-6">
                    …and {partitioned.creates.length - 10} more
                  </p>
                )}
              </div>
            </Section>
          )}

          {partitioned.conflicts.length > 0 && (
            <Section
              title={`Time conflicts (${partitioned.conflicts.length})`}
              icon={<Edit3 className="h-4 w-4" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                Check a row to overwrite the existing flight with roster times.
              </p>
              <div className="space-y-2">
                {partitioned.conflicts.map(({ op, index }) =>
                  op.kind === "update_conflict" ? (
                    <ConflictRow
                      key={op.flight.id}
                      op={op}
                      checked={getAcceptance(index, false)}
                      onCheckedChange={(v) => setAcceptanceFor(index, v)}
                    />
                  ) : null
                )}
              </div>
            </Section>
          )}

          {partitioned.editedConflicts.length > 0 && (
            <Section
              title={`Edited flights (${partitioned.editedConflicts.length})`}
              icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                These flights have your edits (signatures, remarks, or
                post-sync changes). Accepting will overwrite those edits.
              </p>
              <div className="space-y-2">
                {partitioned.editedConflicts.map(({ op, index }) =>
                  op.kind === "edited_conflict" ? (
                    <EditedConflictRow
                      key={op.flight.id}
                      op={op}
                      checked={getAcceptance(index, false)}
                      onCheckedChange={(v) => setAcceptanceFor(index, v)}
                    />
                  ) : null
                )}
              </div>
            </Section>
          )}

          {partitioned.deletions.length > 0 && (
            <Section
              title={`Missing from roster (${partitioned.deletions.length})`}
              icon={<Trash2 className="h-4 w-4" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                These Scoot-numbered flights are in your logbook but not in
                this roster. Check to delete.
              </p>
              <div className="space-y-2">
                {partitioned.deletions.map(({ op, index }) =>
                  op.kind === "delete_missing" ? (
                    <DeletionRow
                      key={op.flight.id}
                      op={op}
                      checked={getAcceptance(index, false)}
                      onCheckedChange={(v) => setAcceptanceFor(index, v)}
                    />
                  ) : null
                )}
              </div>
            </Section>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Import {partitioned.creates.length} new
            {acceptedConflictCount > 0 &&
              `, update ${acceptedConflictCount}`}
            {acceptedDeletionCount > 0 &&
              `, delete ${acceptedDeletionCount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function SummaryBar({
  creates,
  identical,
  conflicts,
  editedConflicts,
  deletions,
}: {
  creates: number;
  identical: number;
  conflicts: number;
  editedConflicts: number;
  deletions: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {creates > 0 && (
        <Badge variant="default" className="bg-green-600">
          {creates} new
        </Badge>
      )}
      {identical > 0 && (
        <Badge variant="secondary">{identical} unchanged</Badge>
      )}
      {conflicts > 0 && <Badge variant="outline">{conflicts} differ</Badge>}
      {editedConflicts > 0 && (
        <Badge variant="outline" className="border-amber-500 text-amber-700">
          {editedConflicts} edited
        </Badge>
      )}
      {deletions > 0 && (
        <Badge variant="outline" className="border-red-500 text-red-700">
          {deletions} orphan
        </Badge>
      )}
    </div>
  );
}

function CreateRow({
  sector,
}: {
  sector: { flightNumber: string; date: string; departureIata: string; arrivalIata: string };
}) {
  return (
    <div className="text-xs pl-6 text-muted-foreground">
      {sector.date} · {sector.flightNumber} · {sector.departureIata}→
      {sector.arrivalIata}
    </div>
  );
}

function ConflictRow({
  op,
  checked,
  onCheckedChange,
}: {
  op: Extract<AcceptableOperation, { kind: "update_conflict" }>;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {op.flight.date} · {op.flight.flightNumber} ·{" "}
          {op.flight.departureIata}→{op.flight.arrivalIata}
        </div>
        <div className="mt-1 space-y-0.5">
          {op.changes.map((change) => (
            <div
              key={change.field}
              className="text-xs text-muted-foreground flex items-center gap-1"
            >
              <span className="font-mono">{change.field}:</span>
              <span className="font-mono">{change.from || "—"}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="font-mono text-foreground">{change.to}</span>
            </div>
          ))}
        </div>
      </div>
    </label>
  );
}

function EditedConflictRow({
  op,
  checked,
  onCheckedChange,
}: {
  op: Extract<AcceptableOperation, { kind: "edited_conflict" }>;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const reasonLabel = (r: string) => {
    switch (r) {
      case "has_signature":
        return "signed";
      case "user_modified_after_sync":
        return "edited after sync";
      case "has_remarks":
        return "has remarks";
      default:
        return r;
    }
  };
  return (
    <label className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer border-l-2 border-amber-500">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-2">
          {op.flight.date} · {op.flight.flightNumber} ·{" "}
          {op.flight.departureIata}→{op.flight.arrivalIata}
          <div className="flex gap-1">
            {op.editReasons.map((r) => (
              <Badge
                key={r}
                variant="outline"
                className="text-[10px] border-amber-500 text-amber-700"
              >
                {reasonLabel(r)}
              </Badge>
            ))}
          </div>
        </div>
        <div className="mt-1 space-y-0.5">
          {op.changes.map((change) => (
            <div
              key={change.field}
              className="text-xs text-muted-foreground flex items-center gap-1"
            >
              <span className="font-mono">{change.field}:</span>
              <span className="font-mono">{change.from || "—"}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="font-mono text-foreground">{change.to}</span>
            </div>
          ))}
        </div>
      </div>
    </label>
  );
}

function DeletionRow({
  op,
  checked,
  onCheckedChange,
}: {
  op: Extract<AcceptableOperation, { kind: "delete_missing" }>;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          {op.flight.date} · {op.flight.flightNumber} ·{" "}
          {op.flight.departureIata}→{op.flight.arrivalIata}
        </div>
      </div>
    </label>
  );
}
