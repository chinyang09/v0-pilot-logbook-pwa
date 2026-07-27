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
import { SunTimeline, DayNightChoice } from "./sun-timeline";
import { allowedRolesFor } from "@/lib/utils/roster/pilot-role";
import type { PilotRole } from "@/types/entities/flight.types";
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

  return (
    <div className="mt-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-2">
      {sides.map((side) => {
        const isTakeoff = side === "Takeoffs";
        return (
          <div key={side} className={cn(sides.length > 1 && "mb-2 last:mb-0")}>
            <SunTimeline
              kind={isTakeoff ? "takeoff" : "landing"}
              airport={isTakeoff ? sector?.departureIata : sector?.arrivalIata}
              eventUtc={isTakeoff ? ctx?.outUtc : ctx?.inUtc}
              sunriseUtc={isTakeoff ? ctx?.depSunriseUtc : ctx?.arrSunriseUtc}
              sunsetUtc={isTakeoff ? ctx?.depSunsetUtc : ctx?.arrSunsetUtc}
              zulu={displayPrefs?.useZuluTime ?? true}
              tzOffsetHours={
                (isTakeoff ? ctx?.depTzOffset : ctx?.arrTzOffset) ?? 0
              }
            />
            <DayNightChoice
              ours={verdictFrom(diffs, side, (d) => d?.to)}
              company={verdictFrom(diffs, side, (d) => d?.companyValue)}
              useCompany={useCompany}
              onChange={onUseCompanyChange}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Role picker, shown when a PF/PM change forces a `pilotRole` correction.
 * The pre-selected value is the one derived from the user's import setting;
 * they can still choose any role valid for the new flying state (PICUS is
 * withheld when the leg becomes Pilot Monitoring, since the two can't coexist).
 */
function RoleChoice({
  diffs,
  value,
  onChange,
}: {
  diffs: Map<string, FieldDiff>;
  value?: PilotRole;
  onChange?: (role: PilotRole) => void;
}) {
  const roleDiff = diffs.get("pilotRole");
  if (!roleDiff) return null;

  const pfDiff = diffs.get("pilotFlying");
  const nowFlying = pfDiff ? pfDiff.to === "true" : true;
  const selected = value ?? (roleDiff.to as PilotRole);

  return (
    <div className="mt-1.5 rounded-lg bg-muted/30 px-2 py-1.5">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Role — {nowFlying ? "now pilot flying" : "now pilot monitoring"}
      </div>
      <div className="flex flex-wrap gap-1">
        {allowedRolesFor(nowFlying).map((role) => {
          const active = role === selected;
          return (
            <button
              key={role}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!onChange}
              onClick={(e) => {
                // The card is a <label> — don't toggle its checkbox.
                e.preventDefault();
                e.stopPropagation();
                onChange?.(role);
              }}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
            >
              {role}
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground/70">
        was {roleDiff.from}
      </div>
    </div>
  );
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
        // Day/night landing counts are decided by our sun calculator and shown
        // on the timeline below, so the chip slot carries PF/PM instead — a
        // pilot-flying change is otherwise invisible on the card.
        showLandingChips={false}
        showStatusIcons={false}
        showPilotRole
      />

      <DayNightFlag
        op={op}
        diffs={diffs}
        useCompany={useCompany}
        onUseCompanyChange={onUseCompanyChange}
        displayPrefs={displayPrefs}
      />

      <RoleChoice diffs={diffs} value={roleOverride} onChange={onRoleChange} />

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
