/**
 * Shared flight-card body — the single visual definition of "a flight card".
 *
 * Used by the logbook list (inside a SwipeableCard) and by the import review
 * dialog, so both render an identical layout: big day block, out/duration/in
 * strip, route, `flight # • reg • type`, crew, and the landing chips.
 *
 * The import review passes a `diffs` map, which turns any slot it covers into
 * `old value struck through in grey` + `new value in the accent colour`. With
 * no map the card renders exactly as the logbook always has.
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Sun, Moon, Pen, Lock } from "lucide-react";
import type { FlightLog } from "@/types/entities/flight.types";
import type { DisplayPreferences } from "@/types/db/stores.types";
import type { FieldDiff } from "@/lib/utils/roster/reconciler";
import { getDepartureDisplay, getArrivalDisplay } from "@/lib/utils/airport-display";
import { formatHHMMDisplay } from "@/lib/utils/time";
import { parseYMDLocal as parseDateLocal } from "@/lib/utils/date";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function timeToMinutes(hhmm: string): number {
  const parts = hhmm.split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function formatScheduledDuration(
  scheduledOut: string,
  scheduledIn: string
): string {
  let diff = timeToMinutes(scheduledIn) - timeToMinutes(scheduledOut);
  if (diff < 0) diff += 1440;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/**
 * One value slot. Without a diff it renders plainly, preserving the logbook's
 * existing look; with one it shows the superseded value struck through in grey
 * ahead of the incoming value in the accent colour.
 */
function Slot({
  diff,
  current,
  format = (v: string) => v,
  placeholder = "",
  className,
}: {
  diff?: FieldDiff;
  current?: string;
  format?: (v: string) => string;
  placeholder?: string;
  className?: string;
}) {
  if (!diff) {
    const v = (current || "").trim();
    return <span className={className}>{v ? format(v) : placeholder}</span>;
  }
  const from = (diff.from || "").trim();
  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      {from && (
        <span className="font-normal text-muted-foreground/50 line-through decoration-muted-foreground/40">
          {format(from)}
        </span>
      )}
      <span className="text-primary">{format(diff.to)}</span>
    </span>
  );
}

const hhmm = (v: string) => (v.length >= 5 ? v.slice(0, 5) : v);

/** Stored pilotFlying is a boolean string; pilots read it as PF / PM. */
const pfLabel = (v: string) => (v === "true" ? "PF" : "PM");

export interface FlightCardBodyProps {
  flight: FlightLog;
  displayPrefs?: DisplayPreferences;
  /**
   * Import review only: field → change. Slots covered by the map render as a
   * strike-through diff.
   */
  diffs?: Map<string, FieldDiff>;
  /**
   * Day/night landing chips. Hidden in the import review — the day/night split
   * is decided by our sun calculator there and surfaced separately, so the
   * chips would just be noise.
   */
  showLandingChips?: boolean;
  /** Signature / lock status icons — logbook only. */
  showStatusIcons?: boolean;
  /**
   * Show the pilot-flying role (PF/PM) in the bottom-right slot. The import
   * review uses this in place of the landing chips so a pilot-flying change —
   * otherwise invisible — is actually legible on the card.
   */
  showPilotRole?: boolean;
}

