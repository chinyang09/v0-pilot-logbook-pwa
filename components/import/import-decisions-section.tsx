/**
 * Import decisions — the in-app place to reverse a call made during an import.
 *
 * The review modal is where a decision gets made, but it only appears when a
 * report is being uploaded. This section lives on the flight itself, so a
 * decision can be undone at any point inside the retention window without
 * needing another report to hand.
 *
 * Two directions, both reversible:
 *   • you declined a report value → take it after all
 *   • you accepted a change that overwrote your entry → put yours back
 *
 * Only renders when the flight has decisions still inside the window; expired
 * ones are pruned on the next write, so the section disappears on its own.
 */

"use client";

import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { liveDecisions } from "@/lib/utils/roster/import-decisions";
import type { FlightLog } from "@/types/entities/flight.types";

/** Fields carrying a number, so a reverted value is stored as one. */
const NUMERIC_FIELDS = new Set([
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
  "departureTimezone",
  "arrivalTimezone",
]);

const FIELD_LABELS: Record<string, string> = {
  scheduledOut: "Scheduled out",
  scheduledIn: "Scheduled in",
  outTime: "Out",
  inTime: "In",
  offTime: "Off",
  onTime: "On",
  blockTime: "Block time",
  flightNumber: "Flight number",
  aircraftReg: "Registration",
  aircraftType: "Aircraft type",
  departureIata: "From",
  arrivalIata: "To",
  picName: "PIC",
  sicName: "SIC",
  pilotFlying: "Pilot flying",
  pilotRole: "Role",
  remarks: "Remarks",
  dayTakeoffs: "Day takeoffs",
  nightTakeoffs: "Night takeoffs",
  dayLandings: "Day landings",
  nightLandings: "Night landings",
};

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Stored pilotFlying is a boolean; pilots read it as PF / PM. */
function displayValue(field: string, value: string): string {
  if (field === "pilotFlying") return value === "true" ? "PF" : "PM";
  return value || "—";
}

function decidedAgo(at: number): string {
  const days = Math.max(0, Math.round((Date.now() - at) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export interface DecisionRow {
  field: string;
  /** What the flight holds now. */
  current: string;
  /** What reverting would set it to. */
  target: string;
  direction: "take_report" | "restore_yours";
  at: number;
}

/** Reversible decisions on a flight, newest first. Empty when there are none. */
export function decisionRowsFor(flight: Partial<FlightLog>): DecisionRow[] {
  const decisions = liveDecisions(flight);
  if (!decisions) return [];

  const rows: DecisionRow[] = [];
  for (const [field, decision] of Object.entries(decisions)) {
    const current = String(
      (flight as unknown as Record<string, unknown>)[field] ?? ""
    );
    // `replaced` first: if a field carries both, the value the user lost is the
    // more useful thing to offer back.
    const target = decision.replaced ?? decision.declined;
    if (target === undefined || target === current) continue;
    rows.push({
      field,
      current,
      target,
      direction:
        decision.replaced !== undefined ? "restore_yours" : "take_report",
      at: decision.at,
    });
  }
  return rows.sort((a, b) => b.at - a.at);
}

export function ImportDecisionsSection({
  flight,
  onRevert,
}: {
  /** The flight being edited — a form's in-progress draft is fine. */
  flight: Partial<FlightLog>;
  /**
   * Apply one reversal: write `value` to `field` and drop that field's memory.
   * The caller owns persistence (the flight form's normal save path).
   */
  onRevert: (field: string, value: string | number | boolean) => void;
}) {
  const rows = decisionRowsFor(flight);
  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="bg-muted/30 px-4 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Import decisions
        </h2>
      </div>

      {rows.map((row) => (
        <div
          key={row.field}
          className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{labelFor(row.field)}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {row.direction === "restore_yours"
                ? "Took the report's value"
                : "Kept yours"}
              {" · "}
              {decidedAgo(row.at)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="text-right text-xs tabular-nums">
              <span className="text-muted-foreground/60 line-through decoration-muted-foreground/40">
                {displayValue(row.field, row.current)}
              </span>{" "}
              <span className="font-semibold text-primary">
                {displayValue(row.field, row.target)}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-xs text-primary"
              onClick={() =>
                onRevert(
                  row.field,
                  NUMERIC_FIELDS.has(row.field)
                    ? Number(row.target) || 0
                    : row.field === "pilotFlying"
                      ? row.target === "true"
                      : row.target
                )
              }
            >
              <Undo2 className="size-3.5" aria-hidden />
              Undo
            </Button>
          </div>
        </div>
      ))}

      <p className="px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Kept for 90 days after the decision, then cleared automatically.
      </p>
    </div>
  );
}
