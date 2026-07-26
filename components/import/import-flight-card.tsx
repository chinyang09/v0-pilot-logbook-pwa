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

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Sunrise, Sunset, TriangleAlert } from "lucide-react";
import type { FieldDiff } from "@/lib/utils/roster/reconciler";
import type { AcceptableOperation } from "@/lib/utils/parsers/schedule-parser";
import type { FlightLog } from "@/types/entities/flight.types";
import type { DisplayPreferences } from "@/types/db/stores.types";
import { FlightCardBody } from "@/components/flight-card-body";

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
  "pilotFlying",
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

/**
 * Shown ONLY when our sun-position calculation disagrees with the company's
 * day/night split. Our value is what gets applied; this strip explains why and
 * offers the deliberate opt-out.
 */
function DayNightFlag({
  op,
  diffs,
  useCompany,
  onUseCompanyChange,
}: {
  op: AcceptableOperation;
  diffs: Map<string, FieldDiff>;
  useCompany: boolean;
  onUseCompanyChange?: (v: boolean) => void;
}) {
  const disagreements = TOLDG_FIELDS.filter(
    (f) => diffs.get(f)?.companyValue !== undefined
  );
  if (disagreements.length === 0) return null;

  const sector = "sector" in op ? op.sector : undefined;
  const ctx = sector?.toLdgContext;
  const takeoffSide = disagreements.some((f) => f.endsWith("Takeoffs"));
  const landingSide = disagreements.some((f) => f.endsWith("Landings"));

  const airport = takeoffSide ? sector?.departureIata : sector?.arrivalIata;
  const timeUtc = takeoffSide ? ctx?.outUtc : ctx?.inUtc;
  const sunrise = takeoffSide ? ctx?.depSunriseUtc : ctx?.arrSunriseUtc;
  const sunset = takeoffSide ? ctx?.depSunsetUtc : ctx?.arrSunsetUtc;
  const status = takeoffSide ? ctx?.depSunStatus : ctx?.arrSunStatus;
  const label = takeoffSide && landingSide ? "T/O + LDG" : takeoffSide ? "T/O" : "LDG";

  return (
    <div
      className={cn(
        "mt-1.5 rounded-lg border px-2 py-1.5 text-[11px] leading-relaxed",
        useCompany
          ? "border-border bg-muted/40"
          : "border-status-warning/30 bg-status-warning/[0.07]"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 font-medium text-status-warning">
          <TriangleAlert className="h-3 w-3" aria-hidden />
          {label} day/night differs from company
        </span>
        {status && (
          <span
            className={cn(
              "rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide",
              status === "night"
                ? "bg-indigo-500/15 text-indigo-500 dark:text-indigo-300"
                : "bg-status-warning/15 text-status-warning"
            )}
          >
            {status}
          </span>
        )}
      </div>

      {(sunrise || sunset || timeUtc) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums text-muted-foreground">
          {airport && <span className="font-medium text-foreground/70">{airport}</span>}
          {timeUtc && <span>{timeUtc}Z</span>}
          {sunrise && (
            <span className="inline-flex items-center gap-0.5">
              <Sunrise className="h-3 w-3" aria-hidden />
              {sunrise}Z
            </span>
          )}
          {sunset && (
            <span className="inline-flex items-center gap-0.5">
              <Sunset className="h-3 w-3" aria-hidden />
              {sunset}Z
            </span>
          )}
        </div>
      )}

      {onUseCompanyChange && (
        <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-muted-foreground">
          <Checkbox
            checked={useCompany}
            onCheckedChange={(v) => onUseCompanyChange(Boolean(v))}
            className="h-3.5 w-3.5"
          />
          <span>
            Use the company&apos;s figures instead
            {disagreements.length > 0 && (
              <span className="ml-1 tabular-nums opacity-70">
                (
                {disagreements
                  .map((f) => `${shortLabel(f)} ${diffs.get(f)?.companyValue}`)
                  .join(", ")}
                )
              </span>
            )}
          </span>
        </label>
      )}
    </div>
  );
}

function shortLabel(field: string): string {
  return field
    .replace("day", "day ")
    .replace("night", "night ")
    .replace("Takeoffs", "T/O")
    .replace("Landings", "LDG");
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
}) {
  const changes: FieldDiff[] =
    "changes" in op && Array.isArray(op.changes) ? op.changes : [];

  const diffs = new Map<string, FieldDiff>();
  for (const c of changes) diffs.set(c.field, c);

  const flight = displayFlight(op);

  const extraChanges = changes.filter(
    (c) => !CHROME_FIELDS.has(c.field) && !HIDDEN_FIELDS.has(c.field)
  );

  const selectable = typeof onCheckedChange === "function";

  const inner = (
    <>
      <FlightCardBody
        flight={flight}
        displayPrefs={displayPrefs}
        diffs={diffs}
        showLandingChips={false}
        showStatusIcons={false}
      />

      <DayNightFlag
        op={op}
        diffs={diffs}
        useCompany={useCompany}
        onUseCompanyChange={onUseCompanyChange}
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
