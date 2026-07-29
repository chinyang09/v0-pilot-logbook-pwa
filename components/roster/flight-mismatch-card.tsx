/**
 * Flight mismatch card — how a pilot-vs-company difference is shown on the
 * discrepancies page.
 *
 * Built on the same `FlightCardBody` the logbook and the import review use, so
 * a discrepancy reads as a flight first and a difference second. Replaces the
 * prose card ("Time Mismatch — Times differ between schedule and logbook"),
 * which said nothing about which values actually differed.
 *
 * Each differing field is one row with both sides side by side: what you have
 * and what the company reported. The side the flight currently holds is the
 * solid one; the other is muted and tappable, so switching is a single tap in
 * either direction — this is where an import decision gets undone, and it
 * stays available whether the change was accepted or rejected at import time.
 *
 * Once a row holds the COMPANY's value it is no longer a standing difference,
 * only a change that is still undoable, so it moves to the Accepted tab and the
 * card carries the time left on that (see `lib/utils/retention.ts`). The card
 * is the same either way — what changes is the footer, because "you can still
 * put this back, for 74 more days" is the fact the user needs there.
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { FlightCardBody } from "@/components/flight-card-body";
import { OptionPair } from "@/components/import/option-pair";
import { retentionDaysLeft, retentionLabel } from "@/lib/utils/retention";
import type { Discrepancy } from "@/types/entities/roster.types";
import type { FlightLog } from "@/types/entities/flight.types";
import type { DisplayPreferences } from "@/types/db/stores.types";

const FIELD_LABELS: Record<string, string> = {
  pilotFlying: "Pilot flying",
  pilotRole: "Role",
  dayTakeoffs: "Day takeoffs",
  nightTakeoffs: "Night takeoffs",
  dayLandings: "Day landings",
  nightLandings: "Night landings",
};

/** Stored pilotFlying is a boolean string; pilots read it as PF / PM. */
function displayValue(field: string, value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  if (field === "pilotFlying") return value === "true" ? "PF" : "PM";
  return value;
}

export interface MismatchGroup {
  flight: FlightLog;
  rows: Discrepancy[];
}

/**
 * Group mismatch discrepancies by flight so one card covers everything that
 * differs on that sector, newest flight first.
 */
export function groupMismatches(
  discrepancies: Discrepancy[],
  flightsById: Map<string, FlightLog>
): MismatchGroup[] {
  const byFlight = new Map<string, Discrepancy[]>();
  for (const d of discrepancies) {
    if (!d.flightLogId) continue;
    const list = byFlight.get(d.flightLogId) ?? [];
    list.push(d);
    byFlight.set(d.flightLogId, list);
  }

  const groups: MismatchGroup[] = [];
  for (const [flightId, rows] of byFlight) {
    const flight = flightsById.get(flightId);
    // The flight was deleted — nothing to compare against any more.
    if (!flight) continue;
    groups.push({
      flight,
      rows: rows.sort((a, b) => (a.field ?? "").localeCompare(b.field ?? "")),
    });
  }
  return groups.sort((a, b) => b.flight.date.localeCompare(a.flight.date));
}

export function FlightMismatchCard({
  group,
  displayPrefs,
  onHoldingChange,
}: {
  group: MismatchGroup;
  displayPrefs?: DisplayPreferences;
  /**
   * Switch which side a field holds. The caller writes the value to the
   * flight and updates the discrepancy row.
   */
  onHoldingChange: (
    discrepancy: Discrepancy,
    holding: "logbook" | "schedule"
  ) => void;
}) {
  const { flight, rows } = group;

  // Nothing is struck through on this card: both values stay readable because
  // the point is the comparison, not a pending change.
  const noDiffs = useMemo(() => new Map(), []);

  // The soonest expiry across the card's rows — that is the deadline the user
  // is actually working to, since after it that field can't be put back.
  const acceptedAt = useMemo(() => {
    const stamps = rows
      .map((r) => r.acceptedAt)
      .filter((v): v is number => v !== undefined);
    return stamps.length ? Math.min(...stamps) : undefined;
  }, [rows]);
  const holdsOwn = rows.some((r) => r.holding === "logbook");

  return (
    <div
      className={cn(
        "rounded-xl border border-l-2 bg-card px-3 py-2",
        holdsOwn ? "border-l-status-warning" : "border-l-border"
      )}
    >
      <FlightCardBody
        flight={flight}
        displayPrefs={displayPrefs}
        diffs={noDiffs}
        showLandingChips={false}
        showStatusIcons={false}
        showPilotRole={false}
      />

      <div className="mt-2 space-y-1.5">
        {rows.map((row) => {
          const holdingCompany = row.holding === "schedule";
          return (
            <div
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5"
            >
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {FIELD_LABELS[row.field ?? ""] ?? row.field}
              </span>
              <OptionPair
                left={{
                  caption: "Yours",
                  value: displayValue(row.field ?? "", row.logbookValue),
                }}
                right={{
                  caption: "Company",
                  value: displayValue(row.field ?? "", row.scheduleValue),
                }}
                rightActive={holdingCompany}
                onChange={(right) =>
                  onHoldingChange(row, right ? "schedule" : "logbook")
                }
                size="sm"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px]">
        <p className={holdsOwn ? "text-muted-foreground" : "text-muted-foreground/70"}>
          {holdsOwn
            ? "Your entry is on record; the company's figure is kept alongside it."
            : "The company's figure is on record. Tap yours to put it back."}
        </p>
        {!holdsOwn && acceptedAt !== undefined && (
          <span
            className={cn(
              "shrink-0 tabular-nums",
              retentionDaysLeft(acceptedAt) <= 7
                ? "text-status-warning"
                : "text-muted-foreground/70"
            )}
          >
            {retentionLabel(acceptedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
