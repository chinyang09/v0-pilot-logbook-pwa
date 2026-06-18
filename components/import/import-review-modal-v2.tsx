/**
 * Unified import review modal — v2.
 *
 * Adds an "Auto-applied safe updates" summary section (read-only) and a
 * "Past flight updates needing your consent" section for `update_consult`.
 * Existing edited-conflicts and missing-from-roster sections are preserved.
 *
 * Stale-report skips appear in a collapsible audit section so the user can
 * see exactly what didn't get overwritten.
 */

"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Edit3,
  History,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  AcceptableOperation,
  PlannedImport,
} from "@/lib/utils/parsers/schedule-parser";
import { usePreferences } from "@/components/providers/preferences-provider";
import { getAirportDisplayCode } from "@/lib/utils/airport-display";

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
  | "stale"
  | "identical";

type Entry = { op: AcceptableOperation; index: number };

type AirportPref = "icao" | "iata" | "both";

function depDisplay(
  flight: { departureIcao?: string; departureIata?: string },
  pref: AirportPref
): string {
  return getAirportDisplayCode(flight.departureIcao, flight.departureIata, pref);
}
function arrDisplay(
  flight: { arrivalIcao?: string; arrivalIata?: string },
  pref: AirportPref
): string {
  return getAirportDisplayCode(flight.arrivalIcao, flight.arrivalIata, pref);
}