export function FlightCardBody({
  flight,
  displayPrefs,
  diffs,
  showLandingChips = true,
  showStatusIcons = true,
  showPilotRole = false,
}: FlightCardBodyProps) {
  const d = (field: string) => diffs?.get(field);

  const isLocked = flight.isLocked || false;
  const hasOut = !!flight.outTime;
  const hasIn = !!flight.inTime;
  const isScheduled = !hasOut || !hasIn;

  const outDiff = d("outTime") ?? d("scheduledOut");
  const inDiff = d("inTime") ?? d("scheduledIn");

  const displayOut = hasOut
    ? flight.outTime!.slice(0, 5)
    : flight.scheduledOut
      ? flight.scheduledOut.slice(0, 5)
      : "";
  const displayIn = hasIn
    ? flight.inTime!.slice(0, 5)
    : flight.scheduledIn
      ? flight.scheduledIn.slice(0, 5)
      : "";

  const durationInfo = useMemo(() => {
    if (hasOut && hasIn) {
      return {
        text: formatHHMMDisplay(flight.blockTime, displayPrefs?.timeFormat),
        suffix: "hrs",
        scheduled: false,
      };
    }
    if (flight.scheduledOut && flight.scheduledIn) {
      return {
        text: formatScheduledDuration(flight.scheduledOut, flight.scheduledIn),
        suffix: "sch",
        scheduled: true,
      };
    }
    return { text: "", suffix: "hrs", scheduled: false };
  }, [
    hasOut,
    hasIn,
    flight.blockTime,
    flight.scheduledOut,
    flight.scheduledIn,
    displayPrefs?.timeFormat,
  ]);

  const flightDate = parseDateLocal(flight.date);
  const day = flightDate.getDate().toString().padStart(2, "0");
  const month = MONTHS[flightDate.getMonth()];
  const year = flightDate.getFullYear().toString().slice(2);

  const totalDayLandings = flight.dayLandings || 0;
  const totalNightLandings = flight.nightLandings || 0;

  const crewNames = useMemo(() => {
    const names: string[] = [];
    if (flight.picName) names.push(flight.picName);
    if (flight.sicName) names.push(flight.sicName);
    if (flight.additionalCrew && Array.isArray(flight.additionalCrew)) {
      flight.additionalCrew.forEach((crew) => {
        if (crew.name) names.push(crew.name);
      });
    }
    return names;
  }, [flight.picName, flight.sicName, flight.additionalCrew]);

  const blockDiff = d("blockTime");
  const pfDiff = d("pilotFlying");

  // `flight # • reg • type`, skipping any part that is both empty and unchanged.
  const metaParts = (
    [
      { key: "flightNumber", current: flight.flightNumber },
      { key: "aircraftReg", current: flight.aircraftReg },
      { key: "aircraftType", current: flight.aircraftType },
    ] as const
  )
    .map((p) => ({ ...p, diff: d(p.key) }))
    .filter((p) => Boolean(p.diff) || Boolean((p.current || "").trim()));

  return (
    <div
      className={cn(
        "flex items-start gap-2",
        isScheduled && "text-orange-600 dark:text-orange-400/80"
      )}
    >
      <div className="flex flex-col items-center justify-start shrink-0 w-16">
        <div className="text-6xl font-bold leading-none tracking-tight">{day}</div>
        <div
          className={cn(
            "text-base mt-0.5 tracking-wide",
            isScheduled
              ? "text-orange-600/70 dark:text-orange-400/60"
              : "text-muted-foreground"
          )}
        >
          {month} {year}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "text-base font-semibold leading-tight",
                isScheduled && hasOut && "text-foreground"
              )}
            >
              <Slot diff={outDiff} current={displayOut} format={hhmm} />
            </span>
            <div className="flex items-center gap-1 flex-1 justify-center">
              <div
                className={cn(
                  "h-px flex-1",
                  durationInfo.scheduled
                    ? "bg-orange-600/40 dark:bg-orange-400/30"
                    : "bg-border"
                )}
              />
              <span className="text-base font-medium whitespace-nowrap px-1">
                {blockDiff ? (
                  <Slot diff={blockDiff} format={hhmm} />
                ) : (
                  <>
                    {durationInfo.text}
                    {durationInfo.text ? ` ${durationInfo.suffix}` : ""}
                  </>
                )}
              </span>
              <div
                className={cn(
                  "h-px flex-1",
                  durationInfo.scheduled
                    ? "bg-orange-600/40 dark:bg-orange-400/30"
                    : "bg-border"
                )}
              />
            </div>
            <span
              className={cn(
                "text-base font-semibold leading-tight",
                isScheduled && hasIn && "text-foreground"
              )}
            >
              <Slot diff={inDiff} current={displayIn} format={hhmm} />
            </span>
          </div>

          <div className="flex items-center justify-between mt-0">
            {flight.isSimulator ? (
              <>
                <span className="text-2xl font-bold leading-tight tracking-tight">
                  SIM
                </span>
                <span className="text-2xl font-bold leading-tight tracking-tight">
                  {flight.simSessionCode || ""}
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-bold leading-tight tracking-tight">
                  <Slot
                    diff={d("departureIata")}
                    current={getDepartureDisplay(
                      flight,
                      displayPrefs?.airportIdentifier
                    )}
                  />
                </span>
                <span className="text-2xl font-bold leading-tight tracking-tight">
                  <Slot
                    diff={d("arrivalIata")}
                    current={getArrivalDisplay(
                      flight,
                      displayPrefs?.airportIdentifier
                    )}
                  />
                </span>
              </>
            )}
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 text-xs leading-tight mt-0.5",
            isScheduled
              ? "text-orange-600/70 dark:text-orange-400/60"
              : "text-muted-foreground"
          )}
        >
          {/* Bullets only BETWEEN present values — a sector with no aircraft
              assigned yet would otherwise render a bare "TR118 • • A21N". */}
          {metaParts.map((part, i) => (
            <span key={part.key} className="inline-flex items-baseline gap-1.5">
              {i > 0 && <span>•</span>}
              <Slot diff={part.diff} current={part.current} />
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between mt-0.5">
          <div
            className={cn(
              "flex flex-1 min-w-0 text-xs leading-tight",
              isScheduled
                ? "text-orange-600/70 dark:text-orange-400/60"
                : "text-muted-foreground"
            )}
          >
            {/* Diff variant uses inline flow (not a gapped flex row) so the
                comma sits tight against the preceding name, rather than
                reading "Bennet , Self". */}
            {diffs && (d("picName") || d("sicName")) ? (
              <span className="min-w-0">
                {d("picName") ? <Slot diff={d("picName")} /> : crewNames[0]}
                {(d("sicName") || crewNames[1]) && <span>, </span>}
                {d("sicName") ? <Slot diff={d("sicName")} /> : crewNames[1]}
              </span>
            ) : (
              crewNames.map((name, i) => (
                <span key={`${name}-${i}`} className="flex-1 min-w-0 truncate">
                  {i > 0 ? ", " : ""}
                  {name}
                </span>
              ))
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs font-medium shrink-0 ml-2">
            {showPilotRole && (
              <span className="inline-flex items-baseline gap-1">
                {pfDiff ? (
                  <>
                    <span className="text-muted-foreground/50 line-through decoration-muted-foreground/40">
                      {pfLabel(pfDiff.from)}
                    </span>
                    <span className="font-semibold text-primary">
                      {pfLabel(pfDiff.to)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {pfLabel(String(flight.pilotFlying))}
                  </span>
                )}
              </span>
            )}
            {showLandingChips && totalDayLandings > 0 && (
              <div className="flex items-center gap-0.5">
                <Sun className="h-3 w-3" />
                <span>{totalDayLandings}D</span>
              </div>
            )}
            {showLandingChips && totalNightLandings > 0 && (
              <div className="flex items-center gap-0.5">
                <Moon className="h-3 w-3" />
                <span>{totalNightLandings}N</span>
              </div>
            )}
            {showStatusIcons && flight.signature && (
              <Pen className="h-3 w-3 text-primary" />
            )}
            {showStatusIcons && isLocked && (
              <Lock className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
