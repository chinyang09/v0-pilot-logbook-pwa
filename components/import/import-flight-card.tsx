/**
 * Import review — flight card.
 *
 * Renders one import operation as a compact flight card instead of a wall of
 * `field: from → to` prose. The card IS the diff: every slot that changes
 * shows the old value struck through in grey followed by the new value in the
 * accent colour, so the shape of the flight stays readable while the changes
 * pop.
 *
 * Day/night takeoff + landing get their own strip: our sun-position
 * calculator is authoritative, so the strip shows the sunrise/sunset evidence
 * and flags — with a single badge — when the company's report disagreed.
 */

"use client";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Sunrise, Sunset, TriangleAlert } from "lucide-react";
import type { FieldDiff } from "@/lib/utils/roster/reconciler";
import type { AcceptableOperation } from "@/lib/utils/parsers/schedule-parser";
import { getAirportDisplayCode } from "@/lib/utils/airport-display";

export type AirportPref = "icao" | "iata" | "both";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** Field slots already represented by the card's own chrome. */
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
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
]);

/** Internal plumbing the user should never see in a review card. */
const HIDDEN_FIELDS = new Set([
  "picId",
  "sicId",
  "departureIcao",
  "arrivalIcao",
  "departureTimezone",
  "arrivalTimezone",
  "importSource",
  "reportGeneratedAt",
  "remarks",
]);

const FIELD_LABELS: Record<string, string> = {
  pilotFlying: "Pilot flying",
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
// Value primitives
// ============================================================

/**
 * A single value slot. With no diff it renders plainly; with a diff it renders
 * `old` struck through in grey followed by the new value in the accent colour.
 */
function Val({
  diff,
  current,
  className,
  placeholder = "—",
  format = (v: string) => v,
}: {
  diff?: FieldDiff;
  current?: string;
  className?: string;
  placeholder?: string;
  format?: (v: string) => string;
}) {
  if (!diff) {
    const v = (current || "").trim();
    return (
      <span className={className}>{v ? format(v) : placeholder}</span>
    );
  }
  const from = (diff.from || "").trim();
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      {from && (
        <span className="font-normal text-muted-foreground/50 line-through decoration-muted-foreground/40">
          {format(from)}
        </span>
      )}
      <span className="font-semibold text-primary">{format(diff.to)}</span>
    </span>
  );
}

function hhmm(v: string): string {
  return v.length >= 5 ? v.slice(0, 5) : v;
}

/**
 * Humanise the raw stored value for display. FieldDiff carries everything as
 * strings, so booleans would otherwise read as "false → true".
 */
function formatFieldValue(field: string, value: string): string {
  if (field === "pilotFlying") {
    if (value === "true") return "PF";
    if (value === "false") return "PM";
  }
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  return value;
}

// ============================================================
// Day/night strip
// ============================================================

/** One side (takeoff or landing) of the day/night evidence strip. */
function SunRow({
  label,
  airport,
  timeUtc,
  sunrise,
  sunset,
  status,
}: {
  label: string;
  airport?: string;
  timeUtc?: string;
  sunrise?: string | null;
  sunset?: string | null;
  status?: "day" | "night";
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
      <span className="w-8 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {airport && <span className="font-medium">{airport}</span>}
      {timeUtc && <span className="text-muted-foreground">{timeUtc}Z</span>}
      {sunrise && (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <Sunrise className="h-3 w-3" aria-hidden />
          {sunrise}Z
        </span>
      )}
      {sunset && (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <Sunset className="h-3 w-3" aria-hidden />
          {sunset}Z
        </span>
      )}
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
  );
}

/**
 * Sunrise/sunset evidence for the day-vs-night takeoff & landing call.
 * We apply our own calculation; the badge only appears when the company's
 * report said otherwise.
 */