export function ImportReviewModalV2({
  plan,
  isOpen,
  onConfirm,
  onCancel,
}: Props) {
  const [acceptance, setAcceptance] = useState<Map<number, boolean>>(new Map());
  const { preferences } = usePreferences();
  const airportPref = preferences.display.airportIdentifier;

  const partitioned = useMemo(() => {
    const out: Record<Bucket, Entry[]> = {
      creates: [],
      safe: [],
      consult: [],
      edited: [],
      deletions: [],
      stale: [],
      identical: [],
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
          out.stale.push(entry);
          break;
        case "skip_identical":
        case "skip_non_airline":
          out.identical.push(entry);
          break;
      }
    });
    return out;
  }, [plan]);

  if (!plan) return null;

  const getAccept = (index: number, defaultValue: boolean) =>
    acceptance.has(index) ? acceptance.get(index)! : defaultValue;

  const setAccept = (index: number, value: boolean) => {
    const next = new Map(acceptance);
    next.set(index, value);
    setAcceptance(next);
  };

  const handleConfirm = () => {
    const updatedOperations = plan.operations.map((op, index) => {
      if (
        op.kind === "create" ||
        op.kind === "skip_identical" ||
        op.kind === "skip_non_airline" ||
        op.kind === "skip_stale_report" ||
        op.kind === "update_safe"
      ) {
        return { ...op, accepted: true };
      }
      return { ...op, accepted: getAccept(index, false) };
    });
    onConfirm({ ...plan, operations: updatedOperations });
  };

  const consultAccepted = partitioned.consult.filter((e) =>
    getAccept(e.index, false)
  ).length;
  const editedAccepted = partitioned.edited.filter((e) =>
    getAccept(e.index, false)
  ).length;
  const deleteAccepted = partitioned.deletions.filter((e) =>
    getAccept(e.index, false)
  ).length;

  const generatedDate = plan.generatedAt
    ? new Date(plan.generatedAt).toLocaleString(undefined, {
        timeZone: "UTC",
      })
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        // Raise above the floating nav pill (z-[100]) so the modal header
        // isn't hidden behind it. Constrain to the visible viewport with
        // safe-area insets top + bottom so it never extends under the nav
        // pill or the mobile bottom nav.
        className="z-[110] flex max-w-3xl flex-col p-4 sm:p-6 max-h-[calc(100dvh-7rem)] top-[calc(env(safe-area-inset-top)+4.5rem)] translate-y-0 sm:top-[50%] sm:-translate-y-1/2"
        overlayClassName="z-[105]"
      >
        <DialogHeader>
          <DialogTitle>Review Import</DialogTitle>
          <DialogDescription>
            {plan.dateRange.start} – {plan.dateRange.end}
            {generatedDate ? ` • Generated ${generatedDate} UTC` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          <SummaryBar
            creates={partitioned.creates.length}
            safe={partitioned.safe.length}
            consult={partitioned.consult.length}
            edited={partitioned.edited.length}
            deletions={partitioned.deletions.length}
            stale={partitioned.stale.length}
            identical={partitioned.identical.length}
          />

          {partitioned.creates.length > 0 && (
            <Section
              title={`New flights (${partitioned.creates.length})`}
              icon={<Plus className="h-4 w-4" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                These will be created automatically.
              </p>
              <div className="space-y-1">
                {partitioned.creates.slice(0, 12).map(({ op, index }) =>
                  op.kind === "create" ? (
                    <CreateRow
                      key={`${index}-${op.sector.sourceLine}`}
                      sector={op.sector}
                      airportPref={airportPref}
                    />
                  ) : null
                )}
                {partitioned.creates.length > 12 && (
                  <p className="text-xs text-muted-foreground pl-6">
                    …and {partitioned.creates.length - 12} more
                  </p>
                )}
              </div>
            </Section>
          )}

          {partitioned.safe.length > 0 && (
            <Section
              title={`Auto-applied safe updates (${partitioned.safe.length})`}
              icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                Future flights and existing flights with only crew/route metadata
                changes are updated automatically.
              </p>
              <div className="space-y-2">
                {partitioned.safe.slice(0, 12).map(({ op, index }) =>
                  op.kind === "update_safe" ? (
                    <DiffRow
                      key={`${index}-${op.flight.id}`}
                      op={op}
                      airportPref={airportPref}
                    />
                  ) : null
                )}
                {partitioned.safe.length > 12 && (
                  <p className="text-xs text-muted-foreground pl-6">
                    …and {partitioned.safe.length - 12} more
                  </p>
                )}
              </div>
            </Section>
          )}

          {partitioned.consult.length > 0 && (
            <Section
              title={`Past flight updates needing your consent (${partitioned.consult.length})`}
              icon={<Edit3 className="h-4 w-4" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                These already-flown flights have critical-field differences.
                Check rows you want to overwrite.
              </p>
              <div className="space-y-2">
                {partitioned.consult.map(({ op, index }) =>
                  op.kind === "update_consult" ||
                  op.kind === "update_conflict" ? (
                    <ConsentRow
                      key={`${index}-${op.flight.id}`}
                      op={op}
                      checked={getAccept(index, false)}
                      onCheckedChange={(v) => setAccept(index, v)}
                      airportPref={airportPref}
                    />
                  ) : null
                )}
              </div>
            </Section>
          )}

          {partitioned.edited.length > 0 && (
            <Section
              title={`Edited flights (${partitioned.edited.length})`}
              icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
            >
              <p className="text-xs text-muted-foreground mb-3">
                These flights have your edits (signatures, remarks, manual
                overrides). Accepting will overwrite those edits.
              </p>
              <div className="space-y-2">
                {partitioned.edited.map(({ op, index }) =>
                  op.kind === "edited_conflict" ? (
                    <EditedRow
                      key={`${index}-${op.flight.id}`}
                      op={op}
                      checked={getAccept(index, false)}
                      onCheckedChange={(v) => setAccept(index, v)}
                      airportPref={airportPref}
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
                These TR-numbered flights are in your logbook but not in this
                report. Check to delete.
              </p>
              <div className="space-y-2">
                {partitioned.deletions.map(({ op, index }) =>
                  op.kind === "delete_missing" ? (
                    <DeletionRow
                      key={`${index}-${op.flight.id}`}
                      op={op}
                      checked={getAccept(index, false)}
                      onCheckedChange={(v) => setAccept(index, v)}
                      airportPref={airportPref}
                    />
                  ) : null
                )}
              </div>
            </Section>
          )}

          {partitioned.stale.length > 0 && (
            <CollapsibleSection
              title={`Skipped — older report (${partitioned.stale.length})`}
              icon={<History className="h-4 w-4 text-muted-foreground" />}
              hint="Existing flights came from a newer report than this one."
            >
              <div className="space-y-2">
                {partitioned.stale.map(({ op, index }) =>
                  op.kind === "skip_stale_report" ? (
                    <StaleRow
                      key={`${index}-${op.flight.id}`}
                      op={op}
                      airportPref={airportPref}
                    />
                  ) : null
                )}
              </div>
            </CollapsibleSection>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Import {partitioned.creates.length} new
            {partitioned.safe.length > 0 &&
              `, ${partitioned.safe.length} safe`}
            {consultAccepted > 0 && `, ${consultAccepted} consulted`}
            {editedAccepted > 0 && `, ${editedAccepted} edited`}
            {deleteAccepted > 0 && `, delete ${deleteAccepted}`}
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

function CollapsibleSection({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-semibold flex items-center gap-2 mb-2 hover:underline"
      >
        {icon}
        {title}
        <ArrowRight
          className={
            "h-3 w-3 opacity-50 transition-transform " +
            (open ? "rotate-90" : "")
          }
        />
      </button>
      {hint && !open && (
        <p className="text-xs text-muted-foreground mb-3">{hint}</p>
      )}
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

function SummaryBar(props: {
  creates: number;
  safe: number;
  consult: number;
  edited: number;
  deletions: number;
  stale: number;
  identical: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {props.creates > 0 && (
        <Badge variant="default" className="bg-green-600">
          {props.creates} new
        </Badge>
      )}
      {props.safe > 0 && (
        <Badge variant="secondary" className="bg-blue-100 text-blue-900">
          {props.safe} safe updates
        </Badge>
      )}
      {props.consult > 0 && (
        <Badge variant="outline">{props.consult} need consent</Badge>
      )}
      {props.edited > 0 && (
        <Badge variant="outline" className="border-amber-500 text-amber-700">
          {props.edited} edited
        </Badge>
      )}
      {props.deletions > 0 && (
        <Badge variant="outline" className="border-red-500 text-red-700">
          {props.deletions} orphan
        </Badge>
      )}
      {props.stale > 0 && (
        <Badge variant="outline" className="text-muted-foreground">
          {props.stale} stale-skipped
        </Badge>
      )}
      {props.identical > 0 && (
        <Badge variant="secondary">{props.identical} unchanged</Badge>
      )}
    </div>
  );
}

function CreateRow({
  sector,
  airportPref,
}: {
  sector: {
    flightNumber: string;
    date: string;
    departureIata: string;
    arrivalIata: string;
    departureIcao?: string;
    arrivalIcao?: string;
  };
  airportPref: AirportPref;
}) {
  return (
    <div className="text-xs pl-6 text-muted-foreground">
      {sector.date} · {sector.flightNumber || "—"} ·{" "}
      {depDisplay(sector, airportPref)}→{arrDisplay(sector, airportPref)}
    </div>
  );
}

function DiffRow({
  op,
  airportPref,
}: {
  op: Extract<AcceptableOperation, { kind: "update_safe" }>;
  airportPref: AirportPref;
}) {
  return (
    <div className="pl-6 border-l-2 border-blue-200 py-1">
      <div className="text-sm font-medium">
        {op.flight.date} · {op.flight.flightNumber || "—"} ·{" "}
        {depDisplay(op.flight, airportPref)}→{arrDisplay(op.flight, airportPref)}
        {op.flight.outTime && op.flight.inTime && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {op.flight.outTime}Z – {op.flight.inTime}Z
          </span>
        )}
      </div>
      <SunCheck op={op} />
      <ChangeList changes={op.changes} />
    </div>
  );
}

function ConsentRow({
  op,
  checked,
  onCheckedChange,
  airportPref,
}: {
  op: Extract<
    AcceptableOperation,
    { kind: "update_consult" } | { kind: "update_conflict" }
  >;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  airportPref: AirportPref;
}) {
  return (
    <label className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {op.flight.date} · {op.flight.flightNumber || "—"} ·{" "}
          {depDisplay(op.flight, airportPref)}→{arrDisplay(op.flight, airportPref)}
          {op.flight.outTime && op.flight.inTime && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {op.flight.outTime}Z – {op.flight.inTime}Z
            </span>
          )}
        </div>
        <SunCheck op={op} />
        <ChangeList changes={op.changes} />
      </div>
    </label>
  );
}

function EditedRow({
  op,
  checked,
  onCheckedChange,
  airportPref,
}: {
  op: Extract<AcceptableOperation, { kind: "edited_conflict" }>;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  airportPref: AirportPref;
}) {
  const reasonLabel = (r: string) => {
    switch (r) {
      case "has_signature":
        return "signed";
      case "user_modified_after_sync":
        return "edited after sync";
      case "has_remarks":
        return "has remarks";
      case "has_manual_overrides":
        return "manual overrides";
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
        <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
          {op.flight.date} · {op.flight.flightNumber || "—"} ·{" "}
          {depDisplay(op.flight, airportPref)}→{arrDisplay(op.flight, airportPref)}
          {op.flight.outTime && op.flight.inTime && (
            <span className="text-xs font-normal text-muted-foreground">
              {op.flight.outTime}Z – {op.flight.inTime}Z
            </span>
          )}
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
        <SunCheck op={op} />
        <ChangeList changes={op.changes} />
      </div>
    </label>
  );
}

function DeletionRow({
  op,
  checked,
  onCheckedChange,
  airportPref,
}: {
  op: Extract<AcceptableOperation, { kind: "delete_missing" }>;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  airportPref: AirportPref;
}) {
  return (
    <label className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      />
      <div className="text-sm">
        {op.flight.date} · {op.flight.flightNumber} ·{" "}
        {depDisplay(op.flight, airportPref)}→{arrDisplay(op.flight, airportPref)}
      </div>
    </label>
  );
}

function StaleRow({
  op,
  airportPref,
}: {
  op: Extract<AcceptableOperation, { kind: "skip_stale_report" }>;
  airportPref: AirportPref;
}) {
  return (
    <div className="text-xs pl-6 text-muted-foreground">
      {op.flight.date} · {op.flight.flightNumber || "—"} ·{" "}
      {depDisplay(op.flight, airportPref)}→{arrDisplay(op.flight, airportPref)}
      <span className="ml-2 opacity-70">
        existing report{" "}
        {new Date(op.existingGeneratedAt).toLocaleString(undefined, {
          timeZone: "UTC",
          dateStyle: "medium",
          timeStyle: "short",
        })}{" "}
        &gt; this report{" "}
        {new Date(op.reportGeneratedAt).toLocaleString(undefined, {
          timeZone: "UTC",
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </span>
    </div>
  );
}

/**
 * Day/night cutoff summary for a flight, shown whenever a TO/LDG diff is
 * present so the user can sanity-check whether the imported value or the
 * sun-position calc is right. Reads the pre-computed context the logbook
 * parser attached to the sector.
 */
function SunCheck({
  op,
}: {
  op: AcceptableOperation;
}) {
  if (
    op.kind !== "update_safe" &&
    op.kind !== "update_consult" &&
    op.kind !== "update_conflict" &&
    op.kind !== "edited_conflict"
  ) {
    return null;
  }
  const ctx = op.sector?.toLdgContext;
  if (!ctx) return null;

  const hasToLdgChange = op.changes.some((c) =>
    ["dayTakeoffs", "nightTakeoffs", "dayLandings", "nightLandings"].includes(
      c.field
    )
  );
  if (!hasToLdgChange) return null;

  const tz = (n?: number) =>
    n === undefined ? "" : ` (UTC${n >= 0 ? "+" : ""}${n})`;
  const bounds = (rise?: string | null, set?: string | null) => {
    const parts: string[] = [];
    if (rise) parts.push(`sunrise ${rise}Z`);
    if (set) parts.push(`sunset ${set}Z`);
    return parts.length ? ` · ${parts.join(", ")}` : "";
  };

  return (
    <div className="mt-1 mb-1 rounded bg-muted/40 px-2 py-1 text-[11px] leading-relaxed">
      <div className="font-medium text-foreground/80">Day/night check</div>
      <div className="text-muted-foreground">
        OUT {ctx.outUtc}Z
        {ctx.depLocal ? ` / ${ctx.depLocal} local${tz(ctx.depTzOffset)}` : ""} @{" "}
        {op.sector.departureIata} →{" "}
        <span
          className={
            ctx.depSunStatus === "night"
              ? "text-indigo-500 dark:text-indigo-300 font-medium"
              : "text-amber-600 dark:text-amber-400 font-medium"
          }
        >
          {ctx.depSunStatus ?? "?"}
        </span>
        {bounds(ctx.depSunriseUtc, ctx.depSunsetUtc)}
      </div>
      <div className="text-muted-foreground">
        IN {ctx.inUtc}Z
        {ctx.arrLocal ? ` / ${ctx.arrLocal} local${tz(ctx.arrTzOffset)}` : ""} @{" "}
        {op.sector.arrivalIata} →{" "}
        <span
          className={
            ctx.arrSunStatus === "night"
              ? "text-indigo-500 dark:text-indigo-300 font-medium"
              : "text-amber-600 dark:text-amber-400 font-medium"
          }
        >
          {ctx.arrSunStatus ?? "?"}
        </span>
        {bounds(ctx.arrSunriseUtc, ctx.arrSunsetUtc)}
      </div>
    </div>
  );
}

function ChangeList({
  changes,
}: {
  changes: Array<{ field: string; from: string; to: string; note?: string }>;
}) {
  return (
    <div className="mt-1 space-y-0.5">
      {changes.map((change) => (
        <div
          key={change.field}
          className="text-xs text-muted-foreground"
        >
          <div className="flex items-center gap-1">
            <span className="font-mono">{change.field}:</span>
            <span className="font-mono">{change.from || "—"}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="font-mono text-foreground">{change.to}</span>
          </div>
          {change.note && (
            <div className="pl-3 text-[11px] italic text-amber-700 dark:text-amber-400">
              {change.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
