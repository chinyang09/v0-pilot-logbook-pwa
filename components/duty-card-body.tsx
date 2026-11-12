"use client";

/**
 * A roster DUTY drawn as a logbook card — the same four lines and the same
 * height as `FlightCardBody`, so the logbook's virtualised list can carry
 * flights and duties side by side at its one calibrated row height:
 *
 * ```
 * 12   06:00 ──────── 12:00 hrs ──────── 18:00      ← report — length — release (UTC)
 * NOV  ◷ SBY1                          STANDBY      ← the code, in the duty's colour
 * 26   Home standby                                 ← what the report calls it
 *      Called out 09:10Z                            ← para 6(6), when it was
 * ```
 *
 * A duty is told from a flight before a word is read: the date and the code
 * are in the duty type's colour, its icon sits beside the code, and the card
 * carries a stripe of that colour down its leading edge. A day off or leave is
 * the whole day ("all day") — the report rosters it as 00:00–23:59 at base,
 * which only made two clocks to parse — and a run of them is ONE card
 * ("3 days … to 14 NOV").
 *
 * Times are UTC, as every flight card's are: the logbook is kept in UTC.
 */

import { cn } from "@/lib/utils";
import type { ScheduleEntry, DutyType } from "@/types/entities/roster.types";
import type { DisplayPreferences } from "@/types/db/stores.types";
import { formatClockDisplay, formatHHMMDisplay } from "@/lib/utils/time";
import { parseYMDLocal } from "@/lib/utils/date";
import { DUTY_TYPE_ICONS } from "@/components/roster/duty-entry-card";
import { isWholeDayDuty } from "@/lib/utils/logbook-rows";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Each duty type's colour — the calendar's hues and the calendar's WEIGHTS.
 * The logbook is a flight log: a standby (and a schedule flight duty) keeps
 * its full colour; ground, training, positioning and rest days take a softer
 * stripe and the muted ink, so a month of days off does not out-shout the
 * flight cards around them. Rest days (off, leave) share one hue.
 */
const quiet = (stripe: string) => ({ text: "text-muted-foreground", stripe });
export const DUTY_CARD_TONE: Record<DutyType, { text: string; stripe: string }> = {
  flight: { text: "text-blue-700 dark:text-blue-300", stripe: "bg-blue-500" },
  standby: { text: "text-amber-700 dark:text-amber-300", stripe: "bg-amber-500" },
  training: quiet("bg-purple-500/45"),
  leave: quiet("bg-green-500/45"),
  off: quiet("bg-green-500/45"),
  ground: quiet("bg-orange-500/45"),
  positioning: quiet("bg-cyan-500/45"),
  other: quiet("bg-slate-400/45"),
};

const TYPE_LABEL: Record<DutyType, string> = {
  flight: "Flight",
  standby: "Standby",
  training: "Training",
  leave: "Leave",
  off: "Day Off",
  ground: "Ground",
  positioning: "Positioning",
  other: "Duty",
};

const HHMM = /^(\d{1,2}):(\d{2})/;
function minutesOf(t: string | undefined): number | null {
  const m = t ? HHMM.exec(t.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}


export interface DutyCardBodyProps {
  entry: ScheduleEntry;
  displayPrefs?: DisplayPreferences;
  /** When a standby was called out (para 6(6)), "HH:MM" UTC. */
  calledOutAt?: string | null;
  /** The LAST day of a run of whole days (a week of leave is one card). */
  through?: string;
  /** How many days the run holds. */
  days?: number;
}

export function DutyCardBody({ entry, displayPrefs, calledOutAt, through, days = 1 }: DutyCardBodyProps) {
  const tone = DUTY_CARD_TONE[entry.dutyType] ?? DUTY_CARD_TONE.other;
  const Icon = DUTY_TYPE_ICONS[entry.dutyType] ?? DUTY_TYPE_ICONS.other;
  const clock = (v: string) => formatClockDisplay(v.slice(0, 5), displayPrefs?.clockSeparator);

  const wholeDay = isWholeDayDuty(entry);
  const start = wholeDay ? null : minutesOf(entry.reportTime);
  const end = wholeDay ? null : minutesOf(entry.debriefTime);
  let length = "";
  let nextDay = false;
  if (start !== null && end !== null) {
    let span = end - start;
    if (span <= 0) {
      span += 24 * 60;
      nextDay = true;
    }
    length = formatHHMMDisplay(
      `${Math.floor(span / 60)}:${String(span % 60).padStart(2, "0")}`,
      displayPrefs?.timeFormat
    );
  }

  const date = parseYMDLocal(entry.date);
  const day = String(date.getDate()).padStart(2, "0");
  const month = MONTHS[date.getMonth()];
  const year = String(date.getFullYear()).slice(2);
  const code = (entry.dutyCode || TYPE_LABEL[entry.dutyType] || "Duty").toUpperCase();
  const description = entry.dutyDescription?.trim() || TYPE_LABEL[entry.dutyType];

  return (
    <div className="relative flex items-start gap-2">
      {/* The leading stripe: a duty reads as one before its words do. */}
      <span aria-hidden className={cn("absolute -left-3 top-0 bottom-0 w-1 rounded-r-full", tone.stripe)} />
      <div className="flex w-16 shrink-0 flex-col items-center justify-start">
        <div className={cn("text-6xl font-bold leading-none tracking-tight", tone.text)}>{day}</div>
        <div className="mt-0.5 text-base tracking-wide text-muted-foreground">
          {month} {year}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex flex-col">
          {/* Fixed line boxes throughout: the list positions every row at one
              calibrated height (see flight-card-body.tsx). */}
          <div className="flex h-6 items-center justify-between gap-1 text-base leading-tight">
            <span className="text-base font-semibold leading-tight">{start !== null ? clock(entry.reportTime!) : ""}</span>
            <div className="flex flex-1 items-center justify-center gap-1 text-muted-foreground">
              <div className="h-px flex-1 rounded-full bg-current" />
              <span className="whitespace-nowrap px-1 text-base font-medium leading-tight">
                {wholeDay ? (days > 1 ? `${days} days` : "all day") : length ? `${length} hrs` : ""}
              </span>
              <div className="h-px flex-1 rounded-full bg-current" />
            </div>
            <span className="text-base font-semibold leading-tight">
              {end !== null
                ? `${clock(entry.debriefTime!)}${nextDay ? "⁺¹" : ""}`
                : days > 1 && through
                  ? `to ${Number(through.slice(8, 10))} ${MONTHS[Number(through.slice(5, 7)) - 1]}`
                  : ""}
            </span>
          </div>

          <div className="-mt-0.5 flex h-[calc(1.65rem*1.25)] items-center justify-between text-[1.65rem] leading-tight">
            <span className={cn("flex min-w-0 items-center gap-2 font-bold leading-tight tracking-tight", tone.text)}>
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="truncate">{code}</span>
            </span>
            <span className={cn("ml-2 shrink-0 text-[13px] font-semibold uppercase tracking-wider", tone.text)}>
              {TYPE_LABEL[entry.dutyType]}
            </span>
          </div>
        </div>

        <div className="mt-0.5 flex h-[1.25em] items-center text-[13px] leading-tight text-muted-foreground">
          <span className="min-w-0 truncate">{description}</span>
        </div>
        <div className="mt-0.5 flex h-[1.25em] items-center text-[13px] leading-tight text-muted-foreground">
          {calledOutAt ? <span className="truncate">Called out {clock(calledOutAt)}Z</span> : null}
        </div>
      </div>
    </div>
  );
}