function SunStrip({
  op,
  diffs,
}: {
  op: AcceptableOperation;
  diffs: Map<string, FieldDiff>;
}) {
  const sector = "sector" in op ? op.sector : undefined;
  const ctx = sector?.toLdgContext;
  const touched = TOLDG_FIELDS.filter((f) => diffs.has(f));
  if (touched.length === 0) return null;

  const disagreed = touched.some((f) => diffs.get(f)?.companyValue !== undefined);

  const takeoffChanged =
    diffs.has("dayTakeoffs") || diffs.has("nightTakeoffs");
  const landingChanged =
    diffs.has("dayLandings") || diffs.has("nightLandings");

  return (
    <div className="mt-2 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Day / night by sun position
        </span>
        {disagreed && (
          <span className="inline-flex items-center gap-1 rounded-full border border-status-warning/40 bg-status-warning/10 px-1.5 py-px text-[10px] font-medium text-status-warning">
            <TriangleAlert className="h-2.5 w-2.5" aria-hidden />
            differs from company
          </span>
        )}
      </div>

      {ctx ? (
        <div className="space-y-0.5">
          {takeoffChanged && (
            <SunRow
              label="T/O"
              airport={sector?.departureIata}
              timeUtc={ctx.outUtc}
              sunrise={ctx.depSunriseUtc}
              sunset={ctx.depSunsetUtc}
              status={ctx.depSunStatus}
            />
          )}
          {landingChanged && (
            <SunRow
              label="LDG"
              airport={sector?.arrivalIata}
              timeUtc={ctx.inUtc}
              sunrise={ctx.arrSunriseUtc}
              sunset={ctx.arrSunsetUtc}
              status={ctx.arrSunStatus}
            />
          )}
        </div>
      ) : (
        <div className="text-muted-foreground">
          Sunrise/sunset unavailable — using the reported values.
        </div>
      )}

      {/* The counts themselves, old struck through. */}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {touched.map((f) => {
          const d = diffs.get(f)!;
          return (
            <span key={f} className="inline-flex items-baseline gap-1 tabular-nums">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {f.replace("day", "Day ").replace("night", "Night ").replace("Takeoffs", "T/O").replace("Landings", "LDG")}
              </span>
              <Val diff={d} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Card
// ============================================================

export function ImportFlightCard({
  op,
  airportPref,
  tone,
  checked,
  onCheckedChange,
}: {
  op: AcceptableOperation;
  airportPref: AirportPref;
  tone: CardTone;
  /** Present → the card renders a checkbox and is selectable. */
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
}) {
  const flight = "flight" in op ? op.flight : undefined;
  const sector = "sector" in op ? op.sector : undefined;
  const changes: FieldDiff[] =
    "changes" in op && Array.isArray(op.changes) ? op.changes : [];

  const diffs = new Map<string, FieldDiff>();
  for (const c of changes) diffs.set(c.field, c);

  // Base values: the existing flight when we have one, else the parsed sector.
  const date = flight?.date ?? sector?.date ?? "";
  const [y, m, d] = date.split("-");
  const dayNum = d ?? "--";
  const monthLabel = m ? MONTHS[parseInt(m, 10) - 1] ?? "" : "";
  const yearLabel = y ? y.slice(2) : "";

  const isSimulator = Boolean(flight?.isSimulator);

  const depBase = flight
    ? getAirportDisplayCode(flight.departureIcao, flight.departureIata, airportPref)
    : getAirportDisplayCode(sector?.departureIcao, sector?.departureIata, airportPref);
  const arrBase = flight
    ? getAirportDisplayCode(flight.arrivalIcao, flight.arrivalIata, airportPref)
    : getAirportDisplayCode(sector?.arrivalIcao, sector?.arrivalIata, airportPref);

  // Times: prefer actuals, fall back to scheduled (a not-yet-flown sector).
  const outDiff = diffs.get("outTime") ?? diffs.get("scheduledOut");
  const inDiff = diffs.get("inTime") ?? diffs.get("scheduledIn");
  const outBase =
    flight?.outTime || flight?.scheduledOut || sector?.actualOut || sector?.scheduledOut || "";
  const inBase =
    flight?.inTime || flight?.scheduledIn || sector?.actualIn || sector?.scheduledIn || "";
  const isScheduledOnly =
    !(flight?.outTime || sector?.actualOut) && Boolean(outBase);

  const blockBase = flight?.blockTime || sector?.blockTime || "";
  const regBase = flight?.aircraftReg || sector?.aircraftReg || "";
  const typeBase = flight?.aircraftType || sector?.aircraftType || "";

  const crewBase = [flight?.picName, flight?.sicName].filter(Boolean) as string[];
  const crewFromSector =
    sector?.crew?.map((c) => c.name).filter(Boolean) ??
    (sector?.picResolvedName ? [sector.picResolvedName] : []);
  const crewNames = crewBase.length > 0 ? crewBase : crewFromSector;

  // Anything not already drawn by the card chrome.
  const extraChanges = changes.filter(
    (c) => !CHROME_FIELDS.has(c.field) && !HIDDEN_FIELDS.has(c.field)
  );

  const selectable = typeof onCheckedChange === "function";
  const Wrapper = selectable ? "label" : "div";

  return (
    <Wrapper
      className={cn(
        "block rounded-xl border border-l-2 bg-card p-3 transition-colors",
        TONE_ACCENT[tone],
        selectable && "cursor-pointer hover:bg-muted/40",
        selectable && checked && "bg-primary/[0.06] border-primary/30",
        tone === "delete" && "opacity-90"
      )}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onCheckedChange?.(Boolean(v))}
            className="mt-1 shrink-0"
          />
        )}

        {/* Date block */}
        <div className="shrink-0 text-center leading-none">
          <div className="text-2xl font-bold tabular-nums">{dayNum}</div>
          <div className="mt-0.5 text-[10px] tracking-wide text-muted-foreground">
            {monthLabel} {yearLabel}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {/* Route + flight number */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {isSimulator ? (
              <span className="text-base font-bold tracking-tight">
                SIM · {flight?.simSessionCode || "session"}
              </span>
            ) : (
              <span className="text-base font-bold tracking-tight">
                <Val diff={diffs.get("departureIata")} current={depBase} />
                <span className="mx-1 text-muted-foreground">→</span>
                <Val diff={diffs.get("arrivalIata")} current={arrBase} />
              </span>
            )}
            {!isSimulator && (
              <Val
                diff={diffs.get("flightNumber")}
                current={flight?.flightNumber || sector?.flightNumber}
                className="text-xs font-medium text-muted-foreground"
                placeholder=""
              />
            )}
            {isScheduledOnly && (
              <span className="rounded bg-orange-600/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-orange-600 dark:bg-orange-400/10 dark:text-orange-400">
                scheduled
              </span>
            )}
          </div>

          {/* Times + block */}
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm tabular-nums">
            <span className="inline-flex items-baseline gap-1">
              <Val diff={outDiff} current={outBase} format={hhmm} placeholder="--:--" />
              <span className="text-muted-foreground">–</span>
              <Val diff={inDiff} current={inBase} format={hhmm} placeholder="--:--" />
              <span className="text-[10px] text-muted-foreground">Z</span>
            </span>
            {/* Block time — omitted when there is none to show (a not-yet-flown
                sector reads "00:00", which is noise rather than information). */}
            {!isSimulator &&
              (diffs.has("blockTime") ||
                (blockBase && blockBase !== "00:00")) && (
                <span className="inline-flex items-baseline gap-1 text-xs">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    blk
                  </span>
                  <Val
                    diff={diffs.get("blockTime")}
                    current={blockBase}
                    format={hhmm}
                  />
                </span>
              )}
          </div>

          {/* Aircraft — separator only between values that actually exist. */}
          {(regBase ||
            typeBase ||
            diffs.has("aircraftReg") ||
            diffs.has("aircraftType")) && (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {(regBase || diffs.has("aircraftReg")) && (
                <Val
                  diff={diffs.get("aircraftReg")}
                  current={regBase}
                  placeholder=""
                />
              )}
              {(regBase || diffs.has("aircraftReg")) &&
                (typeBase || diffs.has("aircraftType")) && (
                  <span aria-hidden>·</span>
                )}
              {(typeBase || diffs.has("aircraftType")) && (
                <Val
                  diff={diffs.get("aircraftType")}
                  current={typeBase}
                  placeholder=""
                />
              )}
            </div>
          )}

          {(crewNames.length > 0 || diffs.has("picName") || diffs.has("sicName")) && (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {diffs.has("picName") ? (
                <Val diff={diffs.get("picName")} />
              ) : (
                crewNames[0] && <span className="truncate">{crewNames[0]}</span>
              )}
              {diffs.has("sicName") ? (
                <>
                  <span aria-hidden>·</span>
                  <Val diff={diffs.get("sicName")} />
                </>
              ) : (
                crewNames[1] && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{crewNames[1]}</span>
                  </>
                )
              )}
            </div>
          )}

          <SunStrip op={op} diffs={diffs} />

          {/* Anything the chrome doesn't cover */}
          {extraChanges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {extraChanges.map((c) => (
                <span key={c.field} className="inline-flex items-baseline gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {FIELD_LABELS[c.field] ?? c.field}
                  </span>
                  <Val
                    diff={c}
                    format={(v) => formatFieldValue(c.field, v)}
                  />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
