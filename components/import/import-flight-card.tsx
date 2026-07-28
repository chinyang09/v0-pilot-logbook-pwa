/**
 * Import review — flight card.
 *
 * Renders an import operation using the SAME `FlightCardBody` the logbook list
 * uses, so a pending change looks like the flight it will become. Slots that
 * change show the old value struck through in grey ahead of the new value in
 * the accent colour.
 *
 * Two deliberate departures from the logbook card:
 *   - no PF/PM and no day/night landing chips (the split is decided by our own
 *     sun calculator, so echoing the company's counts would be misleading);
 *   - a day/night flag appears only when our calculation disagrees with the
 *     company's report, carrying the sunrise/sunset evidence and an explicit
 *     opt-in for the rare case the user wants the company's figures instead.
 */

"use client";

import { PencilLine, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { SunTimeline, DayNightChoice } from "./sun-timeline";
import { allowedRolesFor } from "@/lib/utils/roster/pilot-role";
import type { PilotRole } from "@/types/entities/flight.types";
import type { FieldDiff } from "@/lib/utils/roster/reconciler";
import type { AcceptableOperation } from "@/lib/utils/parsers/schedule-parser";
import type { FlightLog } from "@/types/entities/flight.types";
import type { DisplayPreferences } from "@/types/db/stores.types";
import { FlightCardBody } from "@/components/flight-card-body";
import { OptionPair } from "./option-pair";
import { getAirportDisplayCode } from "@/lib/utils/airport-display";

/** Field slots the card body already draws. */
const CHROME_FIELDS = new Set([
  "flightNumber",
  "departureIata",
  "arrivalIata",
  "outTime",
  "inTime",
  "scheduledOut",
  "scheduledIn",
  "blockTime",
  "aircraftReg",
  "aircraftType",
  "picName",
  "sicName",
  // Rendered as PF/PM in the card's bottom-right slot.
  "pilotFlying",
  // Rendered by the RoleChoice picker.
  "pilotRole",
]);

/**
 * Never surfaced as a change chip: internal plumbing, plus the fields the
 * import card intentionally doesn't reflect (pilot flying, and the day/night
 * takeoff & landing counts — those are flagged separately when they differ).
 */
const HIDDEN_FIELDS = new Set([
  "picId",
  "sicId",
  "departureIcao",
  "arrivalIcao",
  "departureTimezone",
  "arrivalTimezone",
  "importSource",
  "reportGeneratedAt",
  "scheduleReportAt",
  "logbookReportAt",
  "remarks",
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
]);

const FIELD_LABELS: Record<string, string> = {
  pilotRole: "Role",
  flightTime: "Flight time",
  nightTime: "Night",
  dayTime: "Day",
  picTime: "PIC",
  sicTime: "SIC",
  picusTime: "PICUS",
};

const TOLDG_FIELDS = [
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
] as const;

export type CardTone = "create" | "safe" | "consult" | "conflict" | "delete";

const TONE_ACCENT: Record<CardTone, string> = {
  create: "border-l-status-valid",
  safe: "border-l-status-info",
  consult: "border-l-primary",
  conflict: "border-l-status-warning",
  delete: "border-l-status-error",
};

// ============================================================
// Operation → displayable flight
// ============================================================

const EMPTY_FLIGHT: FlightLog = {
  id: "",
  date: "",
  flightNumber: "",
  aircraftReg: "",
  aircraftType: "",
  departureIcao: "",
  departureIata: "",
  arrivalIcao: "",
  arrivalIata: "",
  departureTimezone: 0,
  arrivalTimezone: 0,
  scheduledOut: "",
  scheduledIn: "",
  outTime: "",
  offTime: "",
  onTime: "",
  inTime: "",
  blockTime: "",
  flightTime: "",
  nightTime: "",
  dayTime: "",
  picId: "",
  picName: "",
  sicId: "",
  sicName: "",
  additionalCrew: [],
  pilotFlying: false,
  pilotRole: "SIC",
  picTime: "",
  sicTime: "",
  picusTime: "",
  dualTime: "",
  instructorTime: "",
  dayTakeoffs: 0,
  dayLandings: 0,
  nightTakeoffs: 0,
  nightLandings: 0,
  autolands: 0,
  remarks: "",
  endorsements: "",
  manualOverrides: {},
  ifrTime: "",
  actualInstrumentTime: "",
  simulatedInstrumentTime: "",
  crossCountryTime: "",
  approaches: [],
  holds: 0,
  ipcIcc: false,
  createdAt: 0,
  syncStatus: "pending",
};

/**
 * The flight to draw. Updates and deletions render the EXISTING flight (the
 * diffs then show what changes); a create has no flight yet, so we project the
 * parsed sector into the same shape.
 */
function displayFlight(op: AcceptableOperation): FlightLog {
  if ("flight" in op && op.flight) return op.flight;
  if (!("sector" in op) || !op.sector) return EMPTY_FLIGHT;

  const s = op.sector;
  const crew = s.crew ?? [];
  const cpt = crew.find((c) => c.role === "CPT" || c.role === "PIC");
  const fo = crew.find((c) => c.role === "FO");

  return {
    ...EMPTY_FLIGHT,
    id: `sector-${s.sourceLine}`,
    date: s.date,
    flightNumber: s.flightNumber || "",
    aircraftReg: s.aircraftReg || "",
    aircraftType: s.aircraftType || "",
    departureIata: s.departureIata || "",
    departureIcao: s.departureIcao || "",
    arrivalIata: s.arrivalIata || "",
    arrivalIcao: s.arrivalIcao || "",
    scheduledOut: s.scheduledOut || "",
    scheduledIn: s.scheduledIn || "",
    outTime: s.actualOut || "",
    inTime: s.actualIn || "",
    blockTime: s.blockTime || "",
    picName: cpt?.name || s.picResolvedName || "",
    sicName: fo?.name || "",
  };
}

// ============================================================
// Day/night discrepancy flag
// ============================================================

/** "day"/"night" verdict implied by a set of day/night counts. */
function verdictFrom(
  diffs: Map<string, FieldDiff>,
  side: "Takeoffs" | "Landings",
  pick: (d: FieldDiff) => string | undefined
): string {
  const night = Number(pick(diffs.get(`night${side}`) as FieldDiff) ?? 0);
  const day = Number(pick(diffs.get(`day${side}`) as FieldDiff) ?? 0);
  if (night > 0 && day === 0) return "Night";
  if (day > 0 && night === 0) return "Day";
  return night > 0 ? "Night" : "Day";
}

/**
 * Shown ONLY when our sun-position calculation disagrees with the company's
 * day/night split. Instead of asserting "differs from company — NIGHT", it
 * draws the day/night bar with the event marked on it, then offers a
 * two-option choice defaulting to our calculation.
 */
function DayNightFlag({
  op,
  diffs,
  useCompany,
  onUseCompanyChange,
  displayPrefs,
}: {
  op: AcceptableOperation;
  diffs: Map<string, FieldDiff>;
  useCompany: boolean;
  onUseCompanyChange?: (v: boolean) => void;
  displayPrefs?: DisplayPreferences;
}) {
  const disagreements = TOLDG_FIELDS.filter(
    (f) => diffs.get(f)?.companyValue !== undefined
  );
  if (disagreements.length === 0) return null;

  const sector = "sector" in op ? op.sector : undefined;
  const ctx = sector?.toLdgContext;
  const sides: Array<"Takeoffs" | "Landings"> = [];
  if (disagreements.some((f) => f.endsWith("Takeoffs"))) sides.push("Takeoffs");
  if (disagreements.some((f) => f.endsWith("Landings"))) sides.push("Landings");

  const airportPref = displayPrefs?.airportIdentifier ?? "icao";

  return (
    <div className="mt-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
      {sides.map((side) => {
        const isTakeoff = side === "Takeoffs";
        return (
          <div key={side} className={cn(sides.length > 1 && "mb-1.5 last:mb-0")}>
            <SunTimeline
              kind={isTakeoff ? "takeoff" : "landing"}
              airport={getAirportDisplayCode(
                isTakeoff ? sector?.departureIcao : sector?.arrivalIcao,
                isTakeoff ? sector?.departureIata : sector?.arrivalIata,
                airportPref
              )}
              eventUtc={isTakeoff ? ctx?.outUtc : ctx?.inUtc}
              sunriseUtc={isTakeoff ? ctx?.depSunriseUtc : ctx?.arrSunriseUtc}
              sunsetUtc={isTakeoff ? ctx?.depSunsetUtc : ctx?.arrSunsetUtc}
              zulu={displayPrefs?.useZuluTime ?? true}
              tzOffsetHours={
                (isTakeoff ? ctx?.depTzOffset : ctx?.arrTzOffset) ?? 0
              }
              // Sits on the header row, so the control is reachable without
              // scrolling past the graphic on a phone.
              action={
                <DayNightChoice
                  ours={verdictFrom(diffs, side, (d) => d?.to)}
                  company={verdictFrom(diffs, side, (d) => d?.companyValue)}
                  useCompany={useCompany}
                  onChange={onUseCompanyChange}
                />
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pilot-flying + role.
 *
 * Two decisions, presented as one block: keep the value already in your
 * logbook, or take the company's. Selecting one dims the other, so which side
 * wins is visible rather than inferred. The role picker only comes alive when
 * the company's PF/PM is accepted — keeping your own record means keeping your
 * own role with it.
 */
function PilotFlyingChoice({
  diffs,
  flight,
  useRecorded,
  onUseRecordedChange,
  roleOverride,
  onRoleChange,
}: {
  diffs: Map<string, FieldDiff>;
  flight: FlightLog;
  useRecorded: boolean;
  onUseRecordedChange?: (v: boolean) => void;
  roleOverride?: PilotRole;
  onRoleChange?: (role: PilotRole) => void;
}) {
  const pfDiff = diffs.get("pilotFlying");
  if (!pfDiff) return null;

  const roleDiff = diffs.get("pilotRole");
  const nowFlying = pfDiff.to === "true";
  const rolesEnabled = !useRecorded && Boolean(roleDiff);
  const selectedRole =
    roleOverride ?? (roleDiff ? (roleDiff.to as PilotRole) : flight.pilotRole);
  const shownRole = useRecorded ? flight.pilotRole : selectedRole;

  return (
    <div className="mt-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pilot flying
        </span>
        <OptionPair
          left={{ caption: "Recorded", value: pfLabel(pfDiff.from) }}
          right={{ caption: "Company", value: pfLabel(pfDiff.to) }}
          rightActive={!useRecorded}
          onChange={
            onUseRecordedChange ? (right) => onUseRecordedChange(!right) : undefined
          }
          size="sm"
        />
      </div>

      {roleDiff && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Role
          </span>
          {allowedRolesFor(nowFlying).map((role) => {
            const active = role === shownRole;
            return (
              <button
                key={role}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!rolesEnabled || !onRoleChange}
                onClick={(e) => {
                  // The card is a <label>; don't toggle its checkbox.
                  e.preventDefault();
                  e.stopPropagation();
                  onRoleChange?.(role);
                }}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground/45",
                  rolesEnabled && !active && "hover:bg-muted/60 hover:text-muted-foreground",
                  !rolesEnabled && "cursor-default"
                )}
              >
                {role}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Stored pilotFlying is a boolean string; pilots read it as PF / PM. */
function pfLabel(v: string): string {
  return v === "true" ? "PF" : "PM";
}

/** "3 weeks ago" style stamp for an earlier import decision. */
function decidedAgo(at: number): string {
  const days = Math.max(0, Math.round((Date.now() - at) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

// ============================================================
// Card
// ============================================================

export function ImportFlightCard({
  op,
  displayPrefs,
  tone,
  checked,
  onCheckedChange,
  useCompany = false,
  onUseCompanyChange,
  roleOverride,
  onRoleChange,
  useRecordedPf = false,
  onUseRecordedPfChange,
  ownEntryLabel,
}: {
  op: AcceptableOperation;
  displayPrefs?: DisplayPreferences;
  tone: CardTone;
  /** Present → the card renders a checkbox and is selectable. */
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  /** Deliberate opt-in to take the company's day/night split for this flight. */
  useCompany?: boolean;
  onUseCompanyChange?: (v: boolean) => void;
  /** Role the user picked for a PF/PM-driven role change, if they overrode it. */
  roleOverride?: PilotRole;
  onRoleChange?: (role: PilotRole) => void;
  /** Keep the pilot-flying value already in the logbook instead of the report's. */
  useRecordedPf?: boolean;
  onUseRecordedPfChange?: (v: boolean) => void;
  /**
   * Set when taking this change would replace something the USER wrote — a
   * signature, remarks or a manual entry. Carries the short reason, shown as a
   * marker on the card. Rows without it only overwrite data a previous import
   * left behind, which costs nothing.
   */
  ownEntryLabel?: string;
}) {
  // A decided row carries no pending `changes` — its reverts ARE the diff to
  // show, so the user can see what ticking it would do.
  const changes: FieldDiff[] =
    op.kind === "skip_decided"
      ? op.reverts
      : "changes" in op && Array.isArray(op.changes)
        ? op.changes
        : [];

  const diffs = new Map<string, FieldDiff>();
  for (const c of changes) diffs.set(c.field, c);

  const flight = displayFlight(op);

  const extraChanges = changes.filter(
    (c) => !CHROME_FIELDS.has(c.field) && !HIDDEN_FIELDS.has(c.field)
  );

  const selectable = typeof onCheckedChange === "function";

  const inner = (
    <>
      {op.kind === "skip_decided" && op.reverts.length > 0 && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Undo2 className="size-3" aria-hidden />
          <span>
            {op.reverts[0].direction === "restore_yours"
              ? "You took the report's value"
              : "You kept yours"}
            {" · "}
            {decidedAgo(op.reverts[0].decidedAt)}
          </span>
        </div>
      )}

      {ownEntryLabel && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-status-warning">
          <PencilLine className="size-3" aria-hidden />
          <span>Replaces yours · {ownEntryLabel}</span>
        </div>
      )}

      <FlightCardBody
        flight={flight}
        displayPrefs={displayPrefs}
        diffs={diffs}
        // Day/night landing counts are decided by our sun calculator and are
        // shown on the timeline below. The corner carries PF/PM only when it
        // ISN'T changing — a change is owned by the PilotFlyingChoice block,
        // which states it as a choice rather than a strike-through.
        showLandingChips={false}
        showStatusIcons={false}
        showPilotRole={!diffs.has("pilotFlying")}
      />

      <DayNightFlag
        op={op}
        diffs={diffs}
        useCompany={useCompany}
        onUseCompanyChange={onUseCompanyChange}
        displayPrefs={displayPrefs}
      />

      <PilotFlyingChoice
        diffs={diffs}
        flight={flight}
        useRecorded={useRecordedPf}
        onUseRecordedChange={onUseRecordedPfChange}
        roleOverride={roleOverride}
        onRoleChange={onRoleChange}
      />

      {extraChanges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {extraChanges.map((c) => (
            <span key={c.field} className="inline-flex items-baseline gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {FIELD_LABELS[c.field] ?? c.field}
              </span>
              <span className="text-muted-foreground/50 line-through decoration-muted-foreground/40">
                {c.from || "—"}
              </span>
              <span className="font-semibold text-primary">{c.to}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );

  const shell = cn(
    "rounded-xl border border-l-2 bg-card px-3 py-2 transition-colors",
    TONE_ACCENT[tone],
    selectable && "cursor-pointer hover:bg-muted/40",
    selectable && checked && "border-primary/30 bg-primary/[0.06]",
    tone === "delete" && "opacity-90"
  );

  if (!selectable) return <div className={shell}>{inner}</div>;

  return (
    <label className={cn(shell, "flex items-start gap-2")}>
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange?.(Boolean(v))}
        className="mt-1.5 shrink-0"
      />
      <div className="min-w-0 flex-1">{inner}</div>
    </label>
  );
}
